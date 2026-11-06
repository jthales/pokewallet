import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { FakeCatalog, FakeFx, FakePrices } from './fakes.js';

const prisma = new PrismaClient();
const catalog = new FakeCatalog();
const app = createApp({ prisma, catalog, prices: new FakePrices(), exchangeRates: new FakeFx() });

const baseItem = { externalId: 'swsh3-136', condition: 'NEAR_MINT', variant: 'NORMAL', language: 'pt' };

async function addFurret(quantity = 1, extra: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/collection/items').send({ ...baseItem, quantity, ...extra });
  expect(res.status).toBe(201);
  return res.body as { cardId: string; items: { id: string; status: string }[] };
}

beforeEach(async () => {
  catalog.down = false;
  await prisma.sale.deleteMany();
  await prisma.collectionItem.deleteMany();
  await prisma.cardCatalog.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Coleção', () => {
  it('cadastra vários exemplares e duplicatas reutilizando a mesma carta do catálogo', async () => {
    const first = await addFurret(2, { purchasePriceCents: 1250, acquiredAt: '2026-10-01' });
    const second = await addFurret(1, { condition: 'LIGHTLY_PLAYED', variant: 'REVERSE_HOLOFOIL' });
    expect(second.cardId).toBe(first.cardId);
    expect(await prisma.cardCatalog.count()).toBe(1);
    expect(await prisma.collectionItem.count()).toBe(3);

    const detail = await request(app).get(`/api/collection/cards/${first.cardId}`);
    expect(detail.body.counts).toEqual({ total: 3, available: 3, sold: 0 });
    expect(detail.body.items[0]).toMatchObject({ purchasePriceCents: 1250, currency: 'BRL', language: 'pt' });
    expect(detail.body.imageLargeUrl).toBe('https://assets.tcgdex.net/en/swsh/swsh3/136/high.webp');
  });

  it('valida os dados enviados', async () => {
    const res = await request(app).post('/api/collection/items').send({ ...baseItem, condition: 'NOVA', purchasePriceCents: 12.5 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const extra = await request(app).post('/api/collection/items').send({ ...baseItem, hacker: true });
    expect(extra.status).toBe(400);
  });

  it('retorna 404 para carta inexistente no catálogo', async () => {
    const res = await request(app).post('/api/collection/items').send({ ...baseItem, externalId: 'nada-1' });
    expect(res.status).toBe(404);
  });

  it('edita condição, variante e observações de um exemplar', async () => {
    const { items } = await addFurret();
    const res = await request(app)
      .patch(`/api/collection/items/${items[0]!.id}`)
      .send({ condition: 'MODERATELY_PLAYED', variant: 'HOLOFOIL', notes: 'Leve desgaste na borda' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ condition: 'MODERATELY_PLAYED', variant: 'HOLOFOIL', notes: 'Leve desgaste na borda' });
  });

  it('lista com filtros, busca sem acento e ordenação', async () => {
    await addFurret();
    await request(app).post('/api/collection/items').send({ ...baseItem, externalId: 'sv03.5-025' }).expect(201);
    const byName = await request(app).get('/api/collection/cards?sort=name');
    expect(byName.body.map((c: { name: string }) => c.name)).toEqual(['Furret', 'Pikachu']);
    const search = await request(app).get('/api/collection/cards?search=PIKÁ');
    expect(search.body).toHaveLength(1);
    const bySet = await request(app).get('/api/collection/cards?setId=swsh3');
    expect(bySet.body.map((c: { externalId: string }) => c.externalId)).toEqual(['swsh3-136']);
    const filters = await request(app).get('/api/collection/filters');
    expect(filters.body.rarities).toEqual(['Common', 'Uncommon']);
  });

  it('exclui um exemplar cadastrado por engano e remove a carta quando não sobra nenhum', async () => {
    const { items, cardId } = await addFurret();
    await request(app).delete(`/api/collection/items/${items[0]!.id}`).expect(204);
    expect(await prisma.cardCatalog.findUnique({ where: { id: cardId } })).toBeNull();
  });

  it('continua funcionando com a TCGdex fora do ar', async () => {
    const { cardId } = await addFurret();
    catalog.down = true;
    await request(app).get('/api/collection/cards').expect(200);
    await request(app).get(`/api/collection/cards/${cardId}`).expect(200);
    await request(app).get('/api/dashboard').expect(200);
    // Carta já salva localmente: novos exemplares ainda podem ser cadastrados.
    await addFurret();
    // Carta nova: não há como obter os dados, então responde 503 com mensagem clara.
    const res = await request(app).post('/api/collection/items').send({ ...baseItem, externalId: 'sv03.5-025' });
    expect(res.status).toBe(503);
    const search = await request(app).get('/api/catalog/cards?name=pika');
    expect(search.status).toBe(503);
    expect(search.body.error.code).toBe('CATALOG_UNAVAILABLE');
  });
});

describe('Vendas', () => {
  it('vender um exemplar mantém os outros disponíveis e preserva o histórico', async () => {
    const { items, cardId } = await addFurret(3);
    const sale = await request(app).post(`/api/collection/items/${items[0]!.id}/sale`).send({ soldAt: '2026-11-01', salePriceCents: 4590 });
    expect(sale.status).toBe(201);
    const detail = await request(app).get(`/api/collection/cards/${cardId}`);
    expect(detail.body.counts).toEqual({ total: 3, available: 2, sold: 1 });
    expect(detail.body.items.find((i: { id: string }) => i.id === items[0]!.id).activeSale.salePriceCents).toBe(4590);

    const list = await request(app).get('/api/sales');
    expect(list.body.totals).toMatchObject({ count: 1, revenueCents: 4590, currency: 'BRL' });
    expect(list.body.sales[0].card.name).toBe('Furret');

    const dash = await request(app).get('/api/dashboard');
    expect(dash.body).toMatchObject({ distinctCards: 1, totalItems: 3, availableItems: 2, soldItems: 1 });
  });

  it('impede vender o mesmo exemplar duas vezes', async () => {
    const { items } = await addFurret();
    const url = `/api/collection/items/${items[0]!.id}/sale`;
    await request(app).post(url).send({ soldAt: '2026-11-01', salePriceCents: 1000 }).expect(201);
    const again = await request(app).post(url).send({ soldAt: '2026-11-02', salePriceCents: 2000 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_SOLD');
    expect(await prisma.sale.count()).toBe(1);
  });

  it('impede venda duplicada mesmo com requisições simultâneas', async () => {
    const { items } = await addFurret();
    const url = `/api/collection/items/${items[0]!.id}/sale`;
    const results = await Promise.all([1, 2, 3].map(() => request(app).post(url).send({ soldAt: '2026-11-01', salePriceCents: 1000 })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await prisma.sale.count()).toBe(1);
  });

  it('corrige e desfaz uma venda', async () => {
    const { items } = await addFurret();
    const sale = await request(app).post(`/api/collection/items/${items[0]!.id}/sale`).send({ soldAt: '2026-11-01', salePriceCents: 1000 });
    const fixed = await request(app).patch(`/api/sales/${sale.body.id}`).send({ salePriceCents: 1500 });
    expect(fixed.body.salePriceCents).toBe(1500);

    await request(app).post(`/api/sales/${sale.body.id}/cancel`).expect(200);
    const item = await prisma.collectionItem.findUniqueOrThrow({ where: { id: items[0]!.id } });
    expect(item.status).toBe('AVAILABLE');
    // A venda desfeita continua no histórico, marcada como cancelada.
    const all = await request(app).get('/api/sales?includeCancelled=true');
    expect(all.body.sales[0].cancelledAt).not.toBeNull();
    expect((await request(app).get('/api/sales')).body.sales).toHaveLength(0);
    // Depois de desfeita, o exemplar pode ser vendido de novo.
    await request(app).post(`/api/collection/items/${items[0]!.id}/sale`).send({ soldAt: '2026-11-03', salePriceCents: 1200 }).expect(201);
  });
});

describe('Persistência', () => {
  it('mantém os registros após reiniciar o cliente do banco', async () => {
    const { items } = await addFurret(2);
    await request(app).post(`/api/collection/items/${items[0]!.id}/sale`).send({ soldAt: '2026-11-01', salePriceCents: 999 }).expect(201);

    const restarted = new PrismaClient();
    try {
      const freshApp = createApp({ prisma: restarted, catalog: new FakeCatalog(), prices: new FakePrices(), exchangeRates: new FakeFx() });
      const dash = await request(freshApp).get('/api/dashboard');
      expect(dash.body).toMatchObject({ distinctCards: 1, totalItems: 2, availableItems: 1, soldItems: 1 });
      expect((await request(freshApp).get('/api/sales')).body.totals.revenueCents).toBe(999);
    } finally {
      await restarted.$disconnect();
    }
  });
});

describe('Identificação via API', () => {
  it('retorna candidatos para o texto do OCR', async () => {
    const res = await request(app).post('/api/identify').send({ fullText: 'Furret HP 110\n136/189' });
    expect(res.status).toBe(200);
    expect(res.body.candidates[0].externalId).toBe('swsh3-136');
  });

  it('responde 503 quando a TCGdex está fora do ar', async () => {
    catalog.down = true;
    const res = await request(app).post('/api/identify').send({ fullText: 'Furret 136/189' });
    expect(res.status).toBe(503);
  });
});
