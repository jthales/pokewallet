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
  feesCents?: number | null;
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
  manualValueCents?: number | null;
  manualValueAt?: string | null;
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
  currency?: PurchaseCurrency;
  manualValueCents?: number | null;
  notes?: string | null;
}

export type UpdateItemRequest = Partial<Omit<NewItemsRequest, 'provider' | 'externalId' | 'quantity'>>;

export interface SellRequest {
  soldAt: string;
  salePriceCents: number;
  feesCents?: number | null;
  notes?: string | null;
}

export interface SaleHistoryEntry {
  id: string;
  soldAt: string;
  salePriceCents: number;
  feesCents: number | null;
  realizedCents: number | null;
  currency: string;
  notes: string | null;
  cancelledAt: string | null;
  createdAt: string;
  item: { id: string; condition: Condition; variant: Variant; language: PhysicalLanguage; purchasePriceCents: number | null; purchaseCurrency: string; costCents: number | null };
  card: { id: string; name: string; setName: string; localNumber: string; imageUrl: string | null };
}

export interface SalesHistory {
  totals: { count: number; revenueCents: number; feesCents: number; realizedCents: number; salesWithoutCost: number; currency: string };
  sales: SaleHistoryEntry[];
}

export interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: { path: string; message: string }[] };
}

// ---- Carteira de investimentos ----

export type Marketplace = 'cardmarket' | 'tcgplayer';
export type PurchaseCurrency = 'BRL' | 'USD' | 'EUR';
export type Period = '7d' | '30d' | '90d' | '1y' | 'all';
export type RankingSort = 'absolute' | 'percent';
export type ValueSource = 'MARKET' | 'MANUAL';

export interface FxInfo {
  rate: string;
  rateDate: string;
  stale: boolean;
}

export interface SyncResult {
  checked: number;
  failed: number;
  remaining: number;
  fx: { EUR: FxInfo | null; USD: FxInfo | null };
  error?: string;
}

export interface PortfolioSummary {
  holdings: { items: number; valued: number; unvalued: number; manualValued: number; withCost: number; withoutCost: number };
  estimatedValueCents: number;
  investedCents: number;
  unrealized: { eligibleItems: number; costBasisCents: number; valueCents: number; gainCents: number; gainPct: number | null };
  realized: { sales: number; eligibleSales: number; salesWithoutCost: number; grossCents: number; feesCents: number; costBasisCents: number; resultCents: number };
  totalKnownResultCents: number;
}

export interface RankingEntry {
  itemId: string;
  cardId: string;
  name: string;
  setName: string;
  localNumber: string;
  imageUrl: string | null;
  variant: Variant;
  condition: Condition;
  valueSource: ValueSource | null;
  costCents: number;
  valueCents: number;
  gainCents: number;
  gainPct: number | null;
}

export interface Portfolio {
  currency: 'BRL';
  priceSource: Marketplace;
  summary: PortfolioSummary;
  rankings: { sort: RankingSort; gainers: RankingEntry[]; losers: RankingEntry[] };
  meta: {
    lastUpdatedAt: string | null;
    unpricedItems: number;
    staleItems: number;
    fx: { EUR: (FxInfo & { fetchedAt: string }) | null; USD: (FxInfo & { fetchedAt: string }) | null };
    disclaimer: string;
  };
  sync: SyncResult;
}

export interface HistoryPoint {
  date: string;
  valueCents: number;
  investedCents: number;
  valueWithCostCents: number;
  items: number;
}

export interface PortfolioHistory {
  period: Period;
  priceSource: Marketplace;
  firstSnapshotDay: string | null;
  buildingHistory: boolean;
  points: HistoryPoint[];
  note: string;
}

export interface Quote {
  marketplace: Marketplace;
  variant: Variant;
  currency: 'EUR' | 'USD';
  marketPrice: string;
  priceField: string;
  priceCents: number;
  exchangeRate: string;
  exchangeRateDate: string;
  sourceUpdatedAt: string | null;
  capturedAt: string;
  stale: boolean;
}

export interface ItemPerformance {
  id: string;
  variant: Variant;
  condition: Condition;
  status: ItemStatus;
  acquiredAt: string | null;
  purchasePriceCents: number | null;
  purchaseCurrency: PurchaseCurrency;
  purchaseFxRate: string | null;
  costCents: number | null;
  manualValueCents: number | null;
  manualValueAt: string | null;
  valueCents: number | null;
  valueSource: ValueSource | null;
  quote: Quote | null;
  gainCents: number | null;
  gainPct: number | null;
  sale: { priceCents: number; feesCents: number | null; soldAt: string } | null;
  realizedCents: number | null;
}

export interface PricePoint {
  date: string;
  priceCents: number;
  marketPrice: string;
  currency: string;
  exchangeRate: string;
}

export interface CardPerformance {
  cardId: string;
  priceSource: Marketplace;
  pricesCheckedAt: string | null;
  pricesStatus: 'OK' | 'NO_PRICING' | 'ERROR' | null;
  quotes: Record<Marketplace, Quote[]>;
  history: Partial<Record<Variant, PricePoint[]>>;
  items: ItemPerformance[];
  summary: PortfolioSummary;
  heldVariants: Variant[];
  disclaimer: string;
  sync: SyncResult;
}

export interface CardValues {
  priceSource: Marketplace;
  cards: Record<string, { valueCents: number; valued: number; unvalued: number; stale: boolean }>;
}

export interface UserSettings {
  priceSource: Marketplace;
}
