import { z } from 'zod';
import { isValidPrice } from '../../lib/decimal.js';
import { getJson, UpstreamError, type FetchLike } from '../../lib/http.js';
import { PriceSourceUnavailableError, type MarketPriceProvider, type MarketQuote, type PricedVariant } from '../market-price-provider.js';

/**
 * Preços de mercado da TCGdex (campo `pricing` de GET /v2/{lang}/cards/{id}).
 * Contrato validado contra a API real em 2026-11-06 (ex.: swsh3-136, swsh4-44, sv03.5-025, sv03.5-199):
 *
 * pricing.cardmarket (EUR): avg, low, trend, avg1, avg7, avg30 e as versões "-holo" (foil), updated, unit.
 *   Na Cardmarket o produto-base de uma carta holo (ex.: Holo Rare, V, ex) já é a versão holo; os campos "-holo"
 *   são a versão foil do produto, que nas cartas com reverse corresponde ao Reverse Holofoil.
 *   Ex.: sv03.5-025 (normal + reverse): trend 0,15 / trend-holo 0,64 — bate com TCGplayer normal 0,29 USD / reverse 0,80 USD.
 *        swsh4-44 (só holo): trend 13,33 bate com TCGplayer holofoil 11,69 USD; trend-holo pode vir 0 ou ruidoso.
 * pricing.tcgplayer (USD): um objeto por variante (normal, holofoil, reverse-holofoil, 1st-edition, 1st-edition-holofoil,
 *   unlimited, unlimited-holofoil...) com lowPrice, midPrice, highPrice, marketPrice, directLowPrice.
 *
 * Qualquer parte pode faltar; valores null, 0 ou negativos não são cotações.
 */

const Num = z.number().nullable().optional();

const CardmarketSchema = z
  .object({
    updated: z.string().optional(),
    unit: z.string().optional(),
    avg: Num,
    low: Num,
    trend: Num,
    avg1: Num,
    avg7: Num,
    avg30: Num,
    'avg-holo': Num,
    'low-holo': Num,
    'trend-holo': Num,
  })
  .loose();

const TcgplayerVariantSchema = z.object({ marketPrice: Num, lowPrice: Num, midPrice: Num, highPrice: Num, directLowPrice: Num }).loose();

const TcgplayerSchema = z
  .object({ updated: z.string().optional(), unit: z.string().optional() })
  .catchall(z.unknown());

export const TcgdexPricedCardSchema = z
  .object({
    id: z.string(),
    variants: z
      .object({ normal: z.boolean().optional(), holo: z.boolean().optional(), reverse: z.boolean().optional(), firstEdition: z.boolean().optional() })
      .loose()
      .optional(),
    pricing: z
      .object({ cardmarket: CardmarketSchema.nullable().optional(), tcgplayer: TcgplayerSchema.nullable().optional() })
      .loose()
      .nullable()
      .optional(),
  })
  .loose();
export type TcgdexPricedCard = z.infer<typeof TcgdexPricedCardSchema>;

type Variants = TcgdexPricedCard['variants'];
type Cardmarket = z.infer<typeof CardmarketSchema>;

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Converte number em string decimal sem ruído binário (0.1 → "0.1"). */
function priceString(value: number): string {
  return String(Number(value.toPrecision(12)));
}

/**
 * Quais campos da Cardmarket representam cada variante. O indicador principal é `trend`; `avg` é a alternativa
 * do MESMO produto/variante quando o trend não é válido. Variantes ambíguas ficam sem cotação.
 */
