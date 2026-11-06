/** Formatos aceitos para upload. HEIC não é decodificado pela maioria dos navegadores, por isso fica de fora. */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Valida tipo e tamanho do arquivo. Retorna uma mensagem de erro ou null quando está ok. */
export function validateImageFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return 'Formato não suportado. Envie uma foto JPG, PNG ou WebP.';
  }
  if (file.size === 0) return 'O arquivo está vazio.';
  if (file.size > MAX_IMAGE_BYTES) return `A imagem passa de ${MAX_IMAGE_BYTES / 1024 / 1024} MB. Envie uma foto menor.`;
  return null;
}

/** Retângulo relativo (0–1) dentro da imagem da carta. */
export interface RelativeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Regiões aproximadas em uma carta Pokémon padrão (63×88 mm), com a carta ocupando a foto:
 * - nome: faixa superior; - número: faixa inferior (o número pode ficar à esquerda ou à direita conforme a era).
 */
export const NAME_REGION: RelativeRect = { x: 0.04, y: 0.02, w: 0.78, h: 0.1 };
/**
 * Faixa do nome mais alta, para quando a carta não ficou exatamente na moldura (sobra de fundo em cima,
 * carta um pouco menor). Lida junto com a faixa justa: nos testes com cartas reais, as duas juntas acertam
 * mais do que qualquer uma sozinha.
 */
export const NAME_REGION_TALL: RelativeRect = { x: 0.02, y: 0, w: 0.8, h: 0.16 };
export const NUMBER_REGION: RelativeRect = { x: 0, y: 0.86, w: 1, h: 0.14 };

export const MAX_PROCESSING_SIDE = 1600;

export async function loadBitmap(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Não foi possível ler a imagem. Tente outra foto.');
  }
}

function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Seu navegador não permite processar imagens (canvas indisponível).');
  return { canvas, ctx };
}

/** Converte para tons de cinza e estica o contraste — melhora bastante a leitura do OCR. */
export function enhanceForOcr(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  let min = 255;
  let max = 0;
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
    gray[p] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const v = ((gray[p]! - min) * 255) / range;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
}

/** Redimensiona a imagem inteira para no máximo `MAX_PROCESSING_SIDE` px no maior lado. */
export function resizeForProcessing(source: CanvasImageSource & { width: number; height: number }, maxSide = MAX_PROCESSING_SIDE) {
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const { canvas, ctx } = makeCanvas(source.width * scale, source.height * scale);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Recorta uma região relativa e amplia (texto pequeno é lido melhor quando ampliado). */
export function cropRegion(source: HTMLCanvasElement, rect: RelativeRect, upscale = 2) {
  const sx = rect.x * source.width;
  const sy = rect.y * source.height;
  const sw = rect.w * source.width;
  const sh = rect.h * source.height;
  const { canvas, ctx } = makeCanvas(sw * upscale, sh * upscale);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  enhanceForOcr(ctx, canvas.width, canvas.height);
  return canvas;
}

export function enhancedCopy(source: HTMLCanvasElement) {
  const { canvas, ctx } = makeCanvas(source.width, source.height);
  ctx.drawImage(source, 0, 0);
  enhanceForOcr(ctx, canvas.width, canvas.height);
  return canvas;
}
