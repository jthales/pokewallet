import type { z } from 'zod';
import { TtlCache } from '../../lib/cache.js';
import {
  CatalogUnavailableError,
  type CardCatalogProvider,
  type CardSearchQuery,
  type CatalogCard,
  type CatalogCardSummary,
  type CatalogLanguage,
  type CatalogSet,
  type CatalogSetSummary,
} from '../catalog-provider.js';
import { buildCardImage, buildSetAssetUrl, parseCardImagePath } from './tcgdex-assets.js';
import {
  TcgdexCardBriefListSchema,
  TcgdexCardSchema,
  TcgdexSerieSchema,
  TcgdexSetBriefListSchema,
  TcgdexSetSchema,
  type TcgdexCardBrief,
  type TcgdexSetBrief,
} from './tcgdex.schemas.js';

export type FetchLike = (input: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface TcgdexOptions {
  baseUrl?: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  fetchFn?: FetchLike;
}

/** Séries que não correspondem a cartas físicas (ex.: Pokémon TCG Pocket) e são ignoradas nas buscas. */
const DIGITAL_ONLY_SERIES = ['tcgp'];

/**
 * Cliente da TCGdex REST API v2 (https://tcgdex.dev/rest).
 * - Valida todas as respostas com Zod.
 * - Mantém cache em memória por URL.
 * - Faz fallback para inglês quando a carta/expansão não existe no idioma pedido.
 */
export class TcgdexCatalogService implements CardCatalogProvider {
  readonly providerId = 'tcgdex';
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchLike;
  private readonly cache: TtlCache<unknown>;

  constructor(options: TcgdexOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://api.tcgdex.net/v2').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.fetchFn = options.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
    this.cache = new TtlCache<unknown>(options.cacheTtlMs ?? 6 * 60 * 60 * 1000, 1000);
  }

  async searchCards(query: CardSearchQuery): Promise<CatalogCardSummary[]> {
    const lang = query.language ?? 'en';
    const params = new URLSearchParams();
    if (query.name?.trim()) params.set('name', query.name.trim());
    if (query.localNumber?.trim()) params.set('localId', query.localNumber.trim());
    if (query.setId?.trim()) params.set('set.id', query.setId.trim());
    if (![...params.keys()].length) return [];
    params.set('pagination:page', String(query.page ?? 1));
    params.set('pagination:itemsPerPage', String(query.pageSize ?? 30));

    const cards = await this.request(`/${lang}/cards?${params.toString()}`, TcgdexCardBriefListSchema);
    const digitalSets = await this.getDigitalOnlySetIds();
    return (cards ?? []).map((c) => this.toSummary(c)).filter((c) => !c.setId || !digitalSets.has(c.setId));
  }

  async searchCardsByNumber(localNumber: string, options: { setId?: string; language?: CatalogLanguage } = {}) {
    return this.searchCards({ localNumber, setId: options.setId, language: options.language, pageSize: 100 });
  }

  async getCardById(id: string, language: CatalogLanguage = 'en'): Promise<CatalogCard | null> {
    const path = (lang: CatalogLanguage) => `/${lang}/cards/${encodeURIComponent(id)}`;
    let lang = language;
    let card = await this.request(path(lang), TcgdexCardSchema);
    if (!card && lang !== 'en') {
      lang = 'en';
      card = await this.request(path(lang), TcgdexCardSchema);
    }
    if (!card) return null;
    const pathInfo = parseCardImagePath(card.image);
    return {
      provider: this.providerId,
      externalId: card.id,
      name: card.name,
      localNumber: card.localId,
      // A TCGdex usa a string "None" para cartas sem raridade impressa.
      rarity: card.rarity && card.rarity !== 'None' ? card.rarity : null,
      category: card.category ?? null,
      illustrator: card.illustrator ?? null,
      image: buildCardImage(card.image),
      set: { ...this.toSetSummary(card.set), serieId: pathInfo?.serieId ?? null },
      variants: card.variants
        ? {
            normal: card.variants.normal ?? false,
            holo: card.variants.holo ?? false,
            reverse: card.variants.reverse ?? false,
            firstEdition: card.variants.firstEdition ?? false,
            wPromo: card.variants.wPromo ?? false,
          }
        : null,
      language: lang,
    };
  }

  async getSets(language: CatalogLanguage = 'en'): Promise<CatalogSetSummary[]> {
    const sets = await this.request(`/${language}/sets`, TcgdexSetBriefListSchema);
    const digital = await this.getDigitalOnlySetIds();
    return (sets ?? []).filter((s) => !digital.has(s.id)).map((s) => this.toSetSummary(s));
  }

  async getSetById(id: string, language: CatalogLanguage = 'en'): Promise<CatalogSet | null> {
    const path = (lang: CatalogLanguage) => `/${lang}/sets/${encodeURIComponent(id)}`;
    let lang = language;
    let set = await this.request(path(lang), TcgdexSetSchema);
    if (!set && lang !== 'en') {
      lang = 'en';
      set = await this.request(path(lang), TcgdexSetSchema);
    }
    if (!set) return null;
    return {
      ...this.toSetSummary(set),
      serieId: set.serie?.id ?? null,
      serieName: set.serie?.name ?? null,
      releaseDate: set.releaseDate ?? null,
      cards: set.cards.map((c) => ({ ...this.toSummary(c), setId: set.id })),
      language: lang,
    };
  }

  /** Expansões cujo total oficial impresso é igual a `officialCount` (ex.: 189 em "136/189"). */
  async findSetsByOfficialCount(officialCount: number, language: CatalogLanguage = 'en'): Promise<CatalogSetSummary[]> {
    const sets = await this.getSets(language);
    return sets.filter((s) => s.officialCount === officialCount);
  }

  private async getDigitalOnlySetIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const serie of DIGITAL_ONLY_SERIES) {
      try {
        const data = await this.request(`/en/series/${serie}`, TcgdexSerieSchema);
        data?.sets.forEach((s) => ids.add(s.id));
      } catch {
        // Se não conseguirmos a lista, apenas não filtramos.
      }
    }
    return ids;
  }

  private toSummary(card: TcgdexCardBrief): CatalogCardSummary {
    const pathInfo = parseCardImagePath(card.image);
    let setId = pathInfo?.setId ?? null;
    if (!setId && card.id.endsWith(`-${card.localId}`)) {
      setId = card.id.slice(0, -(card.localId.length + 1)) || null;
    }
    return { externalId: card.id, name: card.name, localNumber: card.localId, image: buildCardImage(card.image), setId };
  }

  private toSetSummary(set: TcgdexSetBrief): CatalogSetSummary {
    return {
      externalId: set.id,
      name: set.name,
      logoUrl: buildSetAssetUrl(set.logo),
      symbolUrl: buildSetAssetUrl(set.symbol),
      officialCount: set.cardCount?.official ?? null,
      totalCount: set.cardCount?.total ?? null,
    };
  }

  /** GET com timeout, cache e validação. Retorna null em 404; lança CatalogUnavailableError em outras falhas. */
  private async request<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S> | null> {
    const url = `${this.baseUrl}${path}`;
    const cached = this.cache.get(url);
    if (cached !== undefined) return cached as z.infer<S> | null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetchFn(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    } catch (error) {
      throw new CatalogUnavailableError('Não foi possível conectar à TCGdex.', error);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 404) {
      this.cache.set(url, null);
      return null;
    }
    if (!response.ok) throw new CatalogUnavailableError(`A TCGdex respondeu com status ${response.status}.`);

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new CatalogUnavailableError('Resposta inválida da TCGdex.', error);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new CatalogUnavailableError('Resposta da TCGdex fora do formato esperado.', parsed.error);
    this.cache.set(url, parsed.data);
    return parsed.data;
  }
}
