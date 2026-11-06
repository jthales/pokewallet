import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ApiService, errorMessage } from '../../core/api.service';
import { Dashboard } from '../../core/models';
import { CardImage } from '../../shared/card-image';
import { EmptyState } from '../../shared/empty-state';
import { SkeletonGrid } from '../../shared/skeleton-grid';

@Component({
  selector: 'app-dashboard-page',
  imports: [RouterLink, MatButtonModule, MatIconModule, CardImage, EmptyState, SkeletonGrid],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPage {
  private readonly api = inject(ApiService);
  readonly data = signal<Dashboard | null>(null);
  readonly error = signal<string | null>(null);
  readonly loading = signal(true);
  readonly stats = computed(() => {
    const d = this.data();
    return [
      { label: 'Cartas distintas', value: d?.distinctCards, icon: 'style' },
      { label: 'Exemplares', value: d?.totalItems, icon: 'layers' },
      { label: 'Disponíveis', value: d?.availableItems, icon: 'inventory_2' },
      { label: 'Vendidos', value: d?.soldItems, icon: 'sell' },
    ];
  });

  constructor() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.error.set(null);
    this.api.dashboard().subscribe({
      next: (d) => {
        this.data.set(d);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(errorMessage(e));
        this.loading.set(false);
      },
    });
  }
}
