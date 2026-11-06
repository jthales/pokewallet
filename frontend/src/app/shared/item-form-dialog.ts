import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators, type AbstractControl, type ValidationErrors } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ApiService } from '../core/api.service';
import { toDateInput } from '../core/date';
import { CONDITION_OPTIONS, LANGUAGE_OPTIONS, variantOptionsFor } from '../core/labels';
import { CatalogVariants, CollectionItem, Condition, PhysicalLanguage, Variant } from '../core/models';
import { centsToInput, parseMoneyToCents } from '../core/money';
import { NotifyService } from '../core/notify.service';
import { CardImage } from './card-image';

export interface ItemFormData {
  mode: 'create' | 'edit';
  card: { provider: string; externalId: string; name: string; setName: string | null; localNumber: string; imageUrl: string | null; rarity?: string | null };
  variants?: CatalogVariants | null;
  item?: CollectionItem;
  defaultLanguage?: PhysicalLanguage;
}

export interface ItemFormResult {
  cardId?: string;
  saved: number;
}

export function moneyValidator(control: AbstractControl): ValidationErrors | null {
  const v = parseMoneyToCents(control.value as string);
  return v !== null && Number.isNaN(v) ? { money: true } : null;
}

/** Formulário de exemplar: usado para cadastrar (com quantidade) e para editar. */
@Component({
  selector: 'app-item-form-dialog',
  imports: [MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, ReactiveFormsModule, CardImage],
  template: `
    <h2 mat-dialog-title>{{ data.mode === 'create' ? 'Confirmar e adicionar' : 'Editar exemplar' }}</h2>
    <mat-dialog-content>
      <div class="head">
        <app-card-image class="thumb" [src]="data.card.imageUrl" [alt]="data.card.name" eager />
        <div>
          <strong>{{ data.card.name }}</strong>
          <div class="muted">{{ data.card.setName ?? 'Expansão' }} · nº {{ data.card.localNumber }}</div>
          @if (data.card.rarity) {
            <div class="muted">{{ data.card.rarity }}</div>
          }
        </div>
      </div>
      <form [formGroup]="form" id="item-form" (ngSubmit)="save()" class="form-grid">
        @if (data.mode === 'create') {
          <mat-form-field>
            <mat-label>Quantidade de exemplares</mat-label>
            <input matInput type="number" min="1" max="50" formControlName="quantity" inputmode="numeric" />
            <mat-hint>Todos com os mesmos dados; edite cada um depois se precisar.</mat-hint>
            @if (form.controls.quantity.invalid) {
              <mat-error>Informe de 1 a 50.</mat-error>
            }
          </mat-form-field>
        }
        <mat-form-field>
          <mat-label>Condição</mat-label>
          <mat-select formControlName="condition">
            @for (o of conditions; track o.value) {
              <mat-option [value]="o.value">{{ o.label }} ({{ o.short }})</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Variante</mat-label>
          <mat-select formControlName="variant">
            @for (o of variants(); track o.value) {
              <mat-option [value]="o.value">{{ o.label }}</mat-option>
            }
          </mat-select>
          @if (data.variants) {
            <mat-hint>Variantes conhecidas pelo catálogo para esta carta.</mat-hint>
          }
        </mat-form-field>
        <mat-form-field>
          <mat-label>Idioma do exemplar</mat-label>
          <mat-select formControlName="language">
            @for (o of languages; track o.value) {
              <mat-option [value]="o.value">{{ o.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Data de aquisição</mat-label>
          <input matInput type="date" formControlName="acquiredAt" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Preço pago (opcional)</mat-label>
          <span matTextPrefix>R$&nbsp;</span>
          <input matInput formControlName="price" inputmode="decimal" placeholder="0,00" />
          @if (form.controls.price.invalid) {
            <mat-error>Use o formato 12,50.</mat-error>
          }
        </mat-form-field>
        <mat-form-field class="full">
          <mat-label>Observações</mat-label>
          <textarea matInput rows="2" formControlName="notes" maxlength="1000"></textarea>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancelar</button>
      <button mat-flat-button type="submit" form="item-form" [disabled]="saving() || form.invalid">
        {{ saving() ? 'Salvando…' : data.mode === 'create' ? 'Adicionar' : 'Salvar' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .head { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
    .thumb { width: 64px; flex: none; }
    .muted { color: var(--pw-muted); font-size: 13px; }
    .form-grid { display: grid; grid-template-columns: 1fr; gap: 4px 12px; }
    @media (min-width: 600px) { .form-grid { grid-template-columns: 1fr 1fr; } .full { grid-column: 1 / -1; } }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ItemFormDialog {
  readonly data = inject<ItemFormData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<ItemFormDialog, ItemFormResult>);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  private readonly fb = inject(FormBuilder).nonNullable;

  readonly conditions = CONDITION_OPTIONS;
  readonly languages = LANGUAGE_OPTIONS;
  readonly variants = computed(() => {
    const options = variantOptionsFor(this.data.variants);
    const current = this.data.item?.variant;
    // Na edição, nunca escondemos a variante já salva.
    return current && !options.some((o) => o.value === current) ? [...options, { value: current, label: current }] : options;
  });
  readonly saving = signal(false);

  readonly form = this.fb.group({
    quantity: [1, [Validators.required, Validators.min(1), Validators.max(50)]],
    condition: [(this.data.item?.condition ?? 'NEAR_MINT') as Condition, Validators.required],
    variant: [(this.data.item?.variant ?? this.defaultVariant()) as Variant, Validators.required],
    language: [(this.data.item?.language ?? this.data.defaultLanguage ?? 'pt') as PhysicalLanguage, Validators.required],
    acquiredAt: [toDateInput(this.data.item?.acquiredAt)],
    price: [centsToInput(this.data.item?.purchasePriceCents), moneyValidator],
    notes: [this.data.item?.notes ?? ''],
  });

  private defaultVariant(): Variant {
    const first = variantOptionsFor(this.data.variants)[0];
    return first?.value ?? 'NORMAL';
  }

  save() {
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const payload = {
      condition: v.condition,
      variant: v.variant,
      language: v.language,
      acquiredAt: v.acquiredAt || null,
      purchasePriceCents: parseMoneyToCents(v.price),
      notes: v.notes.trim() || null,
    };
    this.saving.set(true);
    const done = { error: (e: unknown) => (this.saving.set(false), this.notify.error(e)) };
    if (this.data.mode === 'create') {
      this.api
        .addItems({ ...payload, provider: this.data.card.provider, externalId: this.data.card.externalId, quantity: v.quantity })
        .subscribe({
          next: (r) => {
            this.notify.success(r.items.length > 1 ? `${r.items.length} exemplares adicionados!` : 'Carta adicionada à coleção!');
            this.ref.close({ cardId: r.cardId, saved: r.items.length });
          },
          ...done,
        });
    } else {
      this.api.updateItem(this.data.item!.id, payload).subscribe({
        next: () => {
          this.notify.success('Exemplar atualizado.');
          this.ref.close({ saved: 1 });
        },
        ...done,
      });
    }
  }
}
