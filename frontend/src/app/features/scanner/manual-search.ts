import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ApiService, errorMessage } from '../../core/api.service';
import { CatalogCardSummary, CatalogLanguage, CatalogSetSummary } from '../../core/models';
import { CardImage } from '../../shared/card-image';
import { EmptyState } from '../../shared/empty-state';
import { SkeletonGrid } from '../../shared/skeleton-grid';
import { AddCardFlow } from './add-card';

const PAGE_SIZE = 24;

/** Busca manual no catálogo: funciona mesmo quando o OCR não reconhece a carta. */
@Component({
  selector: 'app-manual-search',
  imports: [FormsModule, MatAutocompleteModule, MatButtonModule, MatButtonToggleModule, MatFormFieldModule, MatIconModule, MatInputModule, CardImage, EmptyState, SkeletonGrid],
  template: `
    <form class="panel form" (ngSubmit)="search()" role="search">
      <mat-form-field class="name">
        <mat-label>Nome da carta</mat-label>
        <input matInput name="name" [ngModel]="name()" (ngModelChange)="name.set($event)" placeholder="Ex.: Pikachu" autocomplete="off" />
      </mat-form-field>
      <mat-form-field>
        <mat-label>Número</mat-label>
        <input matInput name="number" [ngModel]="number()" (ngModelChange)="number.set($event)" placeholder="Ex.: 136 ou TG01" autocomplete="off" />
        <mat-hint>Só o número local (136 em 136/189)</mat-hint>
      </mat-form-field>
      <mat-form-field>
        <mat-label>Expansão</mat-label>
        <input
          matInput
          name="set"
          [ngModel]="setQuery()"
          (ngModelChange)="onSetInput($event)"
          [matAutocomplete]="auto"
          (focus)="loadSets()"
          placeholder="Todas"
          autocomplete="off"
        />
        @if (selectedSet()) {
          <button matSuffix mat-icon-button type="button" aria-label="Limpar expansão" (click)="clearSet()"><mat-icon>close</mat-icon></button>
        }
        <mat-autocomplete #auto="matAutocomplete" [displayWith]="displaySet" (optionSelected)="selectSet($event.option.value)">
          @for (s of filteredSets(); track s.externalId) {
            <mat-option [value]="s">{{ s.name }} <span class="muted">({{ s.officialCount ?? '?' }} cartas)</span></mat-option>
          }
        </mat-autocomplete>
      </mat-form-field>
      <div class="row">
        <mat-button-toggle-group name="lang" [value]="lang()" (change)="lang.set($event.value)" aria-label="Idioma da busca" hideSingleSelectionIndicator>
          <mat-button-toggle value="en">EN</mat-button-toggle>
          <mat-button-toggle value="pt">PT</mat-button-toggle>
        </mat-button-toggle-group>
        <button mat-flat-button type="submit" [disabled]="!canSearch() || loading()"><mat-icon>search</mat-icon>Buscar</button>
      </div>
    </form>

    @if (error()) {
      <div class="panel error" role="alert">{{ error() }}</div>
    }
    @if (loading() && !results().length) {
      <app-skeleton-grid [count]="6" />
    } @else if (searched() && !results().length && !error()) {
      <app-empty-state icon="search_off" title="Nenhuma carta encontrada" message="Confira a grafia, tente só parte do nome ou busque em outro idioma." />
    } @else if (results().length) {
      <p class="muted" aria-live="polite">Toque na carta correta para confirmar.</p>
      <div class="card-grid">
        @for (c of results(); track c.externalId) {
          <button class="tile pick" type="button" (click)="pick(c)" [attr.aria-label]="'Selecionar ' + c.name + ' ' + c.localNumber + ' ' + setName(c.setId)">
            <app-card-image [src]="c.image?.small" [alt]="c.name" />
            <div class="name">{{ c.name }}</div>
            <div class="meta">{{ setName(c.setId) }} · nº {{ c.localNumber }}</div>
          </button>
        }
      </div>
      @if (hasMore()) {
        <div class="more"><button mat-stroked-button (click)="next()" [disabled]="loading()">{{ loading() ? 'Carregando…' : 'Mostrar mais' }}</button></div>
      }
    }
  `,
  styles: `
    .form { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
    .form .name { grid-column: 1 / -1; }
    .row { grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    @media (min-width: 840px) { .form { grid-template-columns: 2fr 1fr 2fr auto; align-items: start; } .form .name, .row { grid-column: auto; } }
    .pick { border: 0; background: none; text-align: left; font: inherit; cursor: pointer; width: 100%; }
    .error { color: #b3261e; margin-bottom: 12px; }
    .more { display: flex; justify-content: center; margin: 20px 0; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManualSearch {
  private readonly api = inject(ApiService);
  private readonly addFlow = inject(AddCardFlow);
  /** Valores iniciais (ex.: vindos do OCR). */
  readonly initialName = input('');
  readonly initialNumber = input('');

  readonly name = signal('');
  readonly number = signal('');
  readonly lang = signal<CatalogLanguage>('en');
  readonly sets = signal<CatalogSetSummary[]>([]);
  readonly setQuery = signal<string>('');
  readonly selectedSet = signal<CatalogSetSummary | null>(null);
  readonly results = signal<CatalogCardSummary[]>([]);
  readonly loading = signal(false);
  readonly searched = signal(false);
  readonly hasMore = signal(false);
  readonly error = signal<string | null>(null);
  private page = 1;

  readonly canSearch = computed(() => !!(this.name().trim() || this.number().trim() || this.selectedSet()));
  readonly filteredSets = computed(() => {
    const q = this.setQuery().toLowerCase().trim();
    const list = this.sets();
    return (q ? list.filter((s) => s.name.toLowerCase().includes(q) || s.externalId.toLowerCase().includes(q)) : list).slice(0, 50);
  });
  private readonly setNames = computed(() => new Map(this.sets().map((s) => [s.externalId, s.name])));

  readonly displaySet = (v: CatalogSetSummary | string | null) => (typeof v === 'string' ? v : (v?.name ?? ''));

  prefill(name: string, number: string) {
    this.name.set(name);
    this.number.set(number);
  }

  setName(id: string | null) {
    if (!id) return 'Expansão desconhecida';
    return this.setNames().get(id) ?? id;
  }

  loadSets() {
    if (this.sets().length) return;
    this.api.getSets(this.lang()).subscribe({
      // Mais recentes primeiro (a API devolve em ordem cronológica).
      next: (s) => this.sets.set([...s].reverse()),
      error: () => undefined,
    });
  }

  onSetInput(value: string | CatalogSetSummary) {
    if (typeof value === 'string') {
      this.setQuery.set(value);
      if (!value) this.selectedSet.set(null);
    }
  }

  selectSet(set: CatalogSetSummary) {
    this.selectedSet.set(set);
    this.setQuery.set(set.name);
  }

  clearSet() {
    this.selectedSet.set(null);
    this.setQuery.set('');
  }

  search() {
    if (!this.canSearch()) return;
    this.loadSets();
    this.page = 1;
    this.results.set([]);
    this.fetch();
  }

  next() {
    this.page++;
    this.fetch();
  }

  private fetch() {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .searchCatalog({
        name: this.name().trim() || undefined,
        number: this.number().trim() || undefined,
        setId: this.selectedSet()?.externalId,
        page: this.page,
        pageSize: PAGE_SIZE,
        lang: this.lang(),
      })
      .subscribe({
        next: (r) => {
          this.results.update((prev) => [...prev, ...r.cards]);
          this.hasMore.set(r.hasMore);
          this.searched.set(true);
          this.loading.set(false);
        },
        error: (e) => {
          this.error.set(errorMessage(e));
          this.loading.set(false);
        },
      });
  }

  pick(card: CatalogCardSummary) {
    this.addFlow.open(card.externalId, {
      name: card.name,
      localNumber: card.localNumber,
      imageUrl: card.image?.small ?? null,
      setName: this.setName(card.setId),
    });
  }
}
