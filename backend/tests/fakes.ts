import {
  CatalogUnavailableError,
  type CardCatalogProvider,
  type CardSearchQuery,
  type CatalogCard,
  type CatalogCardSummary,
  type CatalogSetSummary,
} from '../src/integrations/catalog-provider.js';
import { normalizeLocalNumber } from '../src/lib/text.js';

const img = (path: string) => ({ small: `https://assets.tcgdex.net/en/${path}/low.webp`, large: `https://assets.tcgdex.net/en/${path}/high.webp` });

export const SETS: CatalogSetSummary[] = [
  { externalId: 'swsh3', name: 'Darkness Ablaze', logoUrl: null, symbolUrl: null, officialCount: 189, totalCount: 201 },
  { externalId: 'swsh10', name: 'Astral Radiance', logoUrl: null, symbolUrl: null, officialCount: 189, totalCount: 216 },
  { externalId: 'sv03.5', name: '151', logoUrl: null, symbolUrl: null, officialCount: 165, totalCount: 207 },
  { externalId: 'base1', name: 'Base Set', logoUrl: null, symbolUrl: null, officialCount: 102, totalCount: 102 },
  { externalId: 'sv04', name: 'Paradox Rift', logoUrl: null, symbolUrl: null, officialCount: 182, totalCount: 266 },
  { externalId: 'sv06', name: 'Twilight Masquerade', logoUrl: null, symbolUrl: null, officialCount: 167, totalCount: 226 },
  { externalId: 'swsh1', name: 'Sword & Shield', logoUrl: null, symbolUrl: null, officialCount: 202, totalCount: 216 },
];

export const CARDS: (CatalogCardSummary & { rarity: string })[] = [
  { externalId: 'swsh3-136', name: 'Furret', localNumber: '136', setId: 'swsh3', image: img('swsh/swsh3/136'), rarity: 'Uncommon' },
  { externalId: 'swsh10-136', name: 'Canceling Cologne', localNumber: '136', setId: 'swsh10', image: img('swsh/swsh10/136'), rarity: 'Uncommon' },
  { externalId: 'hgss1-21', name: 'Furret', localNumber: '21', setId: 'hgss1', image: img('hgss/hgss1/21'), rarity: 'Rare' },
  { externalId: 'sv03.5-025', name: 'Pikachu', localNumber: '025', setId: 'sv03.5', image: img('sv/sv03.5/025'), rarity: 'Common' },
  { externalId: 'base1-58', name: 'Pikachu', localNumber: '58', setId: 'base1', image: img('base/base1/58'), rarity: 'Common' },
  { externalId: 'swsh4-44', name: 'Pikachu V', localNumber: '44', setId: 'swsh4', image: img('swsh/swsh4/44'), rarity: 'Rare Holo V' },
  { externalId: 'sm1-136', name: 'Double Colorless Energy', localNumber: '136', setId: 'sm1', image: null, rarity: 'Uncommon' },
  { externalId: 'swsh3-126', name: 'Galarian Obstagoon', localNumber: '126', setId: 'swsh3', image: img('swsh/swsh3/126'), rarity: 'Rare' },
  { externalId: 'sv04-123', name: 'Brute Bonnet', localNumber: '123', setId: 'sv04', image: img('sv/sv04/123'), rarity: 'Rare' },
  { externalId: 'sv06-130', name: 'Dragapult ex', localNumber: '130', setId: 'sv06', image: img('sv/sv06/130'), rarity: 'Double Rare' },
  { externalId: 'swsh1-136', name: 'Cufant', localNumber: '136', setId: 'swsh1', image: img('swsh/swsh1/136'), rarity: 'Common' },
];

/** Fornecedor de catálogo em memória, com contadores e modo "fora do ar". */
export class FakeCatalog implements CardCatalogProvider {
  readonly providerId = 'tcgdex';
  down = false;
  calls = 0;

  private guard() {
    this.calls++;
    if (this.down) throw new CatalogUnavailableError('fora do ar');
  }

