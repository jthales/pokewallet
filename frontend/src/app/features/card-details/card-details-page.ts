import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { ApiService, errorMessage } from '../../core/api.service';
import { BrlPipe, ConditionPipe, LanguagePipe, VariantPipe } from '../../core/format.pipes';
import { CollectionCardDetail, CollectionItem } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { CardImage } from '../../shared/card-image';
import { ConfirmDialog, ConfirmData } from '../../shared/confirm-dialog';
import { EmptyState } from '../../shared/empty-state';
import { ItemFormData, ItemFormDialog } from '../../shared/item-form-dialog';
import { SaleDialog, SaleDialogData } from '../../shared/sale-dialog';

@Component({
  selector: 'app-card-details-page',
  imports: [DatePipe, RouterLink, MatButtonModule, MatIconModule, MatMenuModule, CardImage, EmptyState, BrlPipe, ConditionPipe, VariantPipe, LanguagePipe],
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

  constructor() {
    effect(() => this.load(this.id()));
  }

  load(id = this.id()) {
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

  addItems() {
    this.dialog.open(ItemFormDialog, { data: this.formData(), width: '560px', maxWidth: '95vw' }).afterClosed().subscribe((r) => r && this.load());
  }

  edit(item: CollectionItem) {
    this.dialog.open(ItemFormDialog, { data: this.formData(item), width: '560px', maxWidth: '95vw' }).afterClosed().subscribe((r) => r && this.load());
  }

  sell(item: CollectionItem) {
    const data: SaleDialogData = { itemId: item.id, cardName: this.card()!.name };
    this.dialog.open(SaleDialog, { data, width: '420px', maxWidth: '95vw' }).afterClosed().subscribe((r) => r && this.load());
  }

  editSale(item: CollectionItem) {
    if (!item.activeSale) return;
    const data: SaleDialogData = { itemId: item.id, cardName: this.card()!.name, sale: item.activeSale };
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
