import { percent } from '../lib/decimal.js';

/**
 * Regras financeiras da carteira — funções puras, sem banco nem rede, todas em centavos inteiros de BRL.
 *
 * Convenções:
 * - Custo de aquisição ausente é `null`, NUNCA zero: o exemplar entra no patrimônio, mas não na rentabilidade.
 * - Rentabilidade percentual só existe com custo > 0.
 * - Exemplares vendidos saem do patrimônio e da valorização não realizada e entram só no lucro realizado.
 */

export type ValueSource = 'MARKET' | 'MANUAL';

export interface PortfolioItem {
  id: string;
  cardId: string;
  variant: string;
  status: 'AVAILABLE' | 'SOLD' | string;
  /** Custo de aquisição em centavos de BRL; null = desconhecido. */
  costCents: number | null;
  /** Valor atual estimado em centavos de BRL; null = sem cotação. */
  valueCents: number | null;
  valueSource: ValueSource | null;
  /** Venda ativa (não desfeita). */
  sale: { priceCents: number; feesCents: number | null; soldAt: Date } | null;
}

export interface Performance {
  costCents: number | null;
  valueCents: number | null;
  gainCents: number | null;
  gainPct: number | null;
}

/** Valorização absoluta e percentual de um exemplar. */
export function performance(costCents: number | null, valueCents: number | null): Performance {
  if (costCents === null || valueCents === null) return { costCents, valueCents, gainCents: null, gainPct: null };
  const gainCents = valueCents - costCents;
  return { costCents, valueCents, gainCents, gainPct: percent(gainCents, costCents) };
}

/** Resultado realizado de uma venda: valor bruto − custo de aquisição − custos da venda. Null sem custo conhecido. */
export function realizedResult(costCents: number | null, sale: { priceCents: number; feesCents: number | null }): number | null {
  if (costCents === null) return null;
  return sale.priceCents - costCents - (sale.feesCents ?? 0);
}

export interface PortfolioSummary {
  holdings: {
    items: number;
    /** Exemplares com valor de mercado (ou avaliação manual). */
    valued: number;
    /** Exemplares sem cotação nem avaliação manual. */
    unvalued: number;
    manualValued: number;
    withCost: number;
    withoutCost: number;
  };
  /** Soma do valor estimado dos exemplares disponíveis que têm valor. */
  estimatedValueCents: number;
  /** Soma do custo dos exemplares disponíveis com custo conhecido. */
  investedCents: number;
  unrealized: {
    /** Exemplares com custo E valor conhecidos. */
    eligibleItems: number;
    costBasisCents: number;
    valueCents: number;
    gainCents: number;
    gainPct: number | null;
  };
  realized: {
    sales: number;
    /** Vendas com custo de aquisição conhecido (entram no resultado). */
    eligibleSales: number;
    salesWithoutCost: number;
    grossCents: number;
    feesCents: number;
    costBasisCents: number;
    resultCents: number;
  };
  /** Lucro realizado + valorização não realizada (somente o que é conhecido). */
  totalKnownResultCents: number;
}

export function summarize(items: PortfolioItem[]): PortfolioSummary {
  const s: PortfolioSummary = {
    holdings: { items: 0, valued: 0, unvalued: 0, manualValued: 0, withCost: 0, withoutCost: 0 },
    estimatedValueCents: 0,
    investedCents: 0,
    unrealized: { eligibleItems: 0, costBasisCents: 0, valueCents: 0, gainCents: 0, gainPct: null },
    realized: { sales: 0, eligibleSales: 0, salesWithoutCost: 0, grossCents: 0, feesCents: 0, costBasisCents: 0, resultCents: 0 },
    totalKnownResultCents: 0,
  };
  for (const item of items) {
    if (item.status === 'SOLD') {
      if (!item.sale) continue; // vendido sem venda ativa não deveria existir; ignoramos para não contar em dobro
      s.realized.sales++;
      s.realized.grossCents += item.sale.priceCents;
      s.realized.feesCents += item.sale.feesCents ?? 0;
      const result = realizedResult(item.costCents, item.sale);
      if (result === null) {
        s.realized.salesWithoutCost++;
        continue;
      }
      s.realized.eligibleSales++;
      s.realized.costBasisCents += item.costCents!;
      s.realized.resultCents += result;
      continue;
    }
    s.holdings.items++;
    if (item.valueCents !== null) {
      s.holdings.valued++;
      if (item.valueSource === 'MANUAL') s.holdings.manualValued++;
      s.estimatedValueCents += item.valueCents;
    } else {
      s.holdings.unvalued++;
    }
    if (item.costCents !== null) {
      s.holdings.withCost++;
      s.investedCents += item.costCents;
    } else {
      s.holdings.withoutCost++;
    }
    if (item.costCents !== null && item.valueCents !== null) {
      s.unrealized.eligibleItems++;
      s.unrealized.costBasisCents += item.costCents;
      s.unrealized.valueCents += item.valueCents;
    }
  }
  s.unrealized.gainCents = s.unrealized.valueCents - s.unrealized.costBasisCents;
  s.unrealized.gainPct = percent(s.unrealized.gainCents, s.unrealized.costBasisCents);
  s.totalKnownResultCents = s.realized.resultCents + s.unrealized.gainCents;
  return s;
}

