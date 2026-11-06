import type { CardPriceSnapshot, PrismaClient } from '@prisma/client';
import type { Marketplace, MarketQuote } from '../integrations/market-price-provider.js';
import { dayKey, dayToDate } from '../lib/decimal.js';
import { ExchangeRateService, type RateResult } from './exchange-rate.service.js';

/**
 * Persistência do histórico de preços (CardPriceSnapshot).
 * Um snapshot por carta + marketplace + variante + dia: uma nova consulta no mesmo dia atualiza o registro do dia,
 * nunca cria outro. Não criamos registros para dias passados (avg7/avg30 da Cardmarket são médias móveis, não histórico).
 */
export class PriceHistoryService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Grava as cotações do dia. Cotações cuja moeda não tem câmbio disponível são ignoradas e contadas em `skipped`. */
  async record(cardCatalogId: string, quotes: MarketQuote[], rates: Partial<Record<string, RateResult>>, now = new Date()) {
    const capturedOn = dayToDate(dayKey(now));
    let saved = 0;
    let skipped = 0;
    for (const q of quotes) {
      const fx = rates[q.currency];
      if (!fx) {
        skipped++;
        continue;
      }
      const data = {
        currency: q.currency,
        marketPrice: q.price,
        priceField: q.field,
        priceBRL: ExchangeRateService.toBRL(q.price, fx.rate),
        exchangeRate: fx.rate,
        exchangeRateDate: dayToDate(fx.rateDate),
        sourceUpdatedAt: q.sourceUpdatedAt,
        capturedAt: now,
      };
      await this.prisma.cardPriceSnapshot.upsert({
        where: { cardCatalogId_provider_variant_capturedOn: { cardCatalogId, provider: q.marketplace, variant: q.variant, capturedOn } },
        create: { cardCatalogId, provider: q.marketplace, variant: q.variant, capturedOn, ...data },
        update: data,
      });
      saved++;
    }
    return { saved, skipped };
  }

  /** Último snapshot de cada carta/variante para um marketplace: Map<cardId, Map<variant, snapshot>>. */
  async latest(cardIds: string[], marketplace: Marketplace) {
    const map = new Map<string, Map<string, CardPriceSnapshot>>();
    if (!cardIds.length) return map;
    const rows = await this.prisma.cardPriceSnapshot.findMany({
      where: { cardCatalogId: { in: cardIds }, provider: marketplace },
      orderBy: { capturedOn: 'desc' },
      distinct: ['cardCatalogId', 'variant'],
    });
    for (const r of rows) {
      if (!map.has(r.cardCatalogId)) map.set(r.cardCatalogId, new Map());
      map.get(r.cardCatalogId)!.set(r.variant, r);
    }
    return map;
  }

  /** Série completa (ordem cronológica) de snapshots das cartas para um marketplace. */
  series(cardIds: string[], marketplace: Marketplace) {
    if (!cardIds.length) return Promise.resolve([] as CardPriceSnapshot[]);
    return this.prisma.cardPriceSnapshot.findMany({
      where: { cardCatalogId: { in: cardIds }, provider: marketplace },
      orderBy: { capturedOn: 'asc' },
    });
  }
}
