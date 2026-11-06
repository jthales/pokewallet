import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ExchangeRateService } from '../src/services/exchange-rate.service.js';
import { Clock, FakeCatalog, FakeFx, FakePrices } from './fakes.js';

const prisma = new PrismaClient();
let clock: Clock;
let prices: FakePrices;
let fx: FakeFx;
let app: ReturnType<typeof createApp>;

const FURRET = 'swsh3-136';
const PIKACHU = 'sv03.5-025';

async function add(externalId: string, extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/collection/items')
    .send({ externalId, condition: 'NEAR_MINT', variant: 'NORMAL', language: 'pt', ...extra });
  expect(res.status).toBe(201);
  return res.body as { cardId: string; items: { id: string }[] };
}

const portfolio = async () => (await request(app).get('/api/portfolio').expect(200)).body;

beforeEach(async () => {
  await prisma.sale.deleteMany();
  await prisma.collectionItem.deleteMany();
  await prisma.cardPriceSnapshot.deleteMany();
  await prisma.cardCatalog.deleteMany();
  await prisma.exchangeRate.deleteMany();
  await prisma.appSetting.deleteMany();
  clock = new Clock();
  prices = new FakePrices();
  fx = new FakeFx();
  // Furret: normal e reverse têm preços diferentes nas duas fontes.
  prices.set(FURRET, [
    { marketplace: 'cardmarket', variant: 'NORMAL', currency: 'EUR', price: '10.00', field: 'trend' },
    { marketplace: 'cardmarket', variant: 'REVERSE_HOLOFOIL', currency: 'EUR', price: '25.00', field: 'trend-holo' },
    { marketplace: 'tcgplayer', variant: 'NORMAL', currency: 'USD', price: '20.00', field: 'normal.marketPrice' },
  ]);
  app = createApp({ prisma, catalog: new FakeCatalog(), prices, exchangeRates: fx, priceOptions: { now: clock.now } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Câmbio (ExchangeRateService)', () => {
  it('converte EUR e USD para BRL com Decimal e guarda a cotação usada', async () => {
    fx.rates = { EUR: '6.1234', USD: '5.4321' };
    const service = new ExchangeRateService(prisma, fx, { now: clock.now });
    const eur = await service.latest('EUR');
    const usd = await service.latest('USD');
    expect(ExchangeRateService.toBRL('0.05', eur.rate).toString()).toBe('0.31');
    expect(ExchangeRateService.toBRL('11.69', usd.rate).toString()).toBe('63.5');
    expect(ExchangeRateService.toBRL('0.1', eur.rate).plus(ExchangeRateService.toBRL('0.2', eur.rate)).toString()).toBe('1.83');
    expect((await service.latest('BRL')).rate.toString()).toBe('1');
    const saved = await prisma.exchangeRate.findMany({ orderBy: { base: 'asc' } });
    expect(saved.map((r) => [r.base, r.quote, r.rate.toString(), r.rateDate.toISOString().slice(0, 10)])).toEqual([
      ['EUR', 'BRL', '6.1234', '2026-11-05'],
      ['USD', 'BRL', '5.4321', '2026-11-05'],
    ]);
  });

  it('cache diário: só consulta a fonte de novo depois de 24 h', async () => {
    const service = new ExchangeRateService(prisma, fx, { now: clock.now });
    await service.latest('EUR');
    clock.advanceHours(23);
    await service.latest('EUR');
    expect(fx.calls).toHaveLength(1);
    clock.advanceHours(2);
    await service.latest('EUR');
    expect(fx.calls).toHaveLength(2);
  });

  it('fora do ar: reutiliza a última cotação válida marcada como desatualizada; sem nenhuma, falha', async () => {
    const service = new ExchangeRateService(prisma, fx, { now: clock.now });
    fx.down = true;
    await expect(service.latest('USD')).rejects.toThrow();
    fx.down = false;
    await service.latest('USD');
    clock.advanceHours(30);
    fx.down = true;
    const r = await service.latest('USD');
    expect(r.stale).toBe(true);
    expect(r.rate.toString()).toBe('5.5');
  });
});

describe('Carteira', () => {
  it('ao adicionar uma carta já busca a cotação: uma consulta para vários exemplares', async () => {
    await add(FURRET, { quantity: 3, purchasePriceCents: 5000 });
    expect(prices.calls).toEqual([FURRET]);
    const body = await portfolio();
    expect(prices.calls).toEqual([FURRET]); // ainda dentro das 24 h: nada de nova consulta
    expect(body.priceSource).toBe('cardmarket');
    expect(body.summary.estimatedValueCents).toBe(3 * 6000); // 10 EUR × 6,00
    expect(body.summary.investedCents).toBe(15000);
    expect(body.summary.unrealized).toMatchObject({ gainCents: 3000, gainPct: 20 });
    expect(body.meta).toMatchObject({ unpricedItems: 0, staleItems: 0 });
    expect(body.meta.fx.EUR).toMatchObject({ rate: '6', rateDate: '2026-11-05' });
    expect(body.rankings.gainers).toHaveLength(3);
  });

  it('preço por variante: reverse holo tem preço próprio; variante sem cotação fica indisponível', async () => {
    const { cardId } = await add(FURRET, { purchasePriceCents: 10000 });
    await add(FURRET, { variant: 'REVERSE_HOLOFOIL', purchasePriceCents: 10000 });
    await add(FURRET, { variant: 'HOLOFOIL', purchasePriceCents: 10000 });
    const perf = (await request(app).get(`/api/portfolio/cards/${cardId}`).expect(200)).body;
    const byVariant = Object.fromEntries(perf.items.map((i: { variant: string }) => [i.variant, i]));
    expect(byVariant['NORMAL']).toMatchObject({ valueCents: 6000, gainCents: -4000, gainPct: -40, valueSource: 'MARKET' });
    expect(byVariant['REVERSE_HOLOFOIL']).toMatchObject({ valueCents: 15000, gainCents: 5000, gainPct: 50 });
    expect(byVariant['HOLOFOIL']).toMatchObject({ valueCents: null, quote: null, gainCents: null });
    expect(perf.history['NORMAL']).toHaveLength(1);
    const body = await portfolio();
    expect(body.meta.unpricedItems).toBe(1);
    expect(body.summary.holdings).toMatchObject({ items: 3, valued: 2, unvalued: 1 });
    // Patrimônio só soma o que tem cotação; o investido inclui também o exemplar sem cotação.
    expect(body.summary.estimatedValueCents).toBe(21000);
    expect(body.summary.investedCents).toBe(30000);
    expect(body.summary.unrealized).toMatchObject({ costBasisCents: 20000, gainCents: 1000, gainPct: 5 });
  });

  it('avaliação manual só para exemplar sem cotação, identificada como manual', async () => {
    const { cardId, items } = await add(FURRET, { variant: 'HOLOFOIL', purchasePriceCents: 1000 });
    await request(app).patch(`/api/collection/items/${items[0]!.id}`).send({ manualValueCents: 1500 }).expect(200);
    const perf = (await request(app).get(`/api/portfolio/cards/${cardId}`)).body;
    expect(perf.items[0]).toMatchObject({ valueCents: 1500, valueSource: 'MANUAL', gainCents: 500 });
    expect((await portfolio()).summary.holdings.manualValued).toBe(1);
  });

  it('fonte de referência configurável (TCGplayer) sem misturar marketplaces', async () => {
    await add(FURRET, { purchasePriceCents: 10000 });
    await add(FURRET, { variant: 'REVERSE_HOLOFOIL' });
    await request(app).put('/api/settings').send({ priceSource: 'tcgplayer' }).expect(200);
    const body = await portfolio();
    expect(body.priceSource).toBe('tcgplayer');
    expect(body.summary.estimatedValueCents).toBe(11000); // 20 USD × 5,50; reverse não tem preço na TCGplayer
    expect(body.meta.unpricedItems).toBe(1);
    await request(app).put('/api/settings').send({ priceSource: 'ebay' }).expect(400);
  });

  it('custo de aquisição ausente: entra no patrimônio, não na rentabilidade', async () => {
    await add(FURRET);
    const body = await portfolio();
    expect(body.summary.estimatedValueCents).toBe(6000);
    expect(body.summary.investedCents).toBe(0);
    expect(body.summary.holdings.withoutCost).toBe(1);
    expect(body.summary.unrealized).toMatchObject({ eligibleItems: 0, gainCents: 0, gainPct: null });
    expect(body.rankings.gainers).toEqual([]);
  });

  it('preço indisponível: carta sem cotação não entra no patrimônio', async () => {
    await add(PIKACHU, { purchasePriceCents: 500 });
    const body = await portfolio();
    expect(body.summary.estimatedValueCents).toBe(0);
    expect(body.meta.unpricedItems).toBe(1);
    expect((await prisma.cardCatalog.findFirst())!.pricesStatus).toBe('NO_PRICING');
  });

  it('venda de um exemplar duplicado: sai do não realizado e vira lucro realizado, preservando a compra', async () => {
    const { items } = await add(FURRET, { quantity: 2, purchasePriceCents: 4000 });
    await request(app).post(`/api/collection/items/${items[0]!.id}/sale`).send({ soldAt: '2026-11-05', salePriceCents: 9000, feesCents: 500 }).expect(201);
    const body = await portfolio();
    expect(body.summary.holdings.items).toBe(1);
    expect(body.summary.estimatedValueCents).toBe(6000);
    expect(body.summary.investedCents).toBe(4000);
    expect(body.summary.unrealized.gainCents).toBe(2000);
    expect(body.summary.realized).toMatchObject({ sales: 1, eligibleSales: 1, grossCents: 9000, feesCents: 500, resultCents: 4500 });
    expect(body.summary.totalKnownResultCents).toBe(6500);
    const sold = await prisma.collectionItem.findUnique({ where: { id: items[0]!.id } });
    expect(sold).toMatchObject({ status: 'SOLD', purchasePriceCents: 4000 });
    expect(await prisma.cardPriceSnapshot.count()).toBeGreaterThan(0);

    const sales = (await request(app).get('/api/sales')).body;
    expect(sales.totals).toMatchObject({ realizedCents: 4500, feesCents: 500 });
    expect(sales.sales[0]).toMatchObject({ feesCents: 500, realizedCents: 4500 });

    // Desfazer a venda devolve o exemplar ao não realizado.
    await request(app).post(`/api/sales/${sales.sales[0].id}/cancel`).expect(200);
    const after = await portfolio();
    expect(after.summary.realized.sales).toBe(0);
    expect(after.summary.holdings.items).toBe(2);
  });

  it('não duplica snapshots no mesmo dia, fornecedor e variante; cria um novo no dia seguinte', async () => {
    const { cardId } = await add(FURRET);
    const since = new Date(clock.current.getTime() + 1000);
    clock.advanceHours(1);
    prices.set(FURRET, [{ marketplace: 'cardmarket', variant: 'NORMAL', currency: 'EUR', price: '11.00', field: 'trend' }]);
    await request(app).post('/api/portfolio/refresh').send({ since }).expect(200);
    const sameDay = await prisma.cardPriceSnapshot.findMany({ where: { cardCatalogId: cardId, provider: 'cardmarket', variant: 'NORMAL' } });
    expect(sameDay).toHaveLength(1);
    expect(sameDay[0]!.marketPrice.toString()).toBe('11');
    expect(sameDay[0]!.priceBRL.toString()).toBe('66');
    expect(sameDay[0]).toMatchObject({ currency: 'EUR', priceField: 'trend' });
    expect(sameDay[0]!.exchangeRate.toString()).toBe('6');

    clock.advanceHours(25);
    await portfolio();
    expect(await prisma.cardPriceSnapshot.count({ where: { cardCatalogId: cardId, provider: 'cardmarket', variant: 'NORMAL' } })).toBe(2);
    const history = (await request(app).get('/api/portfolio/history?period=all')).body;
    expect(history.points.map((p: { valueCents: number }) => p.valueCents)).toEqual([6600, 6600]);
    expect(history.buildingHistory).toBe(false);
  });

  it('falha da TCGdex preserva o último preço e sinaliza cotação desatualizada', async () => {
    await add(FURRET, { purchasePriceCents: 5000 });
    clock.advanceHours(50);
    prices.down = true;
    const body = await portfolio();
    expect(body.sync).toMatchObject({ checked: 1, failed: 1 });
    expect(body.summary.estimatedValueCents).toBe(6000);
    expect(body.meta.staleItems).toBe(1);
    // Não insiste a cada acesso enquanto está fora do ar.
    await portfolio();
    expect(prices.calls).toHaveLength(2);
  });

  it('falha da Frankfurter: usa o último câmbio salvo; sem nenhum câmbio, não grava preço convertido errado', async () => {
    fx.down = true;
    const { cardId } = await add(FURRET);
    expect(await prisma.cardPriceSnapshot.count()).toBe(0);
    expect((await prisma.cardCatalog.findUnique({ where: { id: cardId } }))!.pricesStatus).toBe('ERROR');
    fx.down = false;
    await request(app).post('/api/portfolio/refresh').send({ since: new Date(clock.current.getTime() + 1) }).expect(200);
    expect(await prisma.cardPriceSnapshot.count()).toBe(3);
    clock.advanceHours(30);
    fx.down = true;
    const r = (await request(app).post('/api/portfolio/refresh').send({ since: new Date(clock.current.getTime() + 1) })).body;
    expect(r.fx.EUR).toMatchObject({ stale: true, rate: '6' });
  });

  it('cotações antigas: ficam marcadas como desatualizadas e são renovadas após 24 h', async () => {
    await add(FURRET);
    clock.advanceHours(10);
    expect((await portfolio()).sync.checked).toBe(0);
    clock.advanceHours(15);
    const body = await portfolio();
    expect(body.sync.checked).toBe(1);
    expect(prices.calls).toHaveLength(2);
  });

  it('preço pago em dólar é convertido pelo câmbio da data de aquisição', async () => {
    fx.rates = { EUR: '6.00', USD: '5.00' };
    const { items } = await add(FURRET, { purchasePriceCents: 1000, currency: 'USD', acquiredAt: '2026-01-10' });
    const body = await portfolio();
    expect(body.summary.investedCents).toBe(5000);
    expect(fx.calls).toContainEqual({ base: 'USD', date: '2026-01-10' });
    const saved = await prisma.collectionItem.findUnique({ where: { id: items[0]!.id } });
    expect(saved!.purchaseFxRate!.toString()).toBe('5');
  });

  it('a lista da coleção mostra o valor estimado por carta', async () => {
    const { cardId } = await add(FURRET, { quantity: 2 });
    const values = (await request(app).get('/api/portfolio/cards')).body;
    expect(values.cards[cardId]).toEqual({ valueCents: 12000, valued: 2, unvalued: 0, stale: false });
  });
});
