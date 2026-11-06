import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { CONFIDENCE_LABEL } from '../../core/labels';
import { IdentificationCandidate } from '../../core/models';
import { CardImage } from '../../shared/card-image';
import { EmptyState } from '../../shared/empty-state';
import { AddCardFlow } from './add-card';
import { CameraCapture } from './camera-capture';
import { ACCEPTED_IMAGE_TYPES } from './image-utils';
import { ManualSearch } from './manual-search';
import { ScannerStore } from './scanner-store';

@Component({
  selector: 'app-scanner-page',
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule, MatSlideToggleModule, MatTabsModule, CardImage, EmptyState, CameraCapture, ManualSearch],
  providers: [ScannerStore],
  templateUrl: './scanner-page.html',
  styleUrl: './scanner-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScannerPage {
  readonly store = inject(ScannerStore);
  private readonly addFlow = inject(AddCardFlow);
  readonly manual = viewChild(ManualSearch);
  readonly tab = signal(0);
  readonly accept = ACCEPTED_IMAGE_TYPES.join(',');
  readonly confidenceLabel = CONFIDENCE_LABEL;
  readonly hints = computed(() => this.store.result()?.hints ?? null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.store.destroy());
  }

  onFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) this.store.setImage(file);
  }

  onCaptured(blob: Blob) {
    this.store.setImage(blob, true);
  }

  confirm(c: IdentificationCandidate) {
    this.addFlow.open(c.externalId, { name: c.name, localNumber: c.localNumber, imageUrl: c.image?.small ?? null, setName: c.setName, rarity: c.rarity });
  }

  /** Vai para a busca manual já preenchida com o que o OCR leu. */
  goManual() {
    const h = this.hints();
    this.tab.set(1);
    queueMicrotask(() => this.manual()?.prefill(h?.nameCandidates[0] ?? '', h?.localNumber ?? ''));
  }
}
