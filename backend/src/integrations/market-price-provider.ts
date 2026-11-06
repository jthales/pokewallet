/**
 * Contrato entre o domínio e qualquer fonte de preços de mercado.
 * A TCGdex é a implementação atual (ela agrega Cardmarket e TCGplayer).
 */

/** Marketplace de referência. Nunca misturamos (nem fazemos média entre) marketplaces diferentes. */
export const MARKETPLACES = ['cardmarket', 'tcgplayer'] as const;
export type Marketplace = (typeof MARKETPLACES)[number];

/** Variantes de exemplar que podem ter cotação. "OTHER" nunca tem. */
export const PRICED_VARIANTS = ['NORMAL', 'HOLOFOIL', 'REVERSE_HOLOFOIL', 'FIRST_EDITION'] as const;
export type PricedVariant = (typeof PRICED_VARIANTS)[number];

export type QuoteCurrency = 'EUR' | 'USD';

export interface MarketQuote {
  marketplace: Marketplace;
  variant: PricedVariant;
  currency: QuoteCurrency;
  /** Preço no valor original (string decimal, sem perda de precisão). */
  price: string;
  /** Campo do fornecedor usado (ex.: "trend", "trend-holo", "holofoil.marketPrice"). */
  field: string;
  sourceUpdatedAt: Date | null;
}

export interface MarketPriceProvider {
  readonly id: string;
  /**
   * Cotações disponíveis para a carta. Lista vazia = carta sem preço compatível.
   * Retorna null se a carta não existir; lança PriceSourceUnavailableError em falhas.
   */
  getQuotes(externalId: string): Promise<MarketQuote[] | null>;
}

export class PriceSourceUnavailableError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'PriceSourceUnavailableError';
  }
}
