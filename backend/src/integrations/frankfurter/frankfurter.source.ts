import { z } from 'zod';
import { getJson, UpstreamError, type FetchLike } from '../../lib/http.js';

/**
 * Câmbio gratuito, sem autenticação: Frankfurter v2 (https://frankfurter.dev).
 * GET /v2/rate/EUR/BRL → {"date":"2026-11-05","base":"EUR","quote":"BRL","rate":5.6134}
 * Aceita `?date=YYYY-MM-DD` para a cotação de uma data (fins de semana devolvem o último dia útil).
 */
const RateSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), base: z.string(), quote: z.string(), rate: z.number().positive() }).loose();

export interface FetchedRate {
  /** Taxa como string decimal. */
  rate: string;
  /** Data de referência informada pela fonte (YYYY-MM-DD). */
  date: string;
}

export interface ExchangeRateSource {
  readonly id: string;
  fetchRate(base: string, quote: string, date?: string): Promise<FetchedRate>;
}

export class ExchangeRateUnavailableError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'ExchangeRateUnavailableError';
  }
}

export class FrankfurterExchangeRateSource implements ExchangeRateSource {
  readonly id = 'frankfurter';
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchLike;

  constructor(options: { baseUrl?: string; timeoutMs?: number; fetchFn?: FetchLike } = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://api.frankfurter.dev/v2').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.fetchFn = options.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
  }

  async fetchRate(base: string, quote: string, date?: string): Promise<FetchedRate> {
    const url = `${this.baseUrl}/rate/${base}/${quote}${date ? `?date=${date}` : ''}`;
    let body: unknown;
    try {
      body = await getJson(this.fetchFn, url, this.timeoutMs, 'Frankfurter');
    } catch (error) {
      if (error instanceof UpstreamError) throw new ExchangeRateUnavailableError(error.message, error);
      throw error;
    }
    const parsed = RateSchema.safeParse(body);
    if (!parsed.success) throw new ExchangeRateUnavailableError('Resposta de câmbio da Frankfurter fora do formato esperado.');
    return { rate: String(parsed.data.rate), date: parsed.data.date };
  }
}
