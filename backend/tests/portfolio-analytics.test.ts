import { describe, expect, it } from 'vitest';
import { convertCents, dayKey, percent } from '../src/lib/decimal.js';
import { performance, portfolioHistory, rankings, realizedResult, summarize, type PortfolioItem } from '../src/services/portfolio-analytics.js';

const item = (p: Partial<PortfolioItem>): PortfolioItem => ({
  id: Math.random().toString(36).slice(2),
  cardId: 'c1',
  variant: 'NORMAL',
  status: 'AVAILABLE',
  costCents: null,
  valueCents: null,
  valueSource: null,
  sale: null,
  ...p,
});

describe('Valorização de um exemplar', () => {
  it('valorização positiva (exemplo do Charizard: 150 → 220)', () => {
    expect(performance(15000, 22000)).toEqual({ costCents: 15000, valueCents: 22000, gainCents: 7000, gainPct: 46.67 });
  });

  it('desvalorização aparece negativa', () => {
    expect(performance(10000, 7550)).toMatchObject({ gainCents: -2450, gainPct: -24.5 });
  });

  it('custo ausente não é zero: sem valorização nem rentabilidade', () => {
    expect(performance(null, 22000)).toEqual({ costCents: null, valueCents: 22000, gainCents: null, gainPct: null });
  });

  it('preço de mercado indisponível: sem valorização', () => {
    expect(performance(15000, null)).toMatchObject({ gainCents: null, gainPct: null });
  });

  it('custo zero (carta ganha): valorização absoluta sim, percentual não', () => {
    expect(performance(0, 500)).toMatchObject({ gainCents: 500, gainPct: null });
  });

  it('percentual e conversão sem erro de ponto flutuante', () => {
    expect(percent(1, 3)).toBe(33.33);
    expect(convertCents(10, '0.1')).toBe(1);
    expect(convertCents(29, '5.4321')).toBe(158); // 0,29 USD × 5,4321 = 1,575309 → R$ 1,58
  });
});

describe('Resultado realizado', () => {
  it('venda − compra − custos (exemplo: 180 − 100 − 10 = 70)', () => {
    expect(realizedResult(10000, { priceCents: 18000, feesCents: 1000 })).toBe(7000);
    expect(realizedResult(10000, { priceCents: 18000, feesCents: null })).toBe(8000);
    expect(realizedResult(null, { priceCents: 18000, feesCents: 0 })).toBeNull();
  });
});

describe('Resumo da carteira', () => {
  it('separa realizado e não realizado, sem dupla contagem de cartas vendidas', () => {
    const s = summarize([
      item({ costCents: 15000, valueCents: 22000, valueSource: 'MARKET' }),
      item({ costCents: 10000, valueCents: 8000, valueSource: 'MARKET' }),
      item({ costCents: null, valueCents: 5000, valueSource: 'MARKET' }), // sem custo
      item({ costCents: 3000, valueCents: null }), // sem cotação
      item({ costCents: 1000, valueCents: 1200, valueSource: 'MANUAL' }),
      // vendido: valor de mercado é ignorado mesmo que venha preenchido
      item({ status: 'SOLD', costCents: 10000, valueCents: 99999, sale: { priceCents: 18000, feesCents: 1000, soldAt: new Date() } }),
      item({ status: 'SOLD', costCents: null, sale: { priceCents: 4000, feesCents: null, soldAt: new Date() } }),
    ]);
    expect(s.estimatedValueCents).toBe(22000 + 8000 + 5000 + 1200);
    expect(s.investedCents).toBe(15000 + 10000 + 3000 + 1000);
    expect(s.holdings).toEqual({ items: 5, valued: 4, unvalued: 1, manualValued: 1, withCost: 4, withoutCost: 1 });
    expect(s.unrealized).toEqual({ eligibleItems: 3, costBasisCents: 26000, valueCents: 31200, gainCents: 5200, gainPct: 20 });
    expect(s.realized).toEqual({ sales: 2, eligibleSales: 1, salesWithoutCost: 1, grossCents: 22000, feesCents: 1000, costBasisCents: 10000, resultCents: 7000 });
    expect(s.totalKnownResultCents).toBe(7000 + 5200);
  });

  it('carteira vazia não gera percentuais inventados', () => {
    const s = summarize([]);
    expect(s.unrealized.gainPct).toBeNull();
    expect(s.totalKnownResultCents).toBe(0);
  });
});

describe('Ranking', () => {
  const list = [
    { status: 'AVAILABLE', name: 'a', perf: performance(100, 300) }, // +200, +200%
    { status: 'AVAILABLE', name: 'b', perf: performance(10000, 11000) }, // +1000, +10%
    { status: 'AVAILABLE', name: 'c', perf: performance(5000, 1000) }, // −4000, −80%
    { status: 'AVAILABLE', name: 'd', perf: performance(null, 1000) }, // sem custo
    { status: 'SOLD', name: 'e', perf: performance(1, 999999) },
  ];
  it('ordena por ganho absoluto ou percentual e ignora quem não tem dados', () => {
    expect(rankings(list, 'absolute').gainers.map((i) => i.name)).toEqual(['b', 'a']);
    expect(rankings(list, 'percent').gainers.map((i) => i.name)).toEqual(['a', 'b']);
    expect(rankings(list, 'absolute').losers.map((i) => i.name)).toEqual(['c']);
  });
});

describe('Patrimônio histórico', () => {
  const snap = (day: string, cardId: string, variant: string, priceCents: number) => ({ cardCatalogId: cardId, variant, capturedOn: new Date(`${day}T00:00:00Z`), priceCents });
  it('usa só dias com registros reais e considera entradas e saídas', () => {
    const points = portfolioHistory(
      [
        { cardId: 'a', variant: 'NORMAL', fromDay: '2026-01-01', untilDay: null, costCents: 1000 },
        { cardId: 'b', variant: 'NORMAL', fromDay: '2026-11-03', untilDay: null, costCents: null }, // entrou no dia 3
        { cardId: 'a', variant: 'NORMAL', fromDay: '2026-01-01', untilDay: '2026-11-03', costCents: 500 }, // vendido no dia 3
      ],
      [snap('2026-11-02', 'a', 'NORMAL', 2000), snap('2026-11-03', 'b', 'NORMAL', 700), snap('2026-11-04', 'a', 'NORMAL', 2500), snap('2026-11-04', 'a', 'HOLOFOIL', 99999)],
    );
    expect(points).toEqual([
      { date: '2026-11-02', valueCents: 4000, investedCents: 1500, valueWithCostCents: 4000, items: 2 },
      { date: '2026-11-03', valueCents: 2700, investedCents: 1000, valueWithCostCents: 2000, items: 2 },
      { date: '2026-11-04', valueCents: 3200, investedCents: 1000, valueWithCostCents: 2500, items: 2 },
    ]);
  });

  it('dia civil no fuso de São Paulo', () => {
    expect(dayKey(new Date('2026-11-06T01:30:00Z'))).toBe('2026-11-05');
  });
});
