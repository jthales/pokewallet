import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { ApiService, errorMessage } from '../../core/api.service';
import { BrlPipe, ConditionPipe, LanguagePipe, VariantPipe } from '../../core/format.pipes';
import { marketplaceLabel, variantLabel } from '../../core/labels';
import { formatCents, formatForeign } from '../../core/money';
import { CardPerformance, CollectionCardDetail, CollectionItem, ItemPerformance, Variant } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { CardImage } from '../../shared/card-image';
import { ConfirmDialog, ConfirmData } from '../../shared/confirm-dialog';
import { Delta } from '../../shared/delta';
import { EmptyState } from '../../shared/empty-state';
import { ChartSeries, LineChart } from '../../shared/line-chart';
import { ItemFormData, ItemFormDialog } from '../../shared/item-form-dialog';
import { SaleDialog, SaleDialogData } from '../../shared/sale-dialog';

@Component({
  selector: 'app-card-details-page',
  imports: [DatePipe, RouterLink, MatButtonModule, MatIconModule, MatMenuModule, CardImage, EmptyState, BrlPipe, ConditionPipe, VariantPipe, LanguagePipe, Delta, LineChart],
  templateUrl: './card-details-page.html',
  styleUrl: './card-details-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardDetailsPage {
  readonly id = input.required<string>();
  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);

  readonly card = signal<CollectionCardDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly available = computed(() => this.card()?.items.filter((i) => i.status === 'AVAILABLE') ?? []);
  readonly sold = computed(() => this.card()?.items.filter((i) => i.status === 'SOLD') ?? []);

  // Desempenho financeiro
  readonly perf = signal<CardPerformance | null>(null);
  readonly perfLoading = signal(true);
  readonly perfError = signal<string | null>(null);
  readonly chartVariant = signal<Variant | null>(null);
  readonly marketplaceLabel = marketplaceLabel;
  readonly variantLabel = variantLabel;
  readonly formatBrl = (v: number) => formatCents(Math.round(v));
  readonly foreign = formatForeign;
  readonly rate = (r: string) => r.replace('.', ',');
  readonly perfById = computed(() => new Map((this.perf()?.items ?? []).map((i) => [i.id, i] as const)));
  /** Variantes em posse, com a cotação atual na fonte escolhida (ou indisponível). */
  readonly variantQuotes = computed(() => {
    const p = this.perf();
    if (!p) return [];
    const quotes = p.quotes[p.priceSource] ?? [];
    return p.heldVariants.map((v) => ({ variant: v, quote: quotes.find((q) => q.variant === v) ?? null }));
  });
  readonly heldTotals = computed(() => {
    const items = (this.perf()?.items ?? []).filter((i) => i.status === 'AVAILABLE');
    const withBoth = items.filter((i) => i.costCents !== null && i.valueCents !== null);
    const cost = withBoth.reduce((a, i) => a + i.costCents!, 0);
    const gain = withBoth.reduce((a, i) => a + i.gainCents!, 0);
    return {
      paidCents: items.some((i) => i.costCents !== null) ? items.reduce((a, i) => a + (i.costCents ?? 0), 0) : null,
      valueCents: items.some((i) => i.valueCents !== null) ? items.reduce((a, i) => a + (i.valueCents ?? 0), 0) : null,
      gainCents: withBoth.length ? gain : null,
      gainPct: cost > 0 ? Math.round((gain / cost) * 10000) / 100 : null,
      incomplete: items.length - withBoth.length,
    };
  });
  readonly chartVariants = computed(() => Object.keys(this.perf()?.history ?? {}) as Variant[]);
  readonly selectedVariant = computed(() => {
    const options = this.chartVariants();
    const chosen = this.chartVariant();
    if (chosen && options.includes(chosen)) return chosen;
    return options.find((v) => this.perf()?.heldVariants.includes(v)) ?? options[0] ?? null;
  });
  readonly chartPoints = computed(() => {
    const v = this.selectedVariant();
    return v ? (this.perf()?.history[v] ?? []) : [];
  });
  readonly chartSeries = computed<ChartSeries[]>(() => {
    const v = this.selectedVariant();
    if (!v) return [];
    // Uma série = um marketplace + uma variante; nunca ligamos pontos de séries diferentes.
    return [{ label: `${variantLabel(v)} · ${marketplaceLabel(this.perf()!.priceSource)}`, color: 'var(--pw-blue)', points: this.chartPoints().map((p) => ({ x: p.date, y: p.priceCents })) }];
  });

  itemPerf(id: string): ItemPerformance | undefined {
    return this.perfById().get(id);
  }

  constructor() {
    effect(() => this.load(this.id()));
  }

  loadPerformance(id = this.id()) {
    this.perfLoading.set(true);
    this.api.cardPerformance(id).subscribe({
      next: (p) => {
        this.perf.set(p);
        this.perfError.set(null);
        this.perfLoading.set(false);
      },
      error: (e) => {
        this.perfError.set(errorMessage(e));
        this.perfLoading.set(false);
      },
    });
  }

  load(id = this.id()) {
    this.loadPerformance(id);
    this.loading.set(true);
    this.api.getCollectionCard(id).subscribe({
      next: (c) => {
        this.card.set(c);
        this.error.set(null);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(errorMessage(e));
        this.loading.set(false);
      },
    });
  }

  private formData(item?: CollectionItem): ItemFormData {
    const c = this.card()!;
    return {
      mode: item ? 'edit' : 'create',
      card: { provider: c.provider, externalId: c.externalId, name: c.name, setName: c.setName, localNumber: c.localNumber, imageUrl: c.imageUrl },
      variants: c.metadata?.variants ?? null,
      item,
      defaultLanguage: this.card()?.items.at(-1)?.language,
    };
  }

  /** Abre a edição do primeiro exemplar disponível desta variante (para cadastrar avaliação manual). */
  editVariant(variant: Variant) {
    const item = this.available().find((i) => i.variant === variant);
    if (item) this.edit(item);
  }

  addItems() {
    this.dialog.open(ItemFormDialog, { data: this.formData(), width: '560px', maxWidth: '95vw' }).afterClosed().subscribe((r) => r && this.load());
  }

  edit(item: CollectionItem) {
    this.dialog.open(ItemFormDialog, { data: this.formData(item), width: '560px', maxWidth: '95vw' }).afterClosed().subscribe((r) => r && this.load());
  }

  sell(item: CollectionItem) {
    const data: SaleDialogData = { itemId: item.id, cardName: this.card()!.name, costCents: this.itemPerf(item.id)?.costCents ?? null };
    this.dialog.open(SaleDialog, { data, width: '420px', maxWidth: '95vw' }).afterClosed().subscribe((r) => r && this.load());
  }

  editSale(item: CollectionItem) {
    if (!item.activeSale) return;
    const data: SaleDialogData = { itemId: item.id, cardName: this.card()!.name, costCents: this.itemPerf(item.id)?.costCents ?? null, sale: item.activeSale };
    this.dialog.open(SaleDialog, { data, width: '420px', maxWidth: '95vw' }).afterClosed().subscribe((r) => r && this.load());
  }

  undoSale(item: CollectionItem) {
    if (!item.activeSale) return;
    const saleId = item.activeSale.id;
    this.confirm({ title: 'Desfazer venda?', message: 'O exemplar volta a ficar disponível. O registro fica no histórico como desfeito.', confirm: 'Desfazer venda' }, () =>
      this.api.cancelSale(saleId).subscribe({
        next: () => {
          this.notify.success('Venda desfeita.');
          this.load();
        },
        error: (e) => this.notify.error(e),
      }),
    );
  }

  remove(item: CollectionItem) {
    const last = this.card()!.items.length === 1;
    this.confirm(
      {
        title: 'Excluir exemplar?',
        message: last
          ? 'Este é o único exemplar desta carta: ela sairá da sua coleção, junto com o histórico de vendas deste exemplar. Use isto apenas para corrigir cadastros feitos por engano.'
          : 'O exemplar e o histórico de vendas dele serão apagados. Use isto apenas para corrigir cadastros feitos por engano.',
        confirm: 'Excluir',
        danger: true,
      },
      () =>
        this.api.deleteItem(item.id).subscribe({
          next: () => {
            this.notify.success('Exemplar excluído.');
            if (last) void this.router.navigate(['/colecao']);
            else this.load();
          },
          error: (e) => this.notify.error(e),
        }),
    );
  }

  private confirm(data: ConfirmData, action: () => void) {
    this.dialog.open(ConfirmDialog, { data, maxWidth: '95vw', width: '420px' }).afterClosed().subscribe((ok) => ok && action());
  }
}
