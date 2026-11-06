import { Injectable, signal } from '@angular/core';
import type Tesseract from 'tesseract.js';
import { NAME_REGION, NAME_REGION_TALL, NUMBER_CORNERS, NUMBER_REGION, cropRegion, enhancedCopy, loadBitmap, resizeForProcessing } from './image-utils';

export interface OcrOutput {
  fullText: string;
  nameText: string;
  numberText: string;
}

export interface OcrProgress {
  stage: 'loading' | 'name' | 'number' | 'full';
  label: string;
  /** 0–1 quando conhecido. */
  value: number | null;
}

/** Tempo sem uso após o qual o worker do OCR é encerrado para liberar memória. */
const IDLE_TIMEOUT_MS = 60_000;

function assetUrl(path: string) {
  return new URL(path, document.baseURI).href;
}

/**
 * OCR local com Tesseract.js. Nada da imagem sai do dispositivo: o worker, o core WebAssembly e os modelos
 * de idioma (inglês + português, versão "best_int" compacta) são servidos pelo próprio app e ficam
 * em cache no IndexedDB do navegador depois do primeiro download (~4,3 MB).
 */
@Injectable({ providedIn: 'root' })
export class OcrService {
  readonly progress = signal<OcrProgress | null>(null);
  private worker: Promise<Tesseract.Worker> | null = null;
  private idleTimer?: ReturnType<typeof setTimeout>;

  private async getWorker(): Promise<Tesseract.Worker> {
    if (!this.worker) {
      this.worker = (async () => {
        const mod = (await import('tesseract.js')) as unknown as typeof Tesseract & { default?: typeof Tesseract };
        const T = mod.default ?? mod;
        this.progress.set({ stage: 'loading', label: 'Preparando o leitor de texto…', value: null });
        return T.createWorker(['eng', 'por'], T.OEM.LSTM_ONLY, {
          workerPath: assetUrl('tesseract/worker.min.js'),
          corePath: assetUrl('tesseract/core'),
          langPath: assetUrl('tesseract/lang'),
          gzip: true,
          cacheMethod: 'write',
          logger: (m: { status: string; progress: number }) => {
            if (m.status.includes('loading') || m.status.includes('initializ')) {
              this.progress.set({ stage: 'loading', label: 'Preparando o leitor de texto (só demora na primeira vez)…', value: m.progress });
            }
          },
        });
      })().catch((error) => {
        this.worker = null;
        throw new Error('Não foi possível iniciar o OCR neste navegador.', { cause: error });
      });
    }
    return this.worker;
  }

  /** Lê a foto da carta. Com `cropRegions`, lê também as faixas do nome e do número separadamente. */
  async recognize(image: Blob, cropRegions = true): Promise<OcrOutput> {
    clearTimeout(this.idleTimer);
    try {
      const bitmap = await loadBitmap(image);
      const base = resizeForProcessing(bitmap);
      bitmap.close();
      const worker = await this.getWorker();
      const PSM = { SINGLE_BLOCK: '6', SPARSE_TEXT: '11', AUTO: '3' } as const;

      let nameText = '';
      let numberText = '';
      if (cropRegions) {
        this.progress.set({ stage: 'name', label: 'Lendo o nome…', value: 0.33 });
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK as Tesseract.PSM });
        const tight = (await worker.recognize(cropRegion(base, NAME_REGION, 2))).data.text;
        const tall = (await worker.recognize(cropRegion(base, NAME_REGION_TALL, 2))).data.text;
        nameText = `${tight}\n${tall}`;

        this.progress.set({ stage: 'number', label: 'Lendo o número…', value: 0.66 });
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT as Tesseract.PSM });
        numberText = (await worker.recognize(cropRegion(base, NUMBER_REGION, 2.5))).data.text;
        // Os cantos só com dígitos: o servidor confere neles o número de cada candidato, tolerando erros.
        await worker.setParameters({ tessedit_char_whitelist: '0123456789/' });
        try {
          for (const corner of NUMBER_CORNERS) numberText += `\n${(await worker.recognize(cropRegion(base, corner, 3))).data.text}`;
        } finally {
          await worker.setParameters({ tessedit_char_whitelist: '' });
        }
      }

      this.progress.set({ stage: 'full', label: 'Lendo o restante da carta…', value: cropRegions ? 0.9 : 0.5 });
      await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO as Tesseract.PSM });
      const fullText = (await worker.recognize(enhancedCopy(base))).data.text;

      return { fullText, nameText, numberText };
    } finally {
      this.progress.set(null);
      this.idleTimer = setTimeout(() => void this.release(), IDLE_TIMEOUT_MS);
    }
  }

  /** Encerra o worker e libera a memória do WebAssembly. */
  async release(): Promise<void> {
    clearTimeout(this.idleTimer);
    const current = this.worker;
    this.worker = null;
    if (current) {
      try {
        await (await current).terminate();
      } catch {
        // worker já encerrado ou falhou ao iniciar
      }
    }
  }
}
