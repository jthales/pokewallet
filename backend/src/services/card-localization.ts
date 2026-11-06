import type { CardCatalog, CardCatalogLocalization, PrismaClient } from '@prisma/client';
import { CATALOG_LANGUAGES, type CardCatalogProvider, type CatalogLanguage } from '../integrations/catalog-provider.js';

/** Idiomas do catálogo, além do inglês (idioma-base do CardCatalog), para os quais guardamos nome e imagem. */
const LOCALIZED_LANGUAGES = CATALOG_LANGUAGES.filter((l) => l !== 'en');

/** Quando o fornecedor não tinha a carta no idioma, tentamos de novo depois deste intervalo. */
const RETRY_MISSING_MS = 7 * 24 * 60 * 60 * 1000;
/** Limite de cartas buscadas no fornecedor por requisição (o resto fica para o próximo acesso). */
const MAX_FETCH_PER_CALL = 40;
const CONCURRENCY = 6;

export function isLocalizedLanguage(language: string): language is CatalogLanguage {
  return (LOCALIZED_LANGUAGES as readonly string[]).includes(language);
}

/**
 * Idioma em que a carta aparece na carteira, a partir do idioma físico dos exemplares:
 * o idioma localizado (ex.: pt) quando ele tem ao menos tantos exemplares quanto os demais idiomas juntos.
 * Devolve null para mostrar o catálogo-base (inglês).
 */
export function displayLanguageFor(items: readonly { language: string }[]): CatalogLanguage | null {
  for (const lang of LOCALIZED_LANGUAGES) {
    const count = items.filter((i) => i.language === lang).length;
    if (count > 0 && count >= items.length - count) return lang;
  }
  return null;
}

export interface LocalizedCardFields {
  name: string;
  setName: string;
  imageUrl: string | null;
  imageLargeUrl: string | null;
  /** Imagem em inglês, para o navegador usar se a imagem no idioma não carregar. */
  imageFallbackUrl: string | null;
  /** Idioma efetivo do nome exibido. */
  displayLanguage: CatalogLanguage;
  /** Nome no catálogo-base (inglês), útil para busca. */
  baseName: string;
}

type CardBase = Pick<CardCatalog, 'name' | 'setName' | 'imageUrl' | 'metadata'>;
type LocalizationRow = Pick<CardCatalogLocalization, 'language' | 'name' | 'setName' | 'imageUrl' | 'imageLargeUrl'>;

/** Nome, expansão e imagem da carta no idioma pedido, com fallback campo a campo para o inglês. */
export function localizeCard(card: CardBase, localizations: readonly LocalizationRow[] | undefined, language: string | null): LocalizedCardFields {
  const meta = (card.metadata ?? {}) as Record<string, unknown>;
  const baseLarge = typeof meta['imageLarge'] === 'string' ? meta['imageLarge'] : null;
  const base: LocalizedCardFields = {
    name: card.name,
    setName: card.setName,
    imageUrl: card.imageUrl,
    imageLargeUrl: baseLarge,
    imageFallbackUrl: null,
    displayLanguage: 'en',
    baseName: card.name,
  };
  if (!language || !isLocalizedLanguage(language)) return base;
  const loc = localizations?.find((l) => l.language === language);
  if (!loc?.name) return base;
  const hasImage = !!loc.imageUrl;
  return {
    name: loc.name,
    setName: loc.setName ?? card.setName,
    imageUrl: hasImage ? loc.imageUrl : card.imageUrl,
    imageLargeUrl: hasImage ? (loc.imageLargeUrl ?? loc.imageUrl) : baseLarge,
    imageFallbackUrl: hasImage ? (card.imageUrl ?? null) : null,
    displayLanguage: language,
    baseName: card.name,
  };
}

/**
 * Busca no fornecedor e guarda nome/imagem das cartas nos idiomas dos exemplares (ex.: pt).
 * Falhas do fornecedor nunca impedem o uso da carteira: a carta continua aparecendo em inglês.
 */
