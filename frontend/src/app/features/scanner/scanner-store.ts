import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService, errorMessage } from '../../core/api.service';
import { IdentificationCandidate, IdentificationResult } from '../../core/models';
import { validateImageFile } from './image-utils';
import { OcrOutput, OcrProgress, OcrService } from './ocr.service';
import { VisualMatchService, rerankByVisual } from './visual-match';

/** Quantos candidatos aparecem por vez. */
const PAGE_SIZE = 5;
/** Quantos candidatos são comparados pela imagem: a impressão certa pode estar fora dos 5 primeiros pelo texto. */
const VISUAL_POOL = 20;

export type ScannerStep = 'capture' | 'preview' | 'processing' | 'results';

/** Estado do fluxo de escaneamento (foto → OCR → identificação → candidatos). */
@Injectable()
export class ScannerStore {
  private readonly api = inject(ApiService);
  private readonly ocr = inject(OcrService);
  private readonly visual = inject(VisualMatchService);
  /** Candidatos já buscados e reordenados que ainda não foram mostrados. */
  private queued: IdentificationCandidate[] = [];
  /** Próximo deslocamento no servidor (depois do lote comparado pela imagem). */
  private serverOffset = 0;
  private serverHasMore = false;

  readonly step = signal<ScannerStep>('capture');
  readonly image = signal<Blob | null>(null);
  readonly previewUrl = signal<string | null>(null);
  readonly cropRegions = signal(true);
  readonly error = signal<string | null>(null);
  readonly ocrText = signal<OcrOutput | null>(null);
  readonly result = signal<IdentificationResult | null>(null);
  readonly candidates = signal<IdentificationCandidate[]>([]);
  readonly loadingMore = signal(false);
  private readonly matching = signal(false);
  /** Progresso do OCR e, depois dele, da comparação com as imagens oficiais. */
  readonly progress = computed<OcrProgress | null>(() =>
    this.matching() ? { stage: 'full', label: 'Comparando com as imagens oficiais…', value: 0.95 } : this.ocr.progress(),
  );

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
      const result = await firstValueFrom(this.api.identify({ ...text, limit: VISUAL_POOL, offset: 0 }));
      this.matching.set(true);
      const similarities = await this.visual.similarities(image, result.candidates).catch(() => new Map<string, number>());
      this.matching.set(false);
      const ranked = rerankByVisual(result.candidates, similarities);
      this.serverOffset = result.candidates.length;
      this.serverHasMore = result.hasMore;
      this.queued = ranked.slice(PAGE_SIZE);
      this.candidates.set(ranked.slice(0, PAGE_SIZE));
      this.result.set({ ...result, candidates: this.candidates(), hasMore: this.hasMore() });
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
      if (!this.queued.length) {
        const result = await firstValueFrom(this.api.identify({ ...text, limit: PAGE_SIZE, offset: this.serverOffset }));
        this.serverOffset += result.candidates.length;
        this.serverHasMore = result.hasMore;
        this.queued = result.candidates;
      }
      this.candidates.update((c) => [...c, ...this.queued.slice(0, PAGE_SIZE)]);
      this.queued = this.queued.slice(PAGE_SIZE);
      this.result.update((r) => (r ? { ...r, candidates: this.candidates(), hasMore: this.hasMore() } : r));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loadingMore.set(false);
    }
  }

  private hasMore() {
    return this.queued.length > 0 || this.serverHasMore;
  }

  reset() {
    this.queued = [];
    this.serverOffset = 0;
    this.serverHasMore = false;
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
