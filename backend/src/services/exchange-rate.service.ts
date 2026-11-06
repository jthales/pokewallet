import type { PrismaClient } from '@prisma/client';
import { ExchangeRateUnavailableError, type ExchangeRateSource } from '../integrations/frankfurter/frankfurter.source.js';
import { dateToDay, dayToDate, dec, roundMoney, type Decimal } from '../lib/decimal.js';

export const SUPPORTED_CURRENCIES = ['BRL', 'USD', 'EUR'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
export const REFERENCE_CURRENCY = 'BRL';

export interface RateResult {
  currency: SupportedCurrency;
  /** Quantos BRL vale 1 unidade da moeda. */
  rate: Decimal;
  /** Data de referência da cotação (YYYY-MM-DD). */
  rateDate: string;
  fetchedAt: Date;
  /** true quando a fonte falhou e reutilizamos a última cotação salva. */
  stale: boolean;
}

/**
 * Câmbio para BRL com cache diário no banco.
 * - `latest`: reaproveita a cotação salva por até 24 h; depois consulta a fonte. Se a fonte falhar, devolve a
 *   última cotação válida marcada como desatualizada. Nunca usa taxa fixa.
 * - `onDate`: cotação de uma data (para preços de aquisição em moeda estrangeira).
 */
export class ExchangeRateService {
  private readonly inflight = new Map<string, Promise<RateResult>>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly source: ExchangeRateSource,
    private readonly options: { ttlMs?: number; now?: () => Date } = {},
  ) {}

  private now() {
    return this.options.now?.() ?? new Date();
  }

  private identity(): RateResult {
    const now = this.now();
    return { currency: 'BRL', rate: dec(1), rateDate: dateToDay(now), fetchedAt: now, stale: false };
  }

  latest(currency: SupportedCurrency): Promise<RateResult> {
    if (currency === 'BRL') return Promise.resolve(this.identity());
    return this.dedupe(`latest:${currency}`, () => this.loadLatest(currency));
  }

  onDate(currency: SupportedCurrency, day: string): Promise<RateResult> {
    if (currency === 'BRL') return Promise.resolve(this.identity());
    return this.dedupe(`date:${currency}:${day}`, () => this.loadOnDate(currency, day));
  }

  /** Converte um valor na moeda de origem para BRL, arredondado a centavos. */
  static toBRL(amount: Decimal | string | number, rate: Decimal): Decimal {
    return roundMoney(dec(amount).mul(rate));
  }

  private async loadLatest(currency: SupportedCurrency): Promise<RateResult> {
    const ttl = this.options.ttlMs ?? 24 * 60 * 60 * 1000;
    const saved = await this.prisma.exchangeRate.findFirst({ where: { base: currency, quote: REFERENCE_CURRENCY }, orderBy: [{ rateDate: 'desc' }, { fetchedAt: 'desc' }] });
    if (saved && this.now().getTime() - saved.fetchedAt.getTime() < ttl) return this.toResult(currency, saved, false);
    try {
      return await this.fetchAndStore(currency);
    } catch (error) {
      if (error instanceof ExchangeRateUnavailableError && saved) return this.toResult(currency, saved, true);
      throw error;
    }
  }

  private async loadOnDate(currency: SupportedCurrency, day: string): Promise<RateResult> {
    const exact = await this.prisma.exchangeRate.findUnique({ where: { base_quote_rateDate: { base: currency, quote: REFERENCE_CURRENCY, rateDate: dayToDate(day) } } });
    if (exact) return this.toResult(currency, exact, false);
    try {
      return await this.fetchAndStore(currency, day);
    } catch (error) {
      if (!(error instanceof ExchangeRateUnavailableError)) throw error;
      const week = new Date(dayToDate(day).getTime() - 7 * 86_400_000);
      const near = await this.prisma.exchangeRate.findFirst({
        where: { base: currency, quote: REFERENCE_CURRENCY, rateDate: { lte: dayToDate(day), gte: week } },
        orderBy: { rateDate: 'desc' },
      });
      if (near) return this.toResult(currency, near, true);
      throw error;
    }
  }

  private async fetchAndStore(currency: SupportedCurrency, day?: string): Promise<RateResult> {
    const fetched = await this.source.fetchRate(currency, REFERENCE_CURRENCY, day);
    const rate = dec(fetched.rate);
    if (!rate.isFinite() || rate.lte(0)) throw new ExchangeRateUnavailableError('Cotação cambial inválida.');
    const fetchedAt = this.now();
    const row = await this.prisma.exchangeRate.upsert({
      where: { base_quote_rateDate: { base: currency, quote: REFERENCE_CURRENCY, rateDate: dayToDate(fetched.date) } },
      create: { base: currency, quote: REFERENCE_CURRENCY, rate, rateDate: dayToDate(fetched.date), fetchedAt },
      update: { rate, fetchedAt },
    });
    return this.toResult(currency, row, false);
  }

  private toResult(currency: SupportedCurrency, row: { rate: Decimal; rateDate: Date; fetchedAt: Date }, stale: boolean): RateResult {
    return { currency, rate: dec(row.rate), rateDate: dateToDay(row.rateDate), fetchedAt: row.fetchedAt, stale };
  }

  private dedupe(key: string, load: () => Promise<RateResult>): Promise<RateResult> {
    const running = this.inflight.get(key);
    if (running) return running;
    const promise = load().finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }
}
