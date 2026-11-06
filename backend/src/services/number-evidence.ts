/**
 * Confere se a numeração de uma carta candidata ("136/189") aparece no texto lido do rodapé.
 *
 * Em vez de exigir que o OCR leia o número perfeitamente e depois procurar por ele, partimos dos candidatos
 * (que o nome já trouxe) e medimos o quanto o número de cada um "cabe" no texto, tolerando os erros típicos:
 * dígito trocado ("126/189"), símbolo de raridade colado ("5/1136"), letra da regulação lida como zero
 * ("0044/185") ou barra perdida. Nos testes com cartas reais isso escolhe a impressão certa bem mais vezes
 * do que ler o número primeiro.
 */

/** Deixa só dígitos e barras, corrigindo as trocas mais comuns de letra por dígito. */
export function digitsStream(text: string): string {
  return text
    .replace(/[⁄∕\\]/g, '/')
    .replace(/[Oo]/g, '0')
    .replace(/[Il|!]/g, '1')
    .replace(/[^0-9/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Menor distância de edição entre `pattern` e qualquer trecho de `text` (algoritmo de Sellers). */
export function approximateSubstringDistance(pattern: string, text: string): number {
  if (!pattern) return 0;
  if (!text) return pattern.length;
  let prev = new Array<number>(text.length + 1).fill(0);
  for (let i = 1; i <= pattern.length; i++) {
    const curr = [i];
    for (let j = 1; j <= text.length; j++) {
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + (pattern[i - 1] === text[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return Math.min(...prev);
}

/** Formas em que a numeração aparece impressa: "25/165" e "025/165"; "TG13/TG30" vira "13/30". */
export function numberPatterns(localNumber: string, officialCount: number | null): string[] {
  const local = localNumber.replace(/\D/g, '');
  if (!local) return [];
  if (officialCount === null) return local.length >= 3 ? [local] : [];
  const total = String(officialCount);
  const padded = `${local.padStart(3, '0')}/${total.padStart(3, '0')}`;
  const plain = `${String(Number(local))}/${total}`;
  return plain === padded ? [plain] : [plain, padded];
}

/**
 * Evidência de 0 a 1 de que a numeração da carta está no texto:
 * 1 = aparece exatamente; ~0,8 = um caractere errado; ~0,5 = dois; 0 = não aparece.
 */
export function numberEvidence(localNumber: string, officialCount: number | null, stream: string): number {
  const patterns = numberPatterns(localNumber, officialCount);
  if (!patterns.length || !stream) return 0;
  let best = 0;
  for (const pattern of patterns) {
    const dist = approximateSubstringDistance(pattern, stream);
    // Padrões curtos ("4/102" tem 5 caracteres) toleram menos erros.
    const allowed = pattern.length >= 6 ? 2 : 1;
    if (dist > allowed) continue;
    const value = dist === 0 ? 1 : dist === 1 ? 0.8 : 0.5;
    best = Math.max(best, value);
  }
  return best;
}
