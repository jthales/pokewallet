/**
 * Contrato entre o domínio do PokéWallet e qualquer fornecedor de catálogo de cartas.
 * O domínio só conhece estes tipos; a TCGdex é apenas uma implementação.
 */

export type CatalogLanguage = 'en' | 'pt';
export const CATALOG_LANGUAGES: readonly CatalogLanguage[] = ['en', 'pt'];

export interface CatalogImage {
  /** Imagem pequena, adequada para grids. */
  small: string;
  /** Imagem em alta qualidade, adequada para a página de detalhes. */
  large: string;
}

/** Resumo de carta, retornado em listas e buscas. */
export interface CatalogCardSummary {
  externalId: string;
  name: string;
  localNumber: string;
  image: CatalogImage | null;
  /** Id da expansão quando o fornecedor o informa ou ele pode ser inferido com segurança. */
  setId: string | null;
}

export interface CatalogSetSummary {
  externalId: string;
  name: string;
  logoUrl: string | null;
  symbolUrl: string | null;
  officialCount: number | null;
  totalCount: number | null;
}

export interface CatalogVariants {
  normal: boolean;
  holo: boolean;
  reverse: boolean;
  firstEdition: boolean;
  wPromo: boolean;
}

/** Carta completa. */
export interface CatalogCard {
  provider: string;
  externalId: string;
  name: string;
  localNumber: string;
  rarity: string | null;
  category: string | null;
  illustrator: string | null;
  image: CatalogImage | null;
  set: CatalogSetSummary & { serieId?: string | null; serieName?: string | null; releaseDate?: string | null };
  /** Variantes conhecidas pelo fornecedor; null quando o fornecedor não informa. */
  variants: CatalogVariants | null;
  /** Idioma em que os dados foram obtidos (pode diferir do solicitado por causa do fallback). */
  language: CatalogLanguage;
}

export interface CatalogSet extends CatalogSetSummary {
  serieId: string | null;
  serieName: string | null;
  releaseDate: string | null;
  cards: CatalogCardSummary[];
  language: CatalogLanguage;
}

export interface CardSearchQuery {
  name?: string;
  localNumber?: string;
  setId?: string;
  page?: number;
  pageSize?: number;
  language?: CatalogLanguage;
}

export interface CardCatalogProvider {
  readonly providerId: string;
  searchCards(query: CardSearchQuery): Promise<CatalogCardSummary[]>;
  getCardById(id: string, language?: CatalogLanguage): Promise<CatalogCard | null>;
  getSets(language?: CatalogLanguage): Promise<CatalogSetSummary[]>;
  getSetById(id: string, language?: CatalogLanguage): Promise<CatalogSet | null>;
  searchCardsByNumber(localNumber: string, options?: { setId?: string; language?: CatalogLanguage }): Promise<CatalogCardSummary[]>;
  /** Expansões cujo total oficial impresso corresponde ao informado (ex.: 189 em "136/189"). */
  findSetsByOfficialCount(officialCount: number, language?: CatalogLanguage): Promise<CatalogSetSummary[]>;
}

/** Erro lançado quando o fornecedor externo está indisponível ou responde algo inválido. */
export class CatalogUnavailableError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'CatalogUnavailableError';
  }
}
