import type { CatalogCardSummary } from '../integrations/catalog-provider.js';
import { normalizeText } from '../lib/text.js';
import type { WeightedLine } from './ocr-parser.js';

/** Palavras do layout da carta que o OCR lê perto do nome mas que não fazem parte dele. */
const LAYOUT_WORDS = new Set([
  'basic', 'basico', 'stage', 'estagio', 'stagel', 'stage1', 'stage2', 'hp', 'ps', 'pokemon', 'trainer', 'treinador', 'supporter',
  'apoiador', 'item', 'tool', 'stadium', 'estadio', 'ability', 'habilidade', 'weakness', 'fraqueza', 'resistance', 'resistencia',
  'retreat', 'recuo', 'evolves', 'from', 'evolui', 'de', 'put', 'this', 'card', 'on', 'the', 'your', 'you', 'may', 'of', 'and', 'a',
  'to', 'if', 'it', 'is', 'for', 'in', 'do', 'da', 'o', 'e', 'em', 'no', 'na', 'sua', 'seu', 'esta', 'carta',
]);

/** Um nome de carta encontrado no texto, com a força da evidência (0–1, já ponderada pela região). */
export interface NameMatch {
  /** Nome normalizado (chave do índice). */
  key: string;
  /** Nome como aparece no catálogo. */
  display: string;
  score: number;
}

export interface NameIndex {
  /** Nome normalizado → cartas com esse nome (em qualquer idioma carregado). */
  byName: Map<string, CatalogCardSummary[]>;
  /** Nome normalizado → nome original para exibição. */
  display: Map<string, string>;
  /** Nomes agrupados pelo tamanho, para comparar só com tamanhos próximos. */
  byLength: Map<number, string[]>;
  bySet: Map<string, CatalogCardSummary[]>;
}

const compactOf = (s: string) => s.replace(/[^a-z0-9]/g, '');

export function buildNameIndex(lists: CatalogCardSummary[][]): NameIndex {
  const byName = new Map<string, CatalogCardSummary[]>();
  const display = new Map<string, string>();
  const bySet = new Map<string, CatalogCardSummary[]>();
  const seenInSet = new Set<string>();
  for (const list of lists) {
    for (const card of list) {
      const key = normalizeText(card.name);
      if (!key) continue;
      const group = byName.get(key) ?? [];
      if (!group.some((c) => c.externalId === card.externalId)) group.push(card);
      byName.set(key, group);
      if (!display.has(key)) display.set(key, card.name);
      if (card.setId && !seenInSet.has(card.externalId)) {
        seenInSet.add(card.externalId);
        const inSet = bySet.get(card.setId) ?? [];
        inSet.push(card);
        bySet.set(card.setId, inSet);
      }
    }
  }
  const byLength = new Map<number, string[]>();
  for (const key of byName.keys()) {
    const bucket = byLength.get(key.length) ?? [];
    bucket.push(key);
    byLength.set(key.length, bucket);
  }
  return { byName, display, byLength, bySet };
}

/** Levenshtein com limite: devolve `max + 1` assim que a distância passa de `max` (bem mais rápido em listas grandes). */
function boundedLevenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = curr;
  }
  return prev[b.length]!;
}

/** Trechos de 1 a 4 palavras de cada linha, sem palavras de layout nas pontas ("STAGE1 Furret" → "Furret"). */
function phrasesOf(line: string): string[] {
  const words = normalizeText(line).split(' ').filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= 4 && i + n <= words.length; n++) {
      const slice = words.slice(i, i + n);
      if (LAYOUT_WORDS.has(slice[0]!) || (n > 1 && LAYOUT_WORDS.has(slice[n - 1]!))) continue;
      const phrase = slice.join(' ');
      if (compactOf(phrase).length >= 3) out.add(phrase);
    }
  }
  return [...out];
}

/**
 * Procura, no texto do OCR, nomes que existem no catálogo, tolerando erros de leitura
 * ("rlabDene" → "Flabébé", "BrutelBonnet" → "Brute Bonnet", "Dragapult&X" → "Dragapult ex").
 * A pontuação combina a semelhança do trecho com o nome e o peso da linha (região do nome > corpo da carta).
 */
export function matchCardNames(lines: WeightedLine[], index: NameIndex, max = 6): NameMatch[] {
  const best = new Map<string, number>();
  for (const line of lines) {
    for (const phrase of phrasesOf(line.text)) {
      // Nomes curtos ("Mew", "Muk") só valem quando lidos exatamente; nos longos aceitamos ~20% de erro.
      // A distância conta os espaços: "energy" não vira "R Energy", mas "brutelbonnet" ainda vira "brute bonnet".
      const size = compactOf(phrase).length;
      const maxDist = size <= 4 ? 0 : size <= 7 ? 1 : Math.floor(size * 0.2);
      for (let len = phrase.length - maxDist; len <= phrase.length + maxDist; len++) {
        for (const key of index.byLength.get(len) ?? []) {
          const dist = boundedLevenshtein(phrase, key, maxDist);
          if (dist > maxDist) continue;
          const score = (1 - dist / Math.max(phrase.length, key.length)) * line.weight;
          if (score > (best.get(key) ?? 0)) best.set(key, score);
        }
      }
    }
  }
  const ranked = [...best.entries()]
    .map(([key, score]) => ({ key, score, display: index.display.get(key) ?? key }))
    .sort((a, b) => b.score - a.score || b.key.length - a.key.length);
  return ranked.slice(0, max);
}
