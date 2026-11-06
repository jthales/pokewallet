export type Condition = 'MINT' | 'NEAR_MINT' | 'LIGHTLY_PLAYED' | 'MODERATELY_PLAYED' | 'HEAVILY_PLAYED' | 'DAMAGED';
export type Variant = 'NORMAL' | 'HOLOFOIL' | 'REVERSE_HOLOFOIL' | 'FIRST_EDITION' | 'OTHER';
export type ItemStatus = 'AVAILABLE' | 'SOLD';
export type PhysicalLanguage = 'pt' | 'en' | 'es' | 'fr' | 'de' | 'it' | 'ja' | 'ko' | 'zh' | 'other';
export type CatalogLanguage = 'en' | 'pt';
export type Confidence = 'high' | 'medium' | 'low';

export interface CatalogImage {
  small: string;
  large: string;
}

export interface CatalogCardSummary {
  externalId: string;
  name: string;
  localNumber: string;
  image: CatalogImage | null;
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

export interface CatalogCard {
  provider: string;
  externalId: string;
  name: string;
  localNumber: string;
  rarity: string | null;
  category: string | null;
  illustrator: string | null;
  image: CatalogImage | null;
  set: CatalogSetSummary;
  variants: CatalogVariants | null;
  language: CatalogLanguage;
}

export interface CatalogSearchResult {
  page: number;
  pageSize: number;
  hasMore: boolean;
  cards: CatalogCardSummary[];
}

export interface CardHints {
  nameCandidates: string[];
  localNumber: string | null;
  printedTotal: number | null;
  printedTotalRaw: string | null;
  detectedLanguage: 'pt' | 'en' | null;
}

export interface IdentificationCandidate {
  externalId: string;
  provider: string;
  name: string;
  localNumber: string;
  setId: string | null;
  setName: string | null;
  rarity: string | null;
  image: CatalogImage | null;
  score: number;
  confidence: Confidence | null;
  reasons: string[];
}

export interface IdentificationResult {
  hints: CardHints;
  candidates: IdentificationCandidate[];
  total: number;
  hasMore: boolean;
  message: string | null;
}

export interface IdentifyRequest {
  fullText?: string;
  nameText?: string;
  numberText?: string;
  language?: CatalogLanguage;
  offset?: number;
  limit?: number;
}

export interface Sale {
  id: string;
  collectionItemId: string;
  soldAt: string;
  salePriceCents: number;
  currency: string;
  notes: string | null;
  cancelledAt: string | null;
}

export interface CollectionItem {
  id: string;
  cardCatalogId: string;
  condition: Condition;
  variant: Variant;
  language: PhysicalLanguage;
  acquiredAt: string | null;
  purchasePriceCents: number | null;
  currency: string;
  notes: string | null;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
  activeSale: Sale | null;
}

export interface CollectionCard {
  id: string;
  provider: string;
  externalId: string;
  name: string;
  localNumber: string;
  setId: string;
  setName: string;
  rarity: string | null;
  imageUrl: string | null;
  imageLargeUrl: string | null;
  metadata: CardMetadata | null;
  counts: { total: number; available: number; sold: number };
  firstAddedAt: string;
  lastAddedAt: string;
}

export interface CardMetadata {
  language?: CatalogLanguage;
  category?: string | null;
  illustrator?: string | null;
  setLogoUrl?: string | null;
  setOfficialCount?: number | null;
  variants?: CatalogVariants | null;
}

export interface CollectionCardDetail extends CollectionCard {
  items: CollectionItem[];
}

export interface CollectionFilters {
  sets: { id: string; name: string }[];
  rarities: string[];
}

export interface CollectionQuery {
  search?: string;
  setId?: string;
  rarity?: string;
  status?: ItemStatus;
  sort?: 'name' | 'createdAt';
  order?: 'asc' | 'desc';
}

export interface Dashboard {
  distinctCards: number;
  totalItems: number;
  availableItems: number;
  soldItems: number;
  recentCards: CollectionCard[];
}

export interface NewItemsRequest {
  provider: string;
  externalId: string;
  quantity: number;
  condition: Condition;
  variant: Variant;
  language: PhysicalLanguage;
  acquiredAt?: string | null;
  purchasePriceCents?: number | null;
  notes?: string | null;
}

export type UpdateItemRequest = Partial<Omit<NewItemsRequest, 'provider' | 'externalId' | 'quantity'>>;

export interface SellRequest {
  soldAt: string;
  salePriceCents: number;
  notes?: string | null;
}

export interface SaleHistoryEntry {
  id: string;
  soldAt: string;
  salePriceCents: number;
  currency: string;
  notes: string | null;
  cancelledAt: string | null;
  createdAt: string;
  item: { id: string; condition: Condition; variant: Variant; language: PhysicalLanguage; purchasePriceCents: number | null };
  card: { id: string; name: string; setName: string; localNumber: string; imageUrl: string | null };
}

export interface SalesHistory {
  totals: { count: number; revenueCents: number; currency: string };
  sales: SaleHistoryEntry[];
}

export interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: { path: string; message: string }[] };
}
