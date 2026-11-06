import { describe, expect, it } from 'vitest';
import { FrankfurterExchangeRateSource, ExchangeRateUnavailableError } from '../src/integrations/frankfurter/frankfurter.source.js';
import { PriceSourceUnavailableError } from '../src/integrations/market-price-provider.js';
import { extractQuotes, TcgdexMarketPriceProvider, type TcgdexPricedCard } from '../src/integrations/tcgdex/tcgdex-pricing.js';
import type { FetchLike } from '../src/lib/http.js';

// Recortes de respostas reais da TCGdex (consultadas em 2026-11-06).
const furret: TcgdexPricedCard = {
  id: 'swsh3-136',
  variants: { normal: true, reverse: true, holo: false, firstEdition: false },
  pricing: {
    cardmarket: { updated: '2026-11-05T22:54:32.855Z', unit: 'EUR', avg: 0.06, low: 0.02, trend: 0.05, avg30: 0.06, 'avg-holo': 0.22, 'trend-holo': 0.25 },
    tcgplayer: {
      unit: 'USD',
      updated: '2026-11-05T22:54:45.308Z',
      normal: { lowPrice: 0.02, midPrice: 0.27, marketPrice: 0.29 },
      'reverse-holofoil': { lowPrice: 0.17, midPrice: 0.42, marketPrice: 0.43 },
    },
  },
};
const pikachuVmax: TcgdexPricedCard = {
  id: 'swsh4-44',
  variants: { normal: false, reverse: false, holo: true, firstEdition: false },
  pricing: {
    cardmarket: { unit: 'EUR', avg: 12.31, trend: 13.33, 'avg-holo': null, 'trend-holo': 25.71 },
    tcgplayer: { unit: 'USD', holofoil: { marketPrice: 11.69 } },
  },
};
const sir: TcgdexPricedCard = {
  id: 'sv03.5-199',
  variants: { normal: false, holo: true, reverse: false },
  pricing: { cardmarket: { unit: 'EUR', trend: 0, avg: 336.32, 'trend-holo': 0 }, tcgplayer: { unit: 'USD', holofoil: { marketPrice: 0 } } },
};

const find = (quotes: ReturnType<typeof extractQuotes>, m: string, v: string) => quotes.find((q) => q.marketplace === m && q.variant === v);

describe('Preços TCGdex por variante', () => {
  it('separa normal e reverse holo, sem reaproveitar o preço de outra variante', () => {
    const q = extractQuotes(furret);
    expect(find(q, 'cardmarket', 'NORMAL')).toMatchObject({ price: '0.05', field: 'trend', currency: 'EUR' });
    expect(find(q, 'cardmarket', 'REVERSE_HOLOFOIL')).toMatchObject({ price: '0.25', field: 'trend-holo' });
    expect(find(q, 'tcgplayer', 'NORMAL')).toMatchObject({ price: '0.29', field: 'normal.marketPrice', currency: 'USD' });
    expect(find(q, 'tcgplayer', 'REVERSE_HOLOFOIL')).toMatchObject({ price: '0.43' });
    // A carta não existe em holo nem 1ª edição: nada de cotação para essas variantes.
    expect(find(q, 'cardmarket', 'HOLOFOIL')).toBeUndefined();
    expect(find(q, 'tcgplayer', 'HOLOFOIL')).toBeUndefined();
    expect(find(q, 'tcgplayer', 'FIRST_EDITION')).toBeUndefined();
    expect(find(q, 'cardmarket', 'NORMAL')!.sourceUpdatedAt).toEqual(new Date('2026-11-05T22:54:32.855Z'));
  });

  it('carta só holo usa o produto-base da Cardmarket e o holofoil da TCGplayer', () => {
    const q = extractQuotes(pikachuVmax);
    expect(find(q, 'cardmarket', 'HOLOFOIL')).toMatchObject({ price: '13.33', field: 'trend' });
    expect(find(q, 'tcgplayer', 'HOLOFOIL')).toMatchObject({ price: '11.69' });
    expect(find(q, 'cardmarket', 'NORMAL')).toBeUndefined();
    expect(find(q, 'cardmarket', 'REVERSE_HOLOFOIL')).toBeUndefined();
  });

  it('não trata zero ou ausência como cotação; usa avg da mesma variante quando o trend é inválido', () => {
    const q = extractQuotes(sir);
    expect(find(q, 'cardmarket', 'HOLOFOIL')).toMatchObject({ price: '336.32', field: 'avg' });
    expect(find(q, 'tcgplayer', 'HOLOFOIL')).toBeUndefined();
    expect(extractQuotes({ id: 'x', pricing: undefined })).toEqual([]);
    expect(extractQuotes({ id: 'x', pricing: { cardmarket: null, tcgplayer: null } })).toEqual([]);
    expect(extractQuotes({ id: 'x', variants: { normal: true }, pricing: { cardmarket: { trend: -1, avg: null } } })).toEqual([]);
  });

  it('variantes ambíguas na Cardmarket (normal + holo + reverse) ficam sem cotação de foil', () => {
    const q = extractQuotes({ id: 'x', variants: { normal: true, holo: true, reverse: true }, pricing: { cardmarket: { trend: 1, 'trend-holo': 2 } } });
    expect(q.map((x) => x.variant)).toEqual(['NORMAL']);
  });
});

