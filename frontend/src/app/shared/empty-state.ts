import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-empty-state',
  imports: [MatIconModule],
  template: `
    <div class="empty" role="status">
      <mat-icon aria-hidden="true">{{ icon() }}</mat-icon>
      <h2>{{ title() }}</h2>
      @if (message()) {
        <p>{{ message() }}</p>
      }
      <ng-content />
    </div>
  `,
  styles: `
    .empty { text-align: center; padding: 40px 16px; color: var(--pw-muted); display: flex; flex-direction: column; align-items: center; gap: 8px; }
    mat-icon { font-size: 48px; width: 48px; height: 48px; color: var(--pw-accent); }
    h2 { margin: 8px 0 0; color: var(--mat-sys-on-surface); font: var(--mat-sys-title-medium); }
    p { margin: 0; max-width: 360px; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmptyState {
  readonly icon = input('style');
  readonly title = input.required<string>();
  readonly message = input<string>();
}
