/** Remove acentos, pontuação e caixa para comparar textos. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'`´]/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normaliza um número local para comparação: maiúsculas, sem espaços e sem zeros à esquerda na parte numérica. */
export function normalizeLocalNumber(value: string): string {
  const compact = value.toUpperCase().replace(/\s+/g, '');
  return compact.replace(/^([A-Z]*)0+(?=\d)/, '$1');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[b.length]!;
}

/** Similaridade entre 0 e 1 baseada na distância de Levenshtein sobre textos normalizados. */
export function similarity(a: string, b: string): number {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (!x || !y) return 0;
  const max = Math.max(x.length, y.length);
  return 1 - levenshtein(x, y) / max;
}
