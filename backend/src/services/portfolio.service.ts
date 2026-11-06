import type { CardCatalog, CardCatalogLocalization, CardPriceSnapshot, CollectionItem, PrismaClient, Sale } from '@prisma/client';
import { MARKETPLACES, type Marketplace } from '../integrations/market-price-provider.js';
import { notFound } from '../lib/errors.js';
import { convertCents, dateToDay, dayKey, decimalToCents } from '../lib/decimal.js';
import type { ExchangeRateService, SupportedCurrency } from './exchange-rate.service.js';
import type { PriceHistoryService } from './price-history.service.js';
import { performance, portfolioHistory, rankings, realizedResult, summarize, type Performance, type PortfolioItem, type RankingSort, type ValueSource } from './portfolio-analytics.js';
import type { SettingsService } from './settings.service.js';
import { localizeCard } from './card-localization.js';

export const PERIODS = { '7d': 7, '30d': 30, '90d': 90, '1y': 365, all: null } as const;
export type Period = keyof typeof PERIODS;

export const DISCLAIMER =
  'Cotações são referências de mercado (TCGdex: Cardmarket/TCGplayer), não ofertas garantidas de compra ou venda. ' +
  'Não há ajuste pela condição física do exemplar, que pode valer mais ou menos que a referência.';

type ItemRow = CollectionItem & { cardCatalog: CardCatalog & { localizations: CardCatalogLocalization[] }; sales: Sale[] };

export interface QuoteView {
  marketplace: string;
  variant: string;
  currency: string;
  marketPrice: string;
  priceField: string;
  priceCents: number;
  exchangeRate: string;
  exchangeRateDate: string;
  sourceUpdatedAt: Date | null;
  capturedAt: Date;
  stale: boolean;
}

export interface ItemValuation extends PortfolioItem {
  card: { id: string; name: string; setName: string; localNumber: string; imageUrl: string | null; imageFallbackUrl: string | null };
  condition: string;
  acquiredAt: Date | null;
  purchasePriceCents: number | null;
  purchaseCurrency: string;
  purchaseFxRate: string | null;
  manualValueCents: number | null;
  manualValueAt: Date | null;
  quote: QuoteView | null;
  perf: Performance;
  realizedCents: number | null;
}

