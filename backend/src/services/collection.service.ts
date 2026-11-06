import type { CardCatalog, CollectionItem, Prisma, PrismaClient, Sale } from '@prisma/client';
import { CatalogUnavailableError, type CardCatalogProvider } from '../integrations/catalog-provider.js';
import { AppError, notFound } from '../lib/errors.js';
import { normalizeText } from '../lib/text.js';
import { CardCatalogRepository } from '../repositories/card-catalog.repository.js';
import { CollectionItemRepository } from '../repositories/collection-item.repository.js';
import type { CollectionQuery, CreateItemsInput, UpdateItemInput } from '../schemas/index.js';

export interface CollectionCardView {
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
  metadata: unknown;
  counts: { total: number; available: number; sold: number };
  firstAddedAt: Date;
  lastAddedAt: Date;
}

type CardWithItems = CardCatalog & { items: Pick<CollectionItem, 'status' | 'createdAt'>[] };

export function toCardView(card: CardWithItems): CollectionCardView {
  const meta = (card.metadata ?? {}) as Record<string, unknown>;
  const dates = card.items.map((i) => i.createdAt.getTime());
  const available = card.items.filter((i) => i.status === 'AVAILABLE').length;
  return {
    id: card.id,
    provider: card.provider,
    externalId: card.externalId,
    name: card.name,
    localNumber: card.localNumber,
    setId: card.setId,
    setName: card.setName,
    rarity: card.rarity,
    imageUrl: card.imageUrl,
    imageLargeUrl: typeof meta['imageLarge'] === 'string' ? meta['imageLarge'] : null,
    metadata: card.metadata,
    counts: { total: card.items.length, available, sold: card.items.length - available },
    firstAddedAt: new Date(dates.length ? Math.min(...dates) : card.createdAt.getTime()),
    lastAddedAt: new Date(dates.length ? Math.max(...dates) : card.createdAt.getTime()),
  };
}

