import { normalizeText } from '../lib/text.js';

/** Pistas extraídas do texto do OCR. Nada é inventado: campos ausentes ficam null/vazios. */
export interface CardHints {
  nameCandidates: string[];
  localNumber: string | null;
  printedTotal: number | null;
  /** Total impresso não numérico (ex.: TG30). */
  printedTotalRaw: string | null;
  detectedLanguage: 'pt' | 'en' | null;
}

export interface OcrTextInput {
  /** Texto da imagem inteira. */
  fullText?: string;
  /** Texto da região do nome (topo da carta), se recortada. */
  nameText?: string;
  /** Texto da região do número (rodapé da carta), se recortada. */
  numberText?: string;
}

const PT_MARKERS = ['basico', 'estagio', 'evolui de', 'fraqueza', 'resistencia', 'recuo', 'treinador', 'apoiador', 'item', 'energia', 'ps'];
const EN_MARKERS = ['basic', 'stage', 'evolves from', 'weakness', 'resistance', 'retreat', 'trainer', 'supporter', 'energy', 'hp'];

/** Palavras que aparecem perto do nome mas não fazem parte dele. */
const NOISE_WORDS = new Set([
  'basic', 'basico', 'stage', 'estagio', 'evolves', 'evolve', 'evolui', 'from', 'de', 'hp', 'ps', 'pokemon', 'trainer', 'treinador',
  'supporter', 'apoiador', 'item', 'tool', 'ferramenta', 'stadium', 'estadio', 'energy', 'energia', 'put', 'this', 'card', 'on', 'the',
  'coloque', 'esta', 'carta', 'sobre', 'ability', 'habilidade', 'common', 'uncommon', 'rare', 'comum', 'incomum', 'rara', 'illus',
  'illustrator', 'ilustrador', 'weakness', 'fraqueza', 'resistance', 'resistencia', 'retreat', 'recuo', 'nintendo', 'creatures', 'game', 'freak', 'a', 'o', 'e', 'em', 'do', 'da', 'of', 'and', 'with', 'no', 'na',
]);

/** Sufixos de mecânicas que fazem parte do nome da carta. */
const NAME_SUFFIXES = new Set(['v', 'vmax', 'vstar', 'gx', 'ex', 'break', 'lv', 'x', 'prime', 'star', 'δ']);

/** Corrige confusões comuns do OCR em trechos que deveriam ser numéricos. */
function fixDigits(token: string): string {
  return token.replace(/[Oo]/g, '0').replace(/[Il|!]/g, '1').replace(/[Ss](?=\d)/g, '5').replace(/[B](?=\d{2})/g, '8');
}

/**
 * Encontra padrões de numeração como "136/189", "025/165", "TG01/TG30", "SV049/SV122", "GG35/GG70".
 * Também tenta números sem total (promos como "SWSH123" ou "SM108").
 */
