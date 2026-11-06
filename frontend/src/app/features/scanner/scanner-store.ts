import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService, errorMessage } from '../../core/api.service';
import { IdentificationCandidate, IdentificationResult } from '../../core/models';
import { validateImageFile } from './image-utils';
import { OcrOutput, OcrService } from './ocr.service';

export type ScannerStep = 'capture' | 'preview' | 'processing' | 'results';

/** Estado do fluxo de escaneamento (foto → OCR → identificação → candidatos). */
@Injectable()
export class ScannerStore {
  private readonly api = inject(ApiService);
  private readonly ocr = inject(OcrService);

  readonly step = signal<ScannerStep>('capture');
  readonly image = signal<Blob | null>(null);
  readonly previewUrl = signal<string | null>(null);
  readonly cropRegions = signal(true);
  readonly error = signal<string | null>(null);
  readonly ocrText = signal<OcrOutput | null>(null);
  readonly result = signal<IdentificationResult | null>(null);
  readonly candidates = signal<IdentificationCandidate[]>([]);
  readonly loadingMore = signal(false);
  readonly progress = this.ocr.progress;

  /** Recebe uma foto (upload ou câmera). Retorna false quando o arquivo é inválido. */
  setImage(blob: Blob, fromCamera = false): boolean {
    if (!fromCamera) {
      const invalid = validateImageFile(blob as File);
      if (invalid) {
        this.error.set(invalid);
        return false;
      }
    }
    this.revokePreview();
    this.image.set(blob);
    this.previewUrl.set(URL.createObjectURL(blob));
    // A foto da câmera já vem recortada na moldura da carta.
    this.cropRegions.set(true);
    this.error.set(null);
    this.result.set(null);
    this.candidates.set([]);
    this.step.set('preview');
    return true;
  }

  async identify(): Promise<void> {
    const image = this.image();
    if (!image) return;
    this.error.set(null);
    this.step.set('processing');
    let text: OcrOutput;
    try {
      text = await this.ocr.recognize(image, this.cropRegions());
      this.ocrText.set(text);
    } catch (e) {
      this.error.set(`${errorMessage(e, 'O OCR falhou.')} Você pode tentar outra foto ou usar a busca manual.`);
      this.step.set('preview');
      return;
    }
    try {
      const result = await firstValueFrom(this.api.identify({ ...text, limit: 5, offset: 0 }));
      this.result.set(result);
      this.candidates.set(result.candidates);
      this.step.set('results');
    } catch (e) {
      this.error.set(errorMessage(e, 'Não foi possível consultar o catálogo.'));
      this.step.set('preview');
    }
  }

  async loadMore(): Promise<void> {
    const text = this.ocrText();
    if (!text || this.loadingMore()) return;
    this.loadingMore.set(true);
    try {
      const result = await firstValueFrom(this.api.identify({ ...text, limit: 5, offset: this.candidates().length }));
      this.result.set({ ...result, candidates: [...this.candidates(), ...result.candidates] });
      this.candidates.update((c) => [...c, ...result.candidates]);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loadingMore.set(false);
    }
  }

  reset() {
    this.revokePreview();
    this.image.set(null);
    this.error.set(null);
    this.result.set(null);
    this.candidates.set([]);
    this.ocrText.set(null);
    this.step.set('capture');
  }

  destroy() {
    this.revokePreview();
    void this.ocr.release();
  }

  private revokePreview() {
    const url = this.previewUrl();
    if (url) URL.revokeObjectURL(url);
    this.previewUrl.set(null);
  }
}
