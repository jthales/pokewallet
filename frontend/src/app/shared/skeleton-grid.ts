import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-skeleton-grid',
  template: `
    <div class="card-grid" aria-busy="true" aria-label="Carregando">
      @for (i of items(); track i) {
        <div class="sk">
          <div class="img"></div>
          <div class="line"></div>
          <div class="line short"></div>
        </div>
      }
    </div>
  `,
  styles: `
    .sk .img { aspect-ratio: 63/88; border-radius: 10px; }
    .sk .line { height: 12px; margin-top: 8px; border-radius: 6px; }
    .sk .short { width: 60%; }
    .sk .img, .sk .line {
      background: linear-gradient(110deg, var(--pw-skeleton) 8%, var(--pw-skeleton-shine) 18%, var(--pw-skeleton) 33%);
      background-size: 200% 100%; animation: shimmer 1.4s linear infinite;
    }
    @keyframes shimmer { to { background-position-x: -200%; } }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkeletonGrid {
  readonly count = input(8);
  readonly items = computed(() => Array.from({ length: this.count() }, (_, i) => i));
}