  async searchCards(q: CardSearchQuery) {
    this.guard();
    return CARDS.filter(
      (c) =>
        (!q.name || c.name.toLowerCase().includes(q.name.toLowerCase())) &&
        (!q.localNumber || c.localNumber.includes(q.localNumber)) &&
        (!q.setId || c.setId === q.setId),
    ).map(({ rarity: _r, ...rest }) => rest);
  }

  async searchCardsByNumber(localNumber: string, options: { setId?: string } = {}) {
    return this.searchCards({ localNumber, setId: options.setId });
  }

  async getCardById(id: string): Promise<CatalogCard | null> {
    this.guard();
    const c = CARDS.find((x) => x.externalId === id);
    if (!c) return null;
    const set = SETS.find((s) => s.externalId === c.setId) ?? { externalId: c.setId!, name: c.setId!, logoUrl: null, symbolUrl: null, officialCount: null, totalCount: null };
    return {
      provider: 'tcgdex',
      externalId: c.externalId,
      name: c.name,
      localNumber: c.localNumber,
      rarity: c.rarity,
      category: 'Pokemon',
      illustrator: null,
      image: c.image,
      set,
      variants: { normal: true, holo: false, reverse: true, firstEdition: false, wPromo: false },
      language: 'en',
    };
  }

  async getSets() {
    this.guard();
    return SETS;
  }

  async getSetById(id: string) {
    this.guard();
    const s = SETS.find((x) => x.externalId === id);
    return s ? { ...s, serieId: null, serieName: null, releaseDate: null, cards: [], language: 'en' as const } : null;
  }

  async getCardIndex() {
    this.guard();
    return CARDS.map(({ rarity: _r, ...rest }) => rest);
  }

  async findSetsByOfficialCount(n: number) {
    return (await this.getSets()).filter((s) => s.officialCount === n);
  }
}

export const sameNumber = (a: string, b: string) => normalizeLocalNumber(a) === normalizeLocalNumber(b);

import type { ExchangeRateSource, FetchedRate } from '../src/integrations/frankfurter/frankfurter.source.js';
import { ExchangeRateUnavailableError } from '../src/integrations/frankfurter/frankfurter.source.js';
import { PriceSourceUnavailableError, type MarketPriceProvider, type MarketQuote } from '../src/integrations/market-price-provider.js';

type QuoteInput = Omit<MarketQuote, 'sourceUpdatedAt'> & { sourceUpdatedAt?: Date | null };

/** Fonte de preços em memória: cotações configuráveis por carta, contador de chamadas e modo "fora do ar". */
export class FakePrices implements MarketPriceProvider {
  readonly id = 'tcgdex';
  down = false;
  calls: string[] = [];
  quotes = new Map<string, QuoteInput[]>();

  set(externalId: string, quotes: QuoteInput[]) {
    this.quotes.set(externalId, quotes);
  }

  async getQuotes(externalId: string): Promise<MarketQuote[] | null> {
    this.calls.push(externalId);
    if (this.down) throw new PriceSourceUnavailableError('fora do ar');
    return (this.quotes.get(externalId) ?? []).map((q) => ({ sourceUpdatedAt: null, ...q }));
  }
}

/** Fonte de câmbio em memória. */
export class FakeFx implements ExchangeRateSource {
  readonly id = 'fake';
  down = false;
  calls: { base: string; date?: string }[] = [];
  rates: Record<string, string> = { EUR: '6.00', USD: '5.50' };
  date = '2026-11-05';

  async fetchRate(base: string, _quote: string, date?: string): Promise<FetchedRate> {
    this.calls.push({ base, date });
    if (this.down) throw new ExchangeRateUnavailableError('fora do ar');
    const rate = this.rates[base];
    if (!rate) throw new ExchangeRateUnavailableError('moeda desconhecida');
    return { rate, date: date ?? this.date };
  }
}

/** Relógio controlável para testar cache e cotações desatualizadas. */
export class Clock {
  constructor(public current = new Date('2026-11-05T15:00:00Z')) {}
  now = () => this.current;
  advanceHours(h: number) {
    this.current = new Date(this.current.getTime() + h * 3_600_000);
  }
}
