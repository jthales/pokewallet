import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { displayLanguageFor } from '../src/services/card-localization.js';
import { FakeCatalog, FakeFx, FakePrices } from './fakes.js';

const prisma = new PrismaClient();
const catalog = new FakeCatalog();
const app = createApp({ prisma, catalog, prices: new FakePrices(), exchangeRates: new FakeFx() });

const add = (externalId: string, language: string, extra: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/collection/items')
    .send({ externalId, condition: 'NEAR_MINT', variant: 'NORMAL', language, ...extra })
    .expect(201)
    .then((r) => r.body as { cardId: string; items: { id: string }[] });

beforeEach(async () => {
  catalog.down = false;
  await prisma.sale.deleteMany();
  await prisma.collectionItem.deleteMany();
  await prisma.cardCatalogLocalization.deleteMany();
  await prisma.cardCatalog.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Cartas em português na carteira', () => {
  it('exemplar em pt aparece com nome, expansão e imagem em pt', async () => {
    const { cardId } = await add('sv03.5-025', 'pt');
    const detail = await request(app).get(`/api/collection/cards/${cardId}`).expect(200);
    expect(detail.body).toMatchObject({
      name: 'Pikachu',
      setName: '151',
      displayLanguage: 'pt',
      imageUrl: 'https://assets.tcgdex.net/pt/sv/sv03.5/025/low.webp',
      imageLargeUrl: 'https://assets.tcgdex.net/pt/sv/sv03.5/025/high.webp',
      imageFallbackUrl: 'https://assets.tcgdex.net/en/sv/sv03.5/025/low.webp',
    });
    const list = await request(app).get('/api/collection/cards').expect(200);
    expect(list.body[0].imageUrl).toContain('/pt/');
    const dash = await request(app).get('/api/dashboard').expect(200);
    expect(dash.body.recentCards[0].imageUrl).toContain('/pt/');
  });

  it('usa a imagem em inglês quando a TCGdex não tem imagem em pt', async () => {
    const { cardId } = await add('swsh10-136', 'pt');
    const detail = await request(app).get(`/api/collection/cards/${cardId}`).expect(200);
    expect(detail.body).toMatchObject({
      name: 'Colônia Cancelante',
      baseName: 'Canceling Cologne',
      setName: 'Astros Radiantes',
      imageUrl: 'https://assets.tcgdex.net/en/swsh/swsh10/136/low.webp',
      imageLargeUrl: 'https://assets.tcgdex.net/en/swsh/swsh10/136/high.webp',
      imageFallbackUrl: null,
    });
    // A busca aceita o nome em pt e o nome em inglês.
    expect((await request(app).get('/api/collection/cards?search=colonia')).body).toHaveLength(1);
    expect((await request(app).get('/api/collection/cards?search=cologne')).body).toHaveLength(1);
    const filters = await request(app).get('/api/collection/filters');
    expect(filters.body.sets).toEqual([{ id: 'swsh10', name: 'Astros Radiantes' }]);
  });

  it('carta sem versão em pt continua em inglês e não é consultada de novo a cada acesso', async () => {
    const { cardId } = await add('swsh3-136', 'pt');
    const row = await prisma.cardCatalogLocalization.findFirstOrThrow({ where: { cardCatalogId: cardId } });
    expect(row.name).toBeNull();
    const calls = catalog.calls;
    const detail = await request(app).get(`/api/collection/cards/${cardId}`).expect(200);
    expect(detail.body).toMatchObject({ name: 'Furret', displayLanguage: 'en' });
    await request(app).get('/api/collection/cards').expect(200);
    expect(catalog.calls).toBe(calls);
  });

  it('exemplar em inglês continua em inglês', async () => {
    const { cardId } = await add('swsh10-136', 'en');
    const detail = await request(app).get(`/api/collection/cards/${cardId}`).expect(200);
    expect(detail.body).toMatchObject({ name: 'Canceling Cologne', displayLanguage: 'en' });
    expect(await prisma.cardCatalogLocalization.count()).toBe(0);
  });

  it('corrige exemplares em pt cadastrados antes (sem localização salva)', async () => {
    const { cardId } = await add('swsh10-136', 'pt');
    await prisma.cardCatalogLocalization.deleteMany();
    const list = await request(app).get('/api/collection/cards').expect(200);
    expect(list.body[0]).toMatchObject({ id: cardId, name: 'Colônia Cancelante' });
    expect(await prisma.cardCatalogLocalization.count()).toBe(1);
  });

  it('cadastra em pt mesmo com a TCGdex fora do ar ao buscar a versão em pt', async () => {
    await add('swsh10-136', 'en');
    catalog.down = true;
    const { cardId } = await add('swsh10-136', 'pt');
    expect((await request(app).get(`/api/collection/cards/${cardId}`).expect(200)).body.name).toBe('Canceling Cologne');
    catalog.down = false;
    // Na próxima visita, a versão em pt é obtida.
    expect((await request(app).get(`/api/collection/cards/${cardId}`).expect(200)).body.name).toBe('Colônia Cancelante');
  });

  it('mudar o idioma do exemplar para pt passa a mostrar a versão em pt', async () => {
    const { cardId, items } = await add('swsh10-136', 'en');
    await request(app).patch(`/api/collection/items/${items[0]!.id}`).send({ language: 'pt' }).expect(200);
    expect((await request(app).get(`/api/collection/cards/${cardId}`)).body.name).toBe('Colônia Cancelante');
  });

  it('vendas e carteira de investimentos mostram o nome no idioma do exemplar', async () => {
    const { items } = await add('swsh10-136', 'pt', { purchasePriceCents: 1000 });
    await request(app).post(`/api/collection/items/${items[0]!.id}/sale`).send({ soldAt: '2026-11-01', salePriceCents: 2000 }).expect(201);
    const sales = await request(app).get('/api/sales').expect(200);
    expect(sales.body.sales[0].card.name).toBe('Colônia Cancelante');
  });
});

describe('displayLanguageFor', () => {
  it('escolhe pt quando a maioria (ou metade) dos exemplares é em pt', () => {
    expect(displayLanguageFor([{ language: 'pt' }])).toBe('pt');
    expect(displayLanguageFor([{ language: 'pt' }, { language: 'en' }])).toBe('pt');
    expect(displayLanguageFor([{ language: 'pt' }, { language: 'en' }, { language: 'ja' }])).toBeNull();
    expect(displayLanguageFor([{ language: 'en' }])).toBeNull();
    expect(displayLanguageFor([])).toBeNull();
  });
});
