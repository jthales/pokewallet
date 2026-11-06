import type { CatalogImage } from '../catalog-provider.js';

/**
 * Regras de montagem de URLs de imagem da TCGdex (https://tcgdex.dev/assets):
 * - Cartas: a API devolve uma URL-base; acrescentamos `/{qualidade}.{extensão}`.
 * - Logos e símbolos de expansão: acrescentamos `.{extensão}` diretamente, sem qualidade.
 * Só montamos a URL quando a base tem o formato esperado; caso contrário, devolvemos null.
 */

const ASSET_HOST = 'assets.tcgdex.net';
const KNOWN_EXTENSION = /\.(webp|png|jpg|jpeg)$/i;

function isValidBase(base: string | undefined | null): base is string {
  if (!base) return false;
  try {
    const url = new URL(base);
    return url.protocol === 'https:' && url.hostname === ASSET_HOST && !KNOWN_EXTENSION.test(url.pathname) && url.pathname.split('/').filter(Boolean).length >= 3;
  } catch {
    return false;
  }
}

export function buildCardImage(base: string | undefined | null): CatalogImage | null {
  if (!isValidBase(base)) return null;
  const clean = base.replace(/\/+$/, '');
  return { small: `${clean}/low.webp`, large: `${clean}/high.webp` };
}

export function buildSetAssetUrl(base: string | undefined | null): string | null {
  if (!isValidBase(base)) return null;
  return `${base.replace(/\/+$/, '')}.webp`;
}

/**
 * Extrai a série e o id da expansão de uma URL-base de carta:
 * https://assets.tcgdex.net/{lang}/{serie}/{set}/{localId}
 */
export function parseCardImagePath(base: string | undefined | null): { serieId: string; setId: string } | null {
  if (!isValidBase(base)) return null;
  const parts = new URL(base).pathname.split('/').filter(Boolean);
  if (parts.length < 4) return null;
  return { serieId: parts[1]!, setId: parts[2]! };
}
