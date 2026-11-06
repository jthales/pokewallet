import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ApiService, errorMessage } from '../../core/api.service';
import { BrlPipe, ConditionPipe, VariantPipe } from '../../core/format.pipes';
import { SaleHistoryEntry, SalesHistory } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { CardImage } from '../../shared/card-image';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { EmptyState } from '../../shared/empty-state';
import { Delta } from '../../shared/delta';
import { SaleDialog, SaleDialogData } from '../../shared/sale-dialog';

@Component({
  selector: 'app-sales-page',
  imports: [DatePipe, RouterLink, MatButtonModule, MatIconModule, MatMenuModule, MatSlideToggleModule, CardImage, EmptyState, BrlPipe, ConditionPipe, VariantPipe, Delta],
  templateUrl: './sales-page.html',
  styleUrl: './sales-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SalesPage {
  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);

  readonly includeCancelled = signal(false);
  readonly history = signal<SalesHistory | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
    effect(() => this.load(this.includeCancelled()));
  }

  load(includeCancelled = this.includeCancelled()) {
    this.loading.set(true);
    this.api.sales(includeCancelled).subscribe({
      next: (h) => {
        this.history.set(h);
        this.error.set(null);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(errorMessage(e));
        this.loading.set(false);
      },
    });
  }

  edit(sale: SaleHistoryEntry) {
    const data: SaleDialogData = { itemId: sale.item.id, cardName: sale.card.name, costCents: sale.item.costCents, sale };
    this.dialog.open(SaleDialog, { data, width: '420px', maxWidth: '95vw' }).afterClosed().subscribe((ok) => ok && this.load());
  }

  undo(sale: SaleHistoryEntry) {
    this.dialog
      .open(ConfirmDialog, {
        data: { title: 'Desfazer venda?', message: `${sale.card.name} volta para a coleção como disponível.`, confirm: 'Desfazer venda' },
        width: '420px',
        maxWidth: '95vw',
      })
      .afterClosed()
      .subscribe((ok) => {
        if (!ok) return;
        this.api.cancelSale(sale.id).subscribe({
          next: () => {
            this.notify.success('Venda desfeita.');
            this.load();
          },
          error: (e) => this.notify.error(e),
        });
      });
  }
}