const fetchReturning = (status: number, body: unknown): FetchLike => async () => ({ ok: status < 400, status, json: async () => body });

describe('Falhas das APIs externas', () => {
  it('TCGdex: rede, status de erro e formato inválido viram PriceSourceUnavailableError; 404 vira null', async () => {
    const offline = new TcgdexMarketPriceProvider({ fetchFn: async () => Promise.reject(new Error('ECONNRESET')) });
    await expect(offline.getQuotes('swsh3-136')).rejects.toBeInstanceOf(PriceSourceUnavailableError);
    await expect(new TcgdexMarketPriceProvider({ fetchFn: fetchReturning(500, {}) }).getQuotes('a')).rejects.toBeInstanceOf(PriceSourceUnavailableError);
    await expect(new TcgdexMarketPriceProvider({ fetchFn: fetchReturning(200, { nope: 1 }) }).getQuotes('a')).rejects.toBeInstanceOf(PriceSourceUnavailableError);
    expect(await new TcgdexMarketPriceProvider({ fetchFn: fetchReturning(404, {}) }).getQuotes('a')).toBeNull();
    const ok = await new TcgdexMarketPriceProvider({ fetchFn: fetchReturning(200, furret) }).getQuotes('swsh3-136');
    expect(ok).toHaveLength(4);
  });

  it('Frankfurter: lê o contrato v2 e sinaliza falhas', async () => {
    const urls: string[] = [];
    const src = new FrankfurterExchangeRateSource({
      fetchFn: async (url) => (urls.push(url), { ok: true, status: 200, json: async () => ({ date: '2026-11-05', base: 'EUR', quote: 'BRL', rate: 6.1234 }) }),
    });
    expect(await src.fetchRate('EUR', 'BRL')).toEqual({ rate: '6.1234', date: '2026-11-05' });
    await src.fetchRate('USD', 'BRL', '2026-01-10');
    expect(urls).toEqual(['https://api.frankfurter.dev/v2/rate/EUR/BRL', 'https://api.frankfurter.dev/v2/rate/USD/BRL?date=2026-01-10']);
    await expect(new FrankfurterExchangeRateSource({ fetchFn: async () => Promise.reject(new Error('x')) }).fetchRate('EUR', 'BRL')).rejects.toBeInstanceOf(ExchangeRateUnavailableError);
    await expect(new FrankfurterExchangeRateSource({ fetchFn: fetchReturning(422, {}) }).fetchRate('EUR', 'BRL')).rejects.toBeInstanceOf(ExchangeRateUnavailableError);
    await expect(new FrankfurterExchangeRateSource({ fetchFn: fetchReturning(200, { rate: 0 }) }).fetchRate('EUR', 'BRL')).rejects.toBeInstanceOf(ExchangeRateUnavailableError);
  });
});