export class PortfolioService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly history: PriceHistoryService,
    private readonly settings: SettingsService,
    private readonly fx: ExchangeRateService,
    private readonly options: { now?: () => Date; staleAfterMs?: number } = {},
  ) {}

  private now() {
    return this.options.now?.() ?? new Date();
  }

  async summary(sort: RankingSort = 'absolute') {
    const { priceSource } = await this.settings.get();
    const items = await this.valuations({}, priceSource);
    const summary = summarize(items);
    const available = items.filter((i) => i.status === 'AVAILABLE');
    const checked = await this.prisma.cardCatalog.aggregate({ where: { items: { some: { status: 'AVAILABLE' } } }, _max: { pricesCheckedAt: true } });
    const rank = rankings(available, sort);
    return {
      currency: 'BRL',
      priceSource,
      summary,
      rankings: { sort, gainers: rank.gainers.map(rankingView), losers: rank.losers.map(rankingView) },
      meta: {
        lastUpdatedAt: checked._max.pricesCheckedAt,
        unpricedItems: available.filter((i) => !i.quote).length,
        staleItems: available.filter((i) => i.quote?.stale).length,
        fx: await this.fxInfo(),
        disclaimer: DISCLAIMER,
      },
    };
  }

  /** Valor estimado atual por carta (exemplares disponíveis), para a lista da coleção. */
  async cardValues() {
    const { priceSource } = await this.settings.get();
    const items = await this.valuations({ status: 'AVAILABLE' }, priceSource);
    const out: Record<string, { valueCents: number; valued: number; unvalued: number; stale: boolean }> = {};
    for (const i of items) {
      const v = (out[i.cardId] ??= { valueCents: 0, valued: 0, unvalued: 0, stale: false });
      if (i.valueCents === null) v.unvalued++;
      else {
        v.valued++;
        v.valueCents += i.valueCents;
      }
      if (i.quote?.stale) v.stale = true;
    }
    return { priceSource, cards: out };
  }

  async cardPerformance(cardId: string) {
    const card = await this.prisma.cardCatalog.findUnique({ where: { id: cardId } });
    if (!card) throw notFound('Carta');
    const { priceSource } = await this.settings.get();
    const items = await this.valuations({ cardCatalogId: cardId }, priceSource);
    const quotes: Record<string, QuoteView[]> = {};
    for (const m of MARKETPLACES) {
      const latest = (await this.history.latest([cardId], m)).get(cardId);
      quotes[m] = [...(latest?.values() ?? [])].map((s) => this.quoteView(s, card));
    }
    const series = await this.history.series([cardId], priceSource);
    const byVariant: Record<string, { date: string; priceCents: number; marketPrice: string; currency: string; exchangeRate: string }[]> = {};
    for (const s of series) {
      (byVariant[s.variant] ??= []).push({
        date: dateToDay(s.capturedOn),
        priceCents: decimalToCents(s.priceBRL),
        marketPrice: s.marketPrice.toString(),
        currency: s.currency,
        exchangeRate: s.exchangeRate.toString(),
      });
    }
    const held = items.filter((i) => i.status === 'AVAILABLE');
    return {
      cardId,
      currency: 'BRL',
      priceSource,
      pricesCheckedAt: card.pricesCheckedAt,
      pricesStatus: card.pricesStatus,
      quotes,
      history: byVariant,
      items: items.map(itemView),
      summary: summarize(items),
      heldVariants: [...new Set(held.map((i) => i.variant))],
      disclaimer: DISCLAIMER,
    };
  }

  async portfolioHistory(period: Period) {
    const { priceSource } = await this.settings.get();
    const items = await this.valuations({}, priceSource);
    const cardIds = [...new Set(items.map((i) => i.cardId))];
    const snapshots = await this.history.series(cardIds, priceSource);
    const days = PERIODS[period];
    const fromDay = days === null ? undefined : dayKey(new Date(this.now().getTime() - (days - 1) * 86_400_000));
    const holdings = items
      .filter((i) => i.status === 'AVAILABLE' || i.sale)
      .map((i) => ({
        cardId: i.cardId,
        variant: i.variant,
        fromDay: i.acquiredAt ? dateToDay(i.acquiredAt) : dayKey(i.createdAt),
        untilDay: i.sale ? dateToDay(i.sale.soldAt) : null,
        costCents: i.costCents,
      }));
    const points = portfolioHistory(
      holdings,
      snapshots.map((s) => ({ cardCatalogId: s.cardCatalogId, variant: s.variant, capturedOn: s.capturedOn, priceCents: decimalToCents(s.priceBRL) })),
      fromDay,
    );
    return {
      period,
      priceSource,
      currency: 'BRL',
      firstSnapshotDay: snapshots[0] ? dateToDay(snapshots[0].capturedOn) : null,
      buildingHistory: points.length < 2,
      points,
      note: 'O patrimônio também cresce com novas aquisições, não só por valorização. Compare com o capital aplicado.',
    };
  }

  /** Carrega exemplares e calcula custo em BRL, valor estimado e desempenho de cada um. */
  private async valuations(where: { status?: string; cardCatalogId?: string }, marketplace: Marketplace): Promise<(ItemValuation & { createdAt: Date })[]> {
    const rows: ItemRow[] = await this.prisma.collectionItem.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: { cardCatalog: { include: { localizations: true } }, sales: { where: { cancelledAt: null } } },
    });
    await this.resolveForeignCosts(rows);
    const latest = await this.history.latest([...new Set(rows.map((r) => r.cardCatalogId))], marketplace);
    return rows.map((r) => {
      const snap = latest.get(r.cardCatalogId)?.get(r.variant) ?? null;
      const quote = snap ? this.quoteView(snap, r.cardCatalog) : null;
      let valueCents: number | null = null;
      let valueSource: ValueSource | null = null;
      if (quote) {
        valueCents = quote.priceCents;
        valueSource = 'MARKET';
      } else if (r.manualValueCents !== null) {
        valueCents = r.manualValueCents;
        valueSource = 'MANUAL';
      }
      const costCents = costInBRL(r);
      const active = r.sales[0] ?? null;
      const sale = r.status === 'SOLD' && active ? { priceCents: active.salePriceCents, feesCents: active.feesCents, soldAt: active.soldAt } : null;
      const loc = localizeCard(r.cardCatalog, r.cardCatalog.localizations, r.language);
      return {
        id: r.id,
        cardId: r.cardCatalogId,
        card: { id: r.cardCatalog.id, name: loc.name, setName: loc.setName, localNumber: r.cardCatalog.localNumber, imageUrl: loc.imageUrl, imageFallbackUrl: loc.imageFallbackUrl },
        variant: r.variant,
        condition: r.condition,
        status: r.status,
        acquiredAt: r.acquiredAt,
        createdAt: r.createdAt,
        purchasePriceCents: r.purchasePriceCents,
        purchaseCurrency: r.currency,
        purchaseFxRate: r.purchaseFxRate?.toString() ?? null,
        manualValueCents: r.manualValueCents,
        manualValueAt: r.manualValueAt,
        costCents,
        valueCents: r.status === 'SOLD' ? null : valueCents,
        valueSource: r.status === 'SOLD' ? null : valueSource,
        quote,
        sale,
        perf: r.status === 'SOLD' ? performance(costCents, null) : performance(costCents, valueCents),
        realizedCents: sale ? realizedResult(costCents, sale) : null,
      };
    });
  }

  /** Converte para BRL, com o câmbio da data de aquisição, preços pagos em moeda estrangeira (uma vez por exemplar). */
  private async resolveForeignCosts(rows: ItemRow[]) {
    for (const r of rows) {
      if (r.currency === 'BRL' || r.purchasePriceCents === null || r.purchaseFxRate !== null) continue;
      const day = r.acquiredAt ? dateToDay(r.acquiredAt) : dayKey(r.createdAt);
      try {
        const fx = await this.fx.onDate(r.currency as SupportedCurrency, day);
        if (fx.stale) continue; // não fixamos no exemplar um câmbio aproximado; tentamos de novo depois
        await this.prisma.collectionItem.update({ where: { id: r.id }, data: { purchaseFxRate: fx.rate, purchaseFxDate: new Date(`${fx.rateDate}T00:00:00Z`) } });
        r.purchaseFxRate = fx.rate;
      } catch {
        // sem câmbio: o custo fica desconhecido (não vira zero)
      }
    }
  }

  private quoteView(s: CardPriceSnapshot, card: Pick<CardCatalog, 'pricesStatus'>): QuoteView {
    const staleAfter = this.options.staleAfterMs ?? 48 * 60 * 60 * 1000;
    return {
      marketplace: s.provider,
      variant: s.variant,
      currency: s.currency,
      marketPrice: s.marketPrice.toString(),
      priceField: s.priceField,
      priceCents: decimalToCents(s.priceBRL),
      exchangeRate: s.exchangeRate.toString(),
      exchangeRateDate: dateToDay(s.exchangeRateDate),
      sourceUpdatedAt: s.sourceUpdatedAt,
      capturedAt: s.capturedAt,
      stale: this.now().getTime() - s.capturedAt.getTime() > staleAfter || card.pricesStatus === 'ERROR',
    };
  }

  private async fxInfo() {
    const out: Record<string, { rate: string; rateDate: string; fetchedAt: Date; stale: boolean } | null> = {};
    for (const c of ['EUR', 'USD']) {
      const row = await this.prisma.exchangeRate.findFirst({ where: { base: c, quote: 'BRL' }, orderBy: [{ rateDate: 'desc' }, { fetchedAt: 'desc' }] });
      out[c] = row
        ? { rate: row.rate.toString(), rateDate: dateToDay(row.rateDate), fetchedAt: row.fetchedAt, stale: this.now().getTime() - row.fetchedAt.getTime() > 48 * 60 * 60 * 1000 }
        : null;
    }
    return out;
  }
}

