import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ApiService } from '../core/api.service';
import { toDateInput, todayIso } from '../core/date';
import { Sale } from '../core/models';
import { centsToInput, parseMoneyToCents } from '../core/money';
import { NotifyService } from '../core/notify.service';
import { moneyValidator } from './item-form-dialog';

export interface SaleDialogData {
  itemId: string;
  cardName: string;
  /** Quando informado, o diálogo corrige uma venda existente. */
  sale?: Pick<Sale, 'id' | 'soldAt' | 'salePriceCents' | 'notes'>;
}

@Component({
  selector: 'app-sale-dialog',
  imports: [MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, ReactiveFormsModule],
  template: `
    <h2 mat-dialog-title>{{ data.sale ? 'Corrigir venda' : 'Registrar venda' }}</h2>
    <mat-dialog-content>
      <p class="muted">{{ data.cardName }}</p>
      <form [formGroup]="form" id="sale-form" (ngSubmit)="save()">
        <mat-form-field class="w">
          <mat-label>Data da venda</mat-label>
          <input matInput type="date" formControlName="soldAt" required />
        </mat-form-field>
        <mat-form-field class="w">
          <mat-label>Valor da venda</mat-label>
          <span matTextPrefix>R$&nbsp;</span>
          <input matInput formControlName="price" inputmode="decimal" placeholder="0,00" required />
          @if (form.controls.price.invalid) {
            <mat-error>Informe um valor no formato 12,50.</mat-error>
          }
        </mat-form-field>
        <mat-form-field class="w">
          <mat-label>Observações</mat-label>
          <textarea matInput rows="2" formControlName="notes" maxlength="1000"></textarea>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button mat-flat-button type="submit" form="sale-form" [disabled]="saving() || form.invalid">
        {{ saving() ? 'Salvando…' : data.sale ? 'Salvar' : 'Marcar como vendido' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `.w { width: 100%; } .muted { color: var(--pw-muted); margin-top: 0; }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SaleDialog {
  readonly data = inject<SaleDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<SaleDialog, boolean>);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  readonly saving = signal(false);

  readonly form = inject(FormBuilder).nonNullable.group({
    soldAt: [this.data.sale ? toDateInput(this.data.sale.soldAt) : todayIso(), Validators.required],
    price: [centsToInput(this.data.sale?.salePriceCents), [Validators.required, moneyValidator]],
    notes: [this.data.sale?.notes ?? ''],
  });

  save() {
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const body = { soldAt: v.soldAt, salePriceCents: parseMoneyToCents(v.price) ?? 0, notes: v.notes.trim() || null };
    this.saving.set(true);
    const req = this.data.sale ? this.api.updateSale(this.data.sale.id, body) : this.api.sell(this.data.itemId, body);
    req.subscribe({
      next: () => {
        this.notify.success(this.data.sale ? 'Venda corrigida.' : 'Venda registrada!');
        this.ref.close(true);
      },
      error: (e) => {
        this.saving.set(false);
        this.notify.error(e);
      },
    });
  }
}
