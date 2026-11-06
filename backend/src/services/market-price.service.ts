import type { PrismaClient } from '@prisma/client';
import { PriceSourceUnavailableError, type MarketPriceProvider } from '../integrations/market-price-provider.js';
import type { ExchangeRateService, RateResult } from './exchange-rate.service.js';
import type { PriceHistoryService } from './price-history.service.js';

export interface MarketPriceOptions {
  /** Validade de uma cotação antes de consultar de novo (padrão 24 h). */
  ttlMs?: number;
  /** Espera mínima antes de tentar de novo uma carta que falhou (padrão 15 min), exceto em atualização manual. */
  retryAfterErrorMs?: number;
  /** Máximo de cartas consultadas por chamada (mantém a função serverless dentro do tempo limite). */
  batchSize?: number;
  concurrency?: number;
  now?: () => Date;
}

export interface FxInfo {
  rate: string;
  rateDate: string;
  stale: boolean;
}

export interface SyncResult {
  checked: number;
  failed: number;
  /** Cartas que ainda precisam de atualização (serão consultadas na próxima chamada). */
  remaining: number;
  fx: { EUR: FxInfo | null; USD: FxInfo | null };
}

/**
 * Atualiza as cotações das cartas da coleção, sob demanda (sem cron, fila ou Redis):
 * - só consulta cartas cuja cotação passou da validade (≈24 h) ou quando o usuário pede atualização manual;
 * - faz UMA consulta por carta, não importa quantos exemplares existam;
 * - se a consulta falhar, mantém os snapshots anteriores e marca a carta como desatualizada.
 */
export class MarketPriceService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: MarketPriceProvider,
    private readonly fx: ExchangeRateService,
    private readonly history: PriceHistoryService,
    private readonly options: MarketPriceOptions = {},
  ) {}

  private now() {
    return this.options.now?.() ?? new Date();
  }

  get ttlMs() {
    return this.options.ttlMs ?? 24 * 60 * 60 * 1000;
  }

  /**
   * @param since atualização manual: consulta tudo que não foi verificado depois deste instante.
   * @param cardIds limita às cartas informadas (ex.: logo após adicionar exemplares).
   */
  refresh(params: { since?: Date; cardIds?: string[]; limit?: number } = {}): Promise<SyncResult> {
    // Execuções em série na mesma instância: evita consultas duplicadas para a mesma carta.
    const run = this.queue.then(() => this.doRefresh(params));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async doRefresh({ since, cardIds, limit }: { since?: Date; cardIds?: string[]; limit?: number }): Promise<SyncResult> {
    const now = this.now();
    const threshold = since ?? new Date(now.getTime() - this.ttlMs);
    const retryBefore = new Date(now.getTime() - (this.options.retryAfterErrorMs ?? 15 * 60 * 1000));
    const where = {
      provider: this.provider.id,
      ...(cardIds ? { id: { in: cardIds } } : { items: { some: { status: 'AVAILABLE' } } }),
      AND: [
        { OR: [{ pricesCheckedAt: null }, { pricesCheckedAt: { lt: threshold } }] },
        // Depois de uma falha, espera um pouco antes de tentar de novo (exceto na atualização manual).
        ...(since ? [] : [{ OR: [{ pricesErrorAt: null }, { pricesErrorAt: { lte: retryBefore } }] }]),
      ],
    };
    const due = await this.prisma.cardCatalog.findMany({
      where,
      select: { id: true, externalId: true, pricesCheckedAt: true },
      orderBy: [{ pricesCheckedAt: { sort: 'asc', nulls: 'first' } }],
    });
    const batch = due.slice(0, limit ?? this.options.batchSize ?? 15);

    const rates = batch.length ? await this.loadRates() : await this.peekRates();
    let failed = 0;
    const work = [...batch];
    const workers = Array.from({ length: Math.min(this.options.concurrency ?? 4, work.length) }, async () => {
      for (let card = work.shift(); card; card = work.shift()) {
        const ok = await this.refreshCard(card.id, card.externalId, rates, now);
        if (!ok) failed++;
      }
    });
    await Promise.all(workers);

    const info = (r: RateResult | undefined): FxInfo | null => (r ? { rate: r.rate.toString(), rateDate: r.rateDate, stale: r.stale } : null);
    return { checked: batch.length, failed, remaining: due.length - batch.length, fx: { EUR: info(rates['EUR']), USD: info(rates['USD']) } };
  }

  private async refreshCard(id: string, externalId: string, rates: Partial<Record<string, RateResult>>, now: Date): Promise<boolean> {
    try {
      const quotes = await this.provider.getQuotes(externalId);
      const { skipped } = await this.history.record(id, quotes ?? [], rates, now);
      if (skipped > 0) {
        // Sem câmbio não dá para converter: tentamos de novo mais tarde, preservando os preços anteriores.
        await this.prisma.cardCatalog.update({ where: { id }, data: { pricesStatus: 'ERROR', pricesErrorAt: now } });
        return false;
      }
      await this.prisma.cardCatalog.update({
        where: { id },
        data: { pricesCheckedAt: now, pricesStatus: quotes && quotes.length ? 'OK' : 'NO_PRICING', pricesErrorAt: null },
      });
      return true;
    } catch (error) {
      if (!(error instanceof PriceSourceUnavailableError)) throw error;
      await this.prisma.cardCatalog.update({ where: { id }, data: { pricesStatus: 'ERROR', pricesErrorAt: now } });
      return false;
    }
  }

  private async loadRates(): Promise<Partial<Record<string, RateResult>>> {
    const rates: Partial<Record<string, RateResult>> = {};
    await Promise.all(
      (['EUR', 'USD'] as const).map(async (c) => {
        try {
          rates[c] = await this.fx.latest(c);
        } catch {
          // sem câmbio para esta moeda: as cotações nela ficam para a próxima tentativa
        }
      }),
    );
    return rates;
  }

  /** Câmbio salvo, sem consultar a fonte (usado só para informar a tela quando não há nada a atualizar). */
  private async peekRates(): Promise<Partial<Record<string, RateResult>>> {
    const rates: Partial<Record<string, RateResult>> = {};
    for (const c of ['EUR', 'USD'] as const) {
      const row = await this.prisma.exchangeRate.findFirst({ where: { base: c, quote: 'BRL' }, orderBy: [{ rateDate: 'desc' }, { fetchedAt: 'desc' }] });
      if (row) {
        rates[c] = {
          currency: c,
          rate: row.rate,
          rateDate: row.rateDate.toISOString().slice(0, 10),
          fetchedAt: row.fetchedAt,
          stale: this.now().getTime() - row.fetchedAt.getTime() > 2 * this.ttlMs,
        };
      }
    }
    return rates;
  }
}
