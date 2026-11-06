import { Injectable } from '@angular/core';
import { IdentificationCandidate } from '../../core/models';
import { RelativeRect, loadBitmap } from './image-utils';

/**
 * Região da ilustração em uma carta padrão. É a parte que mais muda entre impressões da mesma carta
 * (Furret de Darkness Ablaze × Furret de HeartGold), enquanto o texto e a moldura se repetem.
 */
export const ART_REGION: RelativeRect = { x: 0.08, y: 0.1, w: 0.84, h: 0.42 };

/** Lado da miniatura comparada. Pequeno de propósito: tolera desfoque, reflexo e enquadramento imperfeito. */
const SIDE = 20;
const FETCH_TIMEOUT_MS = 5000;

/**
 * Assinatura visual: miniatura RGB da ilustração com cada canal normalizado (média 0, desvio 1),
 * o que neutraliza diferenças de brilho e contraste entre a foto e a imagem oficial.
 */
export function artSignature(source: CanvasImageSource & { width: number; height: number }, region: RelativeRect = ART_REGION): Float32Array | null {
  // Reduz em duas etapas para a média dos pixels não virar serrilhado.
  const mid = document.createElement('canvas');
  mid.width = SIDE * 4;
  mid.height = SIDE * 4;
  const midCtx = mid.getContext('2d');
  const small = document.createElement('canvas');
  small.width = SIDE;
  small.height = SIDE;
  const ctx = small.getContext('2d', { willReadFrequently: true });
  if (!midCtx || !ctx) return null;
  midCtx.imageSmoothingQuality = 'high';
  midCtx.drawImage(
    source,
    region.x * source.width,
    region.y * source.height,
    region.w * source.width,
    region.h * source.height,
    0,
    0,
    mid.width,
    mid.height,
  );
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mid, 0, 0, SIDE, SIDE);
  const data = ctx.getImageData(0, 0, SIDE, SIDE).data;
  const n = SIDE * SIDE;
  const out = new Float32Array(n * 3);
  for (let c = 0; c < 3; c++) {
    let mean = 0;
    for (let p = 0; p < n; p++) mean += data[p * 4 + c]!;
    mean /= n;
    let variance = 0;
    for (let p = 0; p < n; p++) variance += (data[p * 4 + c]! - mean) ** 2;
    const sd = Math.sqrt(variance / n) || 1;
    for (let p = 0; p < n; p++) out[p * 3 + c] = (data[p * 4 + c]! - mean) / sd;
  }
  return out;
}

/** Similaridade de cosseno entre duas assinaturas (−1 a 1; na prática, ~0,1 para cartas diferentes e 0,3+ para a mesma). */
export function signatureSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Peso da semelhança visual somado à pontuação do texto. Desempata impressões; não supera nome + número. */
export const VISUAL_WEIGHT = 0.4;
/** Abaixo disso a semelhança não é tratada como evidência. */
const MIN_VISUAL = 0.15;

/**
 * Reordena os candidatos comparando a ilustração da foto com a imagem oficial de cada um (TCGdex, que libera CORS).
 * Tudo roda no navegador; se algo falhar (sem rede, sem canvas), devolve a lista como veio.
 */
export function rerankByVisual(candidates: IdentificationCandidate[], similarities: Map<string, number>): IdentificationCandidate[] {
  if (!similarities.size) return candidates;
  const values = [...similarities.values()].sort((a, b) => b - a);
  const best = values[0]!;
  const second = values[1] ?? -1;
  return candidates
    .map((c) => {
      const sim = similarities.get(c.externalId);
      if (sim === undefined || sim < MIN_VISUAL) return c;
      const reasons = sim === best && best - second >= 0.03 ? [...c.reasons, 'imagem'] : c.reasons;
      return { ...c, score: Math.round((c.score + VISUAL_WEIGHT * sim) * 1000) / 1000, reasons };
    })
    .sort((a, b) => b.score - a.score);
}

@Injectable({ providedIn: 'root' })
export class VisualMatchService {
  /** Semelhança visual entre a foto e cada candidato com imagem. Candidatos sem imagem ou com falha ficam de fora. */
  async similarities(photo: Blob, candidates: IdentificationCandidate[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    let mine: Float32Array | null;
    try {
      const bitmap = await loadBitmap(photo);
      mine = artSignature(bitmap);
      bitmap.close();
    } catch {
      return result;
    }
    if (!mine) return result;
    const reference = mine;
    await Promise.all(
      candidates.map(async (c) => {
        if (!c.image?.small) return;
        try {
          const sig = await this.signatureOf(c.image.small);
          if (sig) result.set(c.externalId, signatureSimilarity(reference, sig));
        } catch {
          // imagem indisponível: o candidato só não ganha nem perde pontos
        }
      }),
    );
    return result;
  }

  private readonly cache = new Map<string, Promise<Float32Array | null>>();

  private signatureOf(url: string): Promise<Float32Array | null> {
    let pending = this.cache.get(url);
    if (!pending) {
      pending = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
          const response = await fetch(url, { signal: controller.signal, mode: 'cors' });
          if (!response.ok) return null;
          const bitmap = await createImageBitmap(await response.blob());
          const sig = artSignature(bitmap);
          bitmap.close();
          return sig;
        } finally {
          clearTimeout(timer);
        }
      })();
      pending.catch(() => this.cache.delete(url));
      this.cache.set(url, pending);
      if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!);
    }
    return pending;
  }
}