/** Custo de aquisição em centavos de BRL; null quando não informado ou sem câmbio para a moeda estrangeira. */
export function costInBRL(item: Pick<CollectionItem, 'purchasePriceCents' | 'currency' | 'purchaseFxRate'>): number | null {
  if (item.purchasePriceCents === null) return null;
  if (item.currency === 'BRL') return item.purchasePriceCents;
  return item.purchaseFxRate ? convertCents(item.purchasePriceCents, item.purchaseFxRate) : null;
}

function rankingView(i: ItemValuation) {
  return {
    itemId: i.id,
    cardId: i.cardId,
    name: i.card.name,
    setName: i.card.setName,
    localNumber: i.card.localNumber,
    imageUrl: i.card.imageUrl,
    imageFallbackUrl: i.card.imageFallbackUrl,
    variant: i.variant,
    condition: i.condition,
    valueSource: i.valueSource,
    costCents: i.perf.costCents,
    valueCents: i.perf.valueCents,
    gainCents: i.perf.gainCents,
    gainPct: i.perf.gainPct,
  };
}

function itemView(i: ItemValuation) {
  return {
    id: i.id,
    variant: i.variant,
    condition: i.condition,
    status: i.status,
    acquiredAt: i.acquiredAt,
    purchasePriceCents: i.purchasePriceCents,
    purchaseCurrency: i.purchaseCurrency,
    purchaseFxRate: i.purchaseFxRate,
    costCents: i.costCents,
    manualValueCents: i.manualValueCents,
    manualValueAt: i.manualValueAt,
    valueCents: i.valueCents,
    valueSource: i.valueSource,
    quote: i.quote,
    gainCents: i.perf.gainCents,
    gainPct: i.perf.gainPct,
    sale: i.sale,
    realizedCents: i.realizedCents,
  };
}