export class CardLocalizationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly catalog: CardCatalogProvider,
    private readonly options: { now?: () => Date } = {},
  ) {}

  /** Garante a localização de uma carta num idioma (usado ao cadastrar/editar um exemplar). */
  async ensureOne(card: Pick<CardCatalog, 'id' | 'provider' | 'externalId'>, language: string) {
    if (!isLocalizedLanguage(language) || card.provider !== this.catalog.providerId) return;
    const existing = await this.prisma.cardCatalogLocalization.findUnique({
      where: { cardCatalogId_language: { cardCatalogId: card.id, language } },
    });
    if (existing && !this.shouldRetry(existing)) return;
    await this.fetchAndStore(card, language);
  }

  /**
   * Preenche localizações que faltam para as cartas que têm exemplares em idiomas localizados.
   * Chamado ao listar a carteira, para corrigir também os exemplares cadastrados antes desta funcionalidade.
   */
  async backfill(cards: readonly (Pick<CardCatalog, 'id' | 'provider' | 'externalId'> & { items: { language: string }[]; localizations?: LocalizationRow[] })[]) {
    const pending: { card: Pick<CardCatalog, 'id' | 'provider' | 'externalId'>; language: CatalogLanguage }[] = [];
    const needsLookup: { card: (typeof cards)[number]; language: CatalogLanguage }[] = [];
    for (const card of cards) {
      if (card.provider !== this.catalog.providerId) continue;
      for (const language of new Set(card.items.map((i) => i.language))) {
        if (!isLocalizedLanguage(language)) continue;
        needsLookup.push({ card, language });
      }
    }
    if (!needsLookup.length) return false;
    const rows = await this.prisma.cardCatalogLocalization.findMany({
      where: { cardCatalogId: { in: [...new Set(needsLookup.map((n) => n.card.id))] } },
      select: { cardCatalogId: true, language: true, name: true, fetchedAt: true },
    });
    for (const n of needsLookup) {
      const row = rows.find((r) => r.cardCatalogId === n.card.id && r.language === n.language);
      if (!row || this.shouldRetry(row)) pending.push(n);
    }
    if (!pending.length) return false;
    const batch = pending.slice(0, MAX_FETCH_PER_CALL);
    let changed = false;
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const results = await Promise.all(batch.slice(i, i + CONCURRENCY).map((p) => this.fetchAndStore(p.card, p.language)));
      changed ||= results.some(Boolean);
    }
    return changed;
  }

  private shouldRetry(row: { name: string | null; fetchedAt: Date }) {
    return row.name === null && this.now().getTime() - row.fetchedAt.getTime() > RETRY_MISSING_MS;
  }

  private now() {
    return this.options.now?.() ?? new Date();
  }

  /** Devolve true quando gravou uma localização com nome no idioma. */
  private async fetchAndStore(card: Pick<CardCatalog, 'id' | 'externalId'>, language: CatalogLanguage): Promise<boolean> {
    let remote;
    try {
      remote = await this.catalog.getCardById(card.externalId, language);
    } catch {
      return false; // fornecedor fora do ar: tenta de novo no próximo acesso
    }
    // O fornecedor faz fallback para inglês quando não tem a carta no idioma: isso conta como "indisponível".
    const found = remote && remote.language === language ? remote : null;
    const data = {
      name: found?.name ?? null,
      setName: found?.set.name ?? null,
      imageUrl: found?.image?.small ?? null,
      imageLargeUrl: found?.image?.large ?? null,
      fetchedAt: this.now(),
    };
    try {
      await this.prisma.cardCatalogLocalization.upsert({
        where: { cardCatalogId_language: { cardCatalogId: card.id, language } },
        create: { cardCatalogId: card.id, language, ...data },
        update: data,
      });
    } catch {
      return false; // ex.: carta removida em paralelo
    }
    return !!found;
  }
}
