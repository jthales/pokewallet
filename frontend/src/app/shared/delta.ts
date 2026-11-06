import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { formatPct, formatSignedCents } from '../core/money';

/** Variação em reais e/ou percentual, com ícone + cor (nunca só a cor) e texto acessível. */
@Component({
  selector: 'app-delta',
  imports: [MatIconModule],
  template: `
    @if (cents() === null && pct() === null) {
      <span class="delta none">{{ emptyLabel() }}</span>
    } @else {
      <span class="delta" [class.up]="dir() > 0" [class.down]="dir() < 0" [attr.aria-label]="aria()">
        <mat-icon aria-hidden="true">{{ dir() > 0 ? 'trending_up' : dir() < 0 ? 'trending_down' : 'trending_flat' }}</mat-icon>
        @if (cents() !== null) {
          <span>{{ signed() }}</span>
        }
        @if (pct() !== null) {
          <span class="pct">{{ cents() !== null ? '(' + pctText() + ')' : pctText() }}</span>
        }
      </span>
    }
  `,
  styles: `
    :host { display: inline-flex; }
    .delta { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0 4px; font-weight: 700; color: var(--pw-muted); }
    .delta > span { white-space: nowrap; }
    .delta.up { color: var(--pw-gain); }
    .delta.down { color: var(--pw-loss); }
    .delta.none { font-weight: 600; }
    mat-icon { width: 18px; height: 18px; font-size: 18px; }
    .pct { font-weight: 600; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Delta {
  readonly cents = input<number | null>(null);
  readonly pct = input<number | null>(null);
  readonly emptyLabel = input('—');
  readonly dir = computed(() => Math.sign(this.cents() ?? this.pct() ?? 0));
  readonly signed = computed(() => formatSignedCents(this.cents()));
  readonly pctText = computed(() => formatPct(this.pct()));
  readonly aria = computed(() => {
    const word = this.dir() > 0 ? 'Valorização' : this.dir() < 0 ? 'Desvalorização' : 'Sem variação';
    const parts = [this.cents() !== null ? this.signed() : null, this.pct() !== null ? this.pctText() : null].filter(Boolean);
    return `${word}: ${parts.join(', ')}`;
  });
}