export function parseCardNumber(text: string): Pick<CardHints, 'localNumber' | 'printedTotal' | 'printedTotalRaw'> {
  const empty = { localNumber: null, printedTotal: null, printedTotalRaw: null };
  if (!text) return empty;
  const compact = text.replace(/[\u2044\u2215\\]/g, '/');

  // 1) Numeração puramente numérica (tolerando O/l/I/| no lugar de dígitos): "136/189", "025/165", "l36/l89".
  const numeric = /(?<![A-Za-z0-9])([0-9OoIl|]{1,4})\s*\/\s*([0-9OoIl|]{1,4})(?![A-Za-z0-9])/g;
  for (const match of compact.matchAll(numeric)) {
    const local = fixDigits(match[1]!);
    const total = fixDigits(match[2]!);
    if (!/^\d+$/.test(local) || !/^\d+$/.test(total)) continue;
    // Exige ao menos um dígito real em cada lado para não confundir palavras com números.
    if (!/\d/.test(match[1]!) || !/\d/.test(match[2]!)) continue;
    const printedTotal = Number(total);
    if (printedTotal < 1 || printedTotal > 500) continue;
    return { localNumber: local, printedTotal, printedTotalRaw: total };
  }

  // 2) Numeração com prefixo de letras maiúsculas: "TG01/TG30", "SV049/SV122", "GG35/GG70", "RC5/RC32".
  const prefixed = /(?<![A-Za-z0-9])([A-Z]{1,4}[0-9OoIl]{1,4}[a-z]?)\s*\/\s*([A-Z]{0,4}[0-9OoIl]{1,4})(?![A-Za-z0-9])/g;
  for (const match of compact.matchAll(prefixed)) {
    const split = (raw: string) => {
      const prefix = raw.match(/^[A-Z]*/)![0];
      return prefix + fixDigits(raw.slice(prefix.length));
    };
    const local = split(match[1]!);
    const total = split(match[2]!);
    if (!/\d/.test(local) || !/\d/.test(total)) continue;
    return { localNumber: local, printedTotal: /^\d+$/.test(total) ? Number(total) : null, printedTotalRaw: total };
  }

  // 3) Promos sem total: "SWSH050", "SM108", "SVP 044".
  const promo = compact.match(/\b(SWSH|SM|XY|BW|SVP|SV|DP|HGSS)\s?(\d{1,3})\b/);
  if (promo) return { ...empty, localNumber: `${promo[1]}${promo[2]}` };
  return empty;
}

function detectLanguage(text: string): 'pt' | 'en' | null {
  const n = ` ${normalizeText(text)} `;
  const count = (markers: string[]) => markers.filter((m) => n.includes(` ${m} `)).length;
  const pt = count(PT_MARKERS);
  const en = count(EN_MARKERS);
  if (pt === 0 && en === 0) return null;
  return pt > en ? 'pt' : 'en';
}

/** Extrai candidatos a nome a partir de linhas de texto. */
export function extractNameCandidates(text: string, max = 3): string[] {
  const candidates: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 8)) {
    // Remove HP/PS e números (ex.: "Pikachu HP 60", "PS120").
    const cleaned = line
      .replace(/\b(HP|PS)\s*\d+\b/gi, ' ')
      .replace(/\d+\s*(HP|PS)\b/gi, ' ')
      .replace(/[^\p{L}' .\-’]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const words = cleaned.split(' ').filter((w) => {
      const n = normalizeText(w);
      if (!n) return false;
      if (NAME_SUFFIXES.has(n)) return true;
      return n.length >= 3 && !NOISE_WORDS.has(n);
    });
    // Se a linha é "Evolves from X", o nome X não é o da carta; linhas de numeração ("136/189") e copyright também não.
    if (/evolves from|evolui de/i.test(line)) continue;
    if (/\d\s*\/\s*\d/.test(line) || /©|\(c\)|illus\.?/i.test(line)) continue;
    if (!words.length) continue;
    // Palavras muito curtas ou com proporção estranha de letras costumam ser ruído do OCR.
    const meaningful = words.filter((w) => w.length >= 3);
    if (!meaningful.length) continue;
    const candidate = words.join(' ').replace(/\s+/g, ' ').trim();
    if (candidate.length < 3 || candidate.length > 40) continue;
    if (!candidates.some((c) => normalizeText(c) === normalizeText(candidate))) candidates.push(candidate);
    if (candidates.length >= max) break;
  }
  return candidates;
}

/** Converte os textos do OCR em pistas estruturadas. */
export function parseOcrText(input: OcrTextInput): CardHints {
  const full = input.fullText ?? '';
  const numberSource = [input.numberText ?? '', full].filter(Boolean).join('\n');
  const number = parseCardNumber(numberSource);
  const nameSource = input.nameText?.trim() ? `${input.nameText}\n${full}` : full;
  const nameCandidates = extractNameCandidates(nameSource);
  return {
    nameCandidates,
    ...number,
    detectedLanguage: detectLanguage(`${full}\n${input.nameText ?? ''}`),
  };
}
