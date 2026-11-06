import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input, signal } from '@angular/core';

/**
 * Imagem oficial da carta com skeleton enquanto carrega e placeholder quando não há imagem.
 * `fallback` (ex.: a imagem em inglês) é usada se `src` (ex.: a imagem em português) não carregar.
 */
@Component({
  selector: 'app-card-image',
  template: `
    <div class="frame" [class.loaded]="loaded()" [class.missing]="!current() || failed()">
      @if (current() && !failed()) {
        <img
          [src]="current()"
          [alt]="alt()"
          [attr.loading]="eager() ? 'eager' : 'lazy'"
          decoding="async"
          (load)="loaded.set(true)"
          (error)="onError()"
        />
      }
      @if (!current() || failed()) {
        <div class="placeholder" role="img" [attr.aria-label]="alt() + ' (imagem indisponível)'">
          <span class="ball" aria-hidden="true"></span>
          <span>{{ label() }}</span>
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .frame {
      position: relative;
      aspect-ratio: 63 / 88;
      border-radius: 4.5% / 3.2%;
      overflow: hidden;
      background: linear-gradient(110deg, var(--pw-skeleton) 8%, var(--pw-skeleton-shine) 18%, var(--pw-skeleton) 33%);
      background-size: 200% 100%;
      animation: shimmer 1.4s linear infinite;
    }
    .frame.loaded, .frame.missing { animation: none; background: var(--pw-surface-2); }
    img { width: 100%; height: 100%; object-fit: cover; display: block; opacity: 0; transition: opacity .25s; }
    .loaded img { opacity: 1; }
    .placeholder {
      position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 8px; color: var(--pw-muted); font-size: 12px; text-align: center; padding: 8px;
    }
    .ball {
      width: 36px; height: 36px; border-radius: 50%; border: 3px solid currentColor; position: relative; opacity: .5;
      background: linear-gradient(currentColor 0 0) center / 100% 3px no-repeat;
    }
    @keyframes shimmer { to { background-position-x: -200%; } }
    @media (prefers-reduced-motion: reduce) { .frame { animation: none; } }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardImage {
  readonly src = input<string | null | undefined>(null);
  readonly fallback = input<string | null | undefined>(null);
  readonly alt = input('Carta Pokémon');
  readonly eager = input(false, { transform: booleanAttribute });
  readonly loaded = signal(false);
  readonly failed = signal(false);
  readonly usingFallback = signal(false);
  readonly current = computed(() => (this.usingFallback() ? this.fallback() : this.src()) || this.fallback());
  readonly label = computed(() => (this.current() ? 'Imagem indisponível' : 'Sem imagem oficial'));

  onError() {
    const fb = this.fallback();
    if (!this.usingFallback() && fb && fb !== this.src()) {
      this.usingFallback.set(true);
      this.loaded.set(false);
    } else {
      this.failed.set(true);
    }
  }
}