export class CollectionService {
  private readonly cards: CardCatalogRepository;
  private readonly items: CollectionItemRepository;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly catalog: CardCatalogProvider,
  ) {
    this.cards = new CardCatalogRepository(prisma);
    this.items = new CollectionItemRepository(prisma);
  }

  /**
   * Adiciona um ou mais exemplares de uma carta do catálogo.
   * Busca os metadados atualizados no fornecedor; se ele estiver fora do ar e a carta já existir localmente,
   * usa a cópia local para que o cadastro continue funcionando.
   */
  async addItems(input: CreateItemsInput) {
    let local = await this.cards.findByExternal(input.provider, input.externalId);
    if (input.provider !== this.catalog.providerId && !local) {
      throw new AppError(400, 'UNKNOWN_PROVIDER', 'Fornecedor de catálogo desconhecido.');
    }
    if (input.provider === this.catalog.providerId) {
      try {
        const remote = await this.catalog.getCardById(input.externalId);
        if (!remote && !local) throw new AppError(404, 'CARD_NOT_FOUND', 'Carta não encontrada no catálogo.');
        if (remote) local = await this.cards.upsertFromProvider(remote);
      } catch (error) {
        if (!(error instanceof CatalogUnavailableError)) throw error;
        if (!local) {
          throw new AppError(503, 'CATALOG_UNAVAILABLE', 'O catálogo está indisponível e esta carta ainda não está salva localmente. Tente novamente mais tarde.');
        }
      }
    }
    const card = local!;
    const created = await this.items.createMany(
      Array.from({ length: input.quantity }, () => ({
        cardCatalogId: card.id,
        condition: input.condition,
        variant: input.variant,
        language: input.language,
        acquiredAt: input.acquiredAt ?? null,
        purchasePriceCents: input.purchasePriceCents ?? null,
        currency: input.currency ?? 'BRL',
        manualValueCents: input.manualValueCents ?? null,
        manualValueAt: input.manualValueCents != null ? new Date() : null,
        notes: input.notes ?? null,
      })),
    );
    return { card, items: created };
  }

  async listCards(query: CollectionQuery): Promise<CollectionCardView[]> {
    const where: Prisma.CardCatalogWhereInput = { items: { some: query.status ? { status: query.status } : {} } };
    if (query.setId) where.setId = query.setId;
    if (query.rarity) where.rarity = query.rarity;
    const rows = await this.prisma.cardCatalog.findMany({
      where,
      include: { items: { select: { status: true, createdAt: true } } },
    });
    let views = rows.map(toCardView);
    if (query.search) {
      // Busca sem acentos/caixa, feita em memória (SQLite não tem collation sem acentos).
      const term = normalizeText(query.search);
      views = views.filter((v) => normalizeText(v.name).includes(term) || normalizeText(v.setName).includes(term));
    }
    const order = query.order ?? (query.sort === 'name' ? 'asc' : 'desc');
    const dir = order === 'asc' ? 1 : -1;
    views.sort((a, b) =>
      query.sort === 'name'
        ? dir * a.name.localeCompare(b.name, 'pt-BR') || a.localNumber.localeCompare(b.localNumber, 'pt-BR', { numeric: true })
        : dir * (a.lastAddedAt.getTime() - b.lastAddedAt.getTime()),
    );
    return views;
  }

  async getFilters() {
    const rows = await this.prisma.cardCatalog.findMany({
      where: { items: { some: {} } },
      select: { setId: true, setName: true, rarity: true },
    });
    const sets = new Map<string, string>();
    const rarities = new Set<string>();
    for (const r of rows) {
      sets.set(r.setId, r.setName);
      if (r.rarity) rarities.add(r.rarity);
    }
    return {
      sets: [...sets].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
      rarities: [...rarities].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    };
  }

  async getCard(id: string) {
    const card = await this.prisma.cardCatalog.findUnique({
      where: { id },
      include: { items: { orderBy: { createdAt: 'asc' }, include: { sales: { where: { cancelledAt: null } } } } },
    });
    if (!card) throw notFound('Carta');
    return { ...toCardView(card), items: card.items.map(toItemView) };
  }

  async updateItem(id: string, input: UpdateItemInput) {
    const existing = await this.items.findById(id);
    if (!existing) throw notFound('Exemplar');
    const data: Prisma.CollectionItemUpdateInput = { ...input };
    // Mudou preço, moeda ou data: o câmbio de aquisição salvo deixa de valer e será recalculado.
    if (input.purchasePriceCents !== undefined || input.currency !== undefined || input.acquiredAt !== undefined) {
      data.purchaseFxRate = null;
      data.purchaseFxDate = null;
    }
    if (input.manualValueCents !== undefined) data.manualValueAt = input.manualValueCents === null ? null : new Date();
    const updated = await this.items.update(id, data);
    return toItemView({ ...updated, sales: existing.sales });
  }

  async deleteItem(id: string) {
    const existing = await this.items.findById(id);
    if (!existing) throw notFound('Exemplar');
    await this.items.delete(id);
    await this.cards.deleteIfOrphan(existing.cardCatalogId);
  }

  async dashboard() {
    const [distinctCards, byStatus, recent] = await Promise.all([
      this.prisma.cardCatalog.count({ where: { items: { some: {} } } }),
      this.items.countByStatus(),
      this.prisma.collectionItem.findMany({
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: { cardCatalog: { include: { items: { select: { status: true, createdAt: true } } } } },
      }),
    ]);
    const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
    const seen = new Set<string>();
    const recentCards: CollectionCardView[] = [];
    for (const item of recent) {
      if (seen.has(item.cardCatalogId)) continue;
      seen.add(item.cardCatalogId);
      recentCards.push(toCardView(item.cardCatalog));
      if (recentCards.length >= 8) break;
    }
    const available = count('AVAILABLE');
    const sold = count('SOLD');
    return { distinctCards, totalItems: available + sold, availableItems: available, soldItems: sold, recentCards };
  }
}

export function toItemView(item: CollectionItem & { sales?: Sale[] }) {
  const activeSale = item.sales?.find((s) => s.cancelledAt === null) ?? null;
  return {
    id: item.id,
    cardCatalogId: item.cardCatalogId,
    condition: item.condition,
    variant: item.variant,
    language: item.language,
    acquiredAt: item.acquiredAt,
    purchasePriceCents: item.purchasePriceCents,
    currency: item.currency,
    manualValueCents: item.manualValueCents,
    manualValueAt: item.manualValueAt,
    notes: item.notes,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    activeSale,
  };
}