export type RankingSort = 'absolute' | 'percent';

/** Maiores valorizações e desvalorizações entre exemplares disponíveis com dados suficientes. */
export function rankings<T extends { status: string; perf: Performance }>(items: T[], sort: RankingSort, limit = 10) {
  const eligible = items.filter((i) => i.status === 'AVAILABLE' && i.perf.gainCents !== null && (sort === 'absolute' || i.perf.gainPct !== null));
  const key = (i: T) => (sort === 'absolute' ? i.perf.gainCents! : i.perf.gainPct!);
  const gainers = eligible.filter((i) => i.perf.gainCents! > 0).sort((a, b) => key(b) - key(a)).slice(0, limit);
  const losers = eligible.filter((i) => i.perf.gainCents! < 0).sort((a, b) => key(a) - key(b)).slice(0, limit);
  return { gainers, losers };
}

export interface HoldingForHistory {
  cardId: string;
  variant: string;
  /** Início da posse (YYYY-MM-DD: data de aquisição ou de cadastro). */
  fromDay: string;
  /** Dia da venda (a posse termina neste dia); null = ainda na coleção. */
  untilDay: string | null;
  costCents: number | null;
}

export interface HistoryPoint {
  date: string;
  /** Valor estimado dos exemplares em posse naquele dia com cotação conhecida até aquele dia. */
  valueCents: number;
  /** Custo dos exemplares acima que têm custo conhecido. */
  investedCents: number;
  /** Valor apenas dos exemplares com custo conhecido (para comparar com `investedCents`). */
  valueWithCostCents: number;
  items: number;
}

/**
 * Patrimônio histórico a partir dos snapshots persistidos.
 * - Os dias do gráfico são os dias em que houve captura real; nunca inventamos dias anteriores ao primeiro registro.
 * - Num dia D, o preço de uma carta/variante é o do último snapshot até D (o mesmo preço real, ainda vigente).
 * - Considera entradas (aquisição) e saídas (venda): só entram exemplares em posse em D.
 */
export function portfolioHistory(
  holdings: HoldingForHistory[],
  snapshots: { cardCatalogId: string; variant: string; capturedOn: Date; priceCents: number }[],
  fromDay?: string,
): HistoryPoint[] {
  const days = [...new Set(snapshots.map((s) => s.capturedOn.toISOString().slice(0, 10)))].sort();
  const byKey = new Map<string, { day: string; priceCents: number }[]>();
  for (const s of snapshots) {
    const key = `${s.cardCatalogId}|${s.variant}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push({ day: s.capturedOn.toISOString().slice(0, 10), priceCents: s.priceCents });
  }
  for (const list of byKey.values()) list.sort((a, b) => a.day.localeCompare(b.day));

  const priceOn = (key: string, day: string) => {
    const list = byKey.get(key);
    if (!list) return null;
    let price: number | null = null;
    for (const p of list) {
      if (p.day > day) break;
      price = p.priceCents;
    }
    return price;
  };

  const points: HistoryPoint[] = [];
  for (const day of days) {
    if (fromDay && day < fromDay) continue;
    const point: HistoryPoint = { date: day, valueCents: 0, investedCents: 0, valueWithCostCents: 0, items: 0 };
    for (const h of holdings) {
      if (h.fromDay > day) continue;
      if (h.untilDay && h.untilDay <= day) continue;
      const price = priceOn(`${h.cardId}|${h.variant}`, day);
      if (price === null) continue;
      point.items++;
      point.valueCents += price;
      if (h.costCents !== null) {
        point.investedCents += h.costCents;
        point.valueWithCostCents += price;
      }
    }
    if (point.items > 0) points.push(point);
  }
  return points;
}
