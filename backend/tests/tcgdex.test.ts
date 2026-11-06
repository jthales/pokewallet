import { describe, expect, it, vi } from 'vitest';
import { CatalogUnavailableError } from '../src/integrations/catalog-provider.js';
import { buildCardImage, buildSetAssetUrl } from '../src/integrations/tcgdex/tcgdex-assets.js';
import { TcgdexCatalogService, type FetchLike } from '../src/integrations/tcgdex/tcgdex-catalog.service.js';

const furret = {
  category: 'Pokemon',
  id: 'swsh3-136',
  illustrator: 'tetsuya koizumi',
  image: 'https://assets.tcgdex.net/en/swsh/swsh3/136',
  localId: '136',
  name: 'Furret',
  rarity: 'Uncommon',
  set: {
    cardCount: { official: 189, total: 201 },
    id: 'swsh3',
    logo: 'https://assets.tcgdex.net/en/swsh/swsh3/logo',
    name: 'Darkness Ablaze',
    symbol: 'https://assets.tcgdex.net/univ/swsh/swsh3/symbol',
  },
  variants: { firstEdition: false, holo: false, normal: true, reverse: true, wPromo: false },
};

function fakeFetch(routes: Record<string, { status: number; body?: unknown }>) {
  return vi.fn<FetchLike>(async (url: string) => {
    const path = url.replace('https://api.tcgdex.net/v2', '');
    const route = routes[path] ?? (path.startsWith('/en/series/') ? { status: 200, body: { id: 'tcgp', name: 'Pocket', sets: [{ id: 'A1', name: 'Genetic Apex' }] } } : { status: 404, body: {} });
    return { ok: route.status < 400, status: route.status, json: async () => route.body };
  });
}

describe('TcgdexCatalogService', () => {
  it('converte a carta e monta URLs de imagem a partir da URL-base', async () => {
    const service = new TcgdexCatalogService({ fetchFn: fakeFetch({ '/en/cards/swsh3-136': { status: 200, body: furret } }) });
    const card = await service.getCardById('swsh3-136');
    expect(card).toMatchObject({
      externalId: 'swsh3-136',
      localNumber: '136',
      rarity: 'Uncommon',
      language: 'en',
      image: { small: 'https://assets.tcgdex.net/en/swsh/swsh3/136/low.webp', large: 'https://assets.tcgdex.net/en/swsh/swsh3/136/high.webp' },
      set: { externalId: 'swsh3', officialCount: 189, logoUrl: 'https://assets.tcgdex.net/en/swsh/swsh3/logo.webp' },
    });
  });

  it('usa cache para consultas repetidas', async () => {
    const fetchFn = fakeFetch({ '/en/cards/swsh3-136': { status: 200, body: furret } });
    const service = new TcgdexCatalogService({ fetchFn });
    await service.getCardById('swsh3-136');
    await service.getCardById('swsh3-136');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('faz fallback para inglês quando a carta não existe em português', async () => {
    const service = new TcgdexCatalogService({ fetchFn: fakeFetch({ '/en/cards/swsh3-136': { status: 200, body: furret } }) });
    const card = await service.getCardById('swsh3-136', 'pt');
    expect(card?.language).toBe('en');
  });

  it('retorna null para 404', async () => {
    const service = new TcgdexCatalogService({ fetchFn: fakeFetch({}) });
    expect(await service.getCardById('nao-existe')).toBeNull();
  });

  it('rejeita respostas fora do formato esperado', async () => {
    const service = new TcgdexCatalogService({ fetchFn: fakeFetch({ '/en/cards/x-1': { status: 200, body: { id: 'x-1' } } }) });
    await expect(service.getCardById('x-1')).rejects.toBeInstanceOf(CatalogUnavailableError);
  });

  it('converte falha de rede e erro 5xx em CatalogUnavailableError', async () => {
    const offline = new TcgdexCatalogService({ fetchFn: async () => { throw new TypeError('fetch failed'); } });
    await expect(offline.getSets()).rejects.toBeInstanceOf(CatalogUnavailableError);
    const broken = new TcgdexCatalogService({ fetchFn: fakeFetch({ '/en/sets': { status: 503 } }) });
    await expect(broken.getSets()).rejects.toBeInstanceOf(CatalogUnavailableError);
  });

  it('busca com filtros e ignora cartas digitais (TCG Pocket)', async () => {
    const fetchFn = fakeFetch({
      '/en/cards?name=Pikachu&localId=025&pagination%3Apage=1&pagination%3AitemsPerPage=30': {
        status: 200,
        body: [
          { id: 'sv03.5-025', localId: '025', name: 'Pikachu', image: 'https://assets.tcgdex.net/en/sv/sv03.5/025' },
          { id: 'A1-025', localId: '025', name: 'Pikachu', image: 'https://assets.tcgdex.net/en/tcgp/A1/025' },
          { id: '2021swsh-25', localId: '25', name: 'Pikachu' },
        ],
      },
    });
    const service = new TcgdexCatalogService({ fetchFn });
    const cards = await service.searchCards({ name: 'Pikachu', localNumber: '025' });
    expect(cards.map((c) => c.externalId)).toEqual(['sv03.5-025', '2021swsh-25']);
    expect(cards[1]).toMatchObject({ setId: '2021swsh', image: null });
  });
});

describe('tcgdex assets', () => {
  it('só monta URLs quando a base tem o formato esperado', () => {
    expect(buildCardImage('https://assets.tcgdex.net/en/swsh/swsh3/136')?.small).toBe('https://assets.tcgdex.net/en/swsh/swsh3/136/low.webp');
    expect(buildCardImage('https://assets.tcgdex.net/en/swsh/swsh3/136/high.png')).toBeNull();
    expect(buildCardImage('https://evil.example.com/en/swsh/swsh3/136')).toBeNull();
    expect(buildCardImage(undefined)).toBeNull();
    expect(buildSetAssetUrl('https://assets.tcgdex.net/en/swsh/swsh3/logo')).toBe('https://assets.tcgdex.net/en/swsh/swsh3/logo.webp');
  });
});