function cardmarketFields(variant: PricedVariant, v: Variants): [keyof Cardmarket, keyof Cardmarket] | null {
  const known = !!v && (v.normal !== undefined || v.holo !== undefined || v.reverse !== undefined);
  const normal = v?.normal === true;
  const holo = v?.holo === true;
  const reverse = v?.reverse === true;
  switch (variant) {
    case 'NORMAL':
      return !known || normal ? ['trend', 'avg'] : null;
    case 'HOLOFOIL':
      if (!known || !holo) return null;
      if (!normal) return ['trend', 'avg']; // a carta só existe holo: o produto-base é o holo
      return reverse ? null : ['trend-holo', 'avg-holo']; // normal + holo (sem reverse): foil = holo
    case 'REVERSE_HOLOFOIL':
      if (known && !reverse) return null;
      return known && normal && holo ? null : ['trend-holo', 'avg-holo'];
    case 'FIRST_EDITION':
      return null; // a Cardmarket separa 1ª edição em outro produto, que a TCGdex não expõe
  }
}

function tcgplayerKeys(variant: PricedVariant, v: Variants): string[] {
  switch (variant) {
    case 'NORMAL':
      return ['normal', 'unlimited'];
    case 'HOLOFOIL':
      return ['holofoil', 'unlimited-holofoil'];
    case 'REVERSE_HOLOFOIL':
      return ['reverse-holofoil', 'reverse'];
    case 'FIRST_EDITION':
      return v?.holo ? ['1st-edition-holofoil', '1stEditionHolofoil'] : ['1st-edition', '1stEditionNormal'];
  }
}

const ALL_VARIANTS: PricedVariant[] = ['NORMAL', 'HOLOFOIL', 'REVERSE_HOLOFOIL', 'FIRST_EDITION'];

/** Extrai as cotações válidas por marketplace e variante. Nunca reaproveita o preço de outra variante. */
export function extractQuotes(card: TcgdexPricedCard): MarketQuote[] {
  const quotes: MarketQuote[] = [];
  const cm = card.pricing?.cardmarket;
  if (cm && (cm.unit ?? 'EUR') === 'EUR') {
    const updated = parseDate(cm.updated);
    for (const variant of ALL_VARIANTS) {
      const fields = cardmarketFields(variant, card.variants);
      if (!fields) continue;
      const field = fields.find((f) => isValidPrice(cm[f]));
      if (!field) continue;
      quotes.push({ marketplace: 'cardmarket', variant, currency: 'EUR', price: priceString(cm[field] as number), field: String(field), sourceUpdatedAt: updated });
    }
  }
  const tp = card.pricing?.tcgplayer;
  if (tp && (tp.unit ?? 'USD') === 'USD') {
    const updated = parseDate(tp.updated);
    for (const variant of ALL_VARIANTS) {
      for (const key of tcgplayerKeys(variant, card.variants)) {
        const parsed = TcgplayerVariantSchema.safeParse(tp[key]);
        const price = parsed.success ? parsed.data.marketPrice : undefined;
        if (!isValidPrice(price)) continue;
        quotes.push({ marketplace: 'tcgplayer', variant, currency: 'USD', price: priceString(price), field: `${key}.marketPrice`, sourceUpdatedAt: updated });
        break;
      }
    }
  }
  return quotes;
}

export interface TcgdexPriceOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: FetchLike;
}

export class TcgdexMarketPriceProvider implements MarketPriceProvider {
  readonly id = 'tcgdex';
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchLike;

  constructor(options: TcgdexPriceOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://api.tcgdex.net/v2').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.fetchFn = options.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
  }

  async getQuotes(externalId: string): Promise<MarketQuote[] | null> {
    // Os preços são globais; consultamos em inglês, idioma com cobertura completa.
    const url = `${this.baseUrl}/en/cards/${encodeURIComponent(externalId)}`;
    let body: unknown;
    try {
      body = await getJson(this.fetchFn, url, this.timeoutMs, 'TCGdex');
    } catch (error) {
      if (error instanceof UpstreamError) throw new PriceSourceUnavailableError(error.message, error);
      throw error;
    }
    if (body === null) return null;
    const parsed = TcgdexPricedCardSchema.safeParse(body);
    if (!parsed.success) throw new PriceSourceUnavailableError('Resposta de preços da TCGdex fora do formato esperado.', parsed.error);
    return extractQuotes(parsed.data);
  }
}
