import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Subscription } from 'rxjs';
import { ApiService, errorMessage } from '../../core/api.service';
import { CollectionCard, CollectionFilters, CollectionQuery, ItemStatus } from '../../core/models';
import { CardImage } from '../../shared/card-image';
import { EmptyState } from '../../shared/empty-state';
import { SkeletonGrid } from '../../shared/skeleton-grid';

type SortKey = 'createdAt-desc' | 'createdAt-asc' | 'name-asc' | 'name-desc';

@Component({
  selector: 'app-collection-page',
  imports: [FormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, CardImage, EmptyState, SkeletonGrid],
  templateUrl: './collection-page.html',
  styleUrl: './collection-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollectionPage {
  private readonly api = inject(ApiService);

  readonly search = signal('');
  readonly setId = signal('');
  readonly rarity = signal('');
  readonly status = signal<ItemStatus | ''>('');
  readonly sort = signal<SortKey>('createdAt-desc');

  readonly cards = signal<CollectionCard[]>([]);
  readonly filters = signal<CollectionFilters>({ sets: [], rarities: [] });
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly hasFilters = () => !!(this.search() || this.setId() || this.rarity() || this.status());

  private sub?: Subscription;
  private debounce?: ReturnType<typeof setTimeout>;

  constructor() {
    this.api.collectionFilters().subscribe({ next: (f) => this.filters.set(f), error: () => undefined });
    // Recarrega sempre que um filtro muda; a busca por texto tem debounce.
    effect(() => {
      const query: CollectionQuery = {
        search: this.search().trim() || undefined,
        setId: this.setId() || undefined,
        rarity: this.rarity() || undefined,
        status: this.status() || undefined,
        sort: this.sort().startsWith('name') ? 'name' : 'createdAt',
        order: this.sort().endsWith('asc') ? 'asc' : 'desc',
      };
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => this.load(query), query.search ? 250 : 0);
    });
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.debounce);
      this.sub?.unsubscribe();
    });
  }

  private load(query: CollectionQuery) {
    this.sub?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.sub = this.api.listCollection(query).subscribe({
      next: (cards) => {
        this.cards.set(cards);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(errorMessage(e));
        this.loading.set(false);
      },
    });
  }

  clear() {
    this.search.set('');
    this.setId.set('');
    this.rarity.set('');
    this.status.set('');
  }
}
