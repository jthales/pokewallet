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

/** Uma leitura possível da numeração da carta. */
export interface NumberCandidate {
  localNumber: string;
  printedTotal: number | null;
  printedTotalRaw: string | null;
  /**
   * Quão confiável é a leitura: 'exact' (padrão completo com barra), 'repaired' (corrigida, ex.: dígito extra
   * colado no total) ou 'guess' (dígitos sem barra, só vale se a expansão confirmar).
   */
  quality: 'exact' | 'repaired' | 'guess';
}

/**
 * Todas as leituras plausíveis da numeração, da mais para a menos confiável. O OCR costuma:
 * - perder a barra ("136202" em vez de "136/202");
 * - colar o símbolo de raridade ou o ® no total ("130/1674" em vez de "130/167");
 * - trocar dígitos por letras (O/0, l/1, S/5, B/8).
 * As leituras 'repaired' e 'guess' precisam ser confirmadas pelo catálogo (expansão com aquele total).
 */
export function parseNumberCandidates(text: string): NumberCandidate[] {
  const out: NumberCandidate[] = [];
  if (!text) return out;
  const compact = text.replace(/[\u2044\u2215\\]/g, '/');
  const push = (c: NumberCandidate) => {
    if (!out.some((o) => o.localNumber === c.localNumber && o.printedTotal === c.printedTotal && o.printedTotalRaw === c.printedTotalRaw)) out.push(c);
  };

  const numeric = /(?<![A-Za-z0-9])([0-9OoIl|]{1,4})\s*\/\s*([0-9OoIl|]{1,5})/g;
  for (const match of compact.matchAll(numeric)) {
    if (!/\d/.test(match[1]!) || !/\d/.test(match[2]!)) continue;
    const local = fixDigits(match[1]!);
    const totalRaw = fixDigits(match[2]!);
    if (!/^\d+$/.test(local) || !/^\d+$/.test(totalRaw)) continue;
    const next = compact[(match.index ?? 0) + match[0].length];
    const clean = !next || !/[A-Za-z0-9]/.test(next);
    const total = Number(totalRaw);
    if (clean && totalRaw.length <= 3 && total >= 1 && total <= 500) push({ localNumber: local, printedTotal: total, printedTotalRaw: totalRaw, quality: 'exact' });
    // Total com lixo colado no fim: tenta os 3 e os 2 primeiros dígitos.
    for (const len of [3, 2]) {
      if (totalRaw.length <= len && clean) continue;
      const t = totalRaw.slice(0, len);
      if (t.length === len && Number(t) >= 10) push({ localNumber: local, printedTotal: Number(t), printedTotalRaw: t, quality: 'repaired' });
    }
  }

  const prefixed = /(?<![A-Za-z0-9])([A-Z]{1,4}[0-9OoIl]{1,4}[a-z]?)\s*\/\s*([A-Z]{0,4}[0-9OoIl]{1,4})(?![A-Za-z0-9])/g;
  for (const match of compact.matchAll(prefixed)) {
    const split = (raw: string) => {
      const prefix = raw.match(/^[A-Z]*/)![0];
      return prefix + fixDigits(raw.slice(prefix.length));
    };
    const local = split(match[1]!);
    const total = split(match[2]!);
    if (!/\d/.test(local) || !/\d/.test(total)) continue;
    push({ localNumber: local, printedTotal: /^\d+$/.test(total) ? Number(total) : null, printedTotalRaw: total, quality: 'exact' });
  }

  const promo = compact.match(/\b(SWSH|SM|XY|BW|SVP|SV|DP|HGSS)\s?(\d{1,3})\b/);
  if (promo) push({ localNumber: `${promo[1]}${promo[2]}`, printedTotal: null, printedTotalRaw: null, quality: 'exact' });

  // Barra perdida: "136202" → 136/202, "025165" → 025/165, "4102" → 4/102. Exige 4+ dígitos ("220" é dano, não número).
  for (const match of compact.matchAll(/(?<![A-Za-z0-9/])(\d{4,6})(?![0-9/])/g)) {
    const digits = match[1]!;
    for (let i = 1; i < digits.length; i++) {
      const local = digits.slice(0, i);
      const totalRaw = digits.slice(i);
      if (totalRaw.length < 2 || totalRaw.length > 3 || local.length > 3) continue;
      const total = Number(totalRaw);
      if (total < 10 || Number(local) < 1 || Number(local) > total + 150) continue;
      push({ localNumber: local, printedTotal: total, printedTotalRaw: totalRaw, quality: 'guess' });
    }
  }
  return out;
}

/**
 * Leitura principal (mais confiável) da numeração: "136/189", "025/165", "TG01/TG30", promos como "SWSH050".
 * Leituras reparadas ou adivinhadas ficam de fora; veja `parseNumberCandidates`.
 */
export function parseCardNumber(text: string): Pick<CardHints, 'localNumber' | 'printedTotal' | 'printedTotalRaw'> {
  const best = parseNumberCandidates(text).find((c) => c.quality === 'exact');
  if (!best) return { localNumber: null, printedTotal: null, printedTotalRaw: null };
  return { localNumber: best.localNumber, printedTotal: best.printedTotal, printedTotalRaw: best.printedTotalRaw };
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

/** Linha de texto lida, com o peso de onde ela veio (a região do nome vale mais do que o corpo da carta). */
export interface WeightedLine {
  text: string;
  weight: number;
}

// "©" sozinho não basta: o OCR costuma ler o símbolo de energia ao lado do nome como "©".
const SKIP_LINE = /evolves\s*from|evolui\s*de|(©|\(c\))\s*\d{4}|illus\.|ilus\.|nintendo|creatures|game\s*freak/i;

/**
 * Linhas onde o nome da carta pode estar, já limpas de HP/PS e de linhas que certamente não são o nome
 * ("Evolves from X", copyright, numeração). Peso 1 para a região do nome, 0,85 para o começo do texto
 * da carta inteira (onde fica o nome) e 0,6 para o resto (nomes de ataques, regras).
 */
export function extractNameLines(input: OcrTextInput, maxBodyLines = 30): WeightedLine[] {
  const lines: WeightedLine[] = [];
  const add = (raw: string, weight: number) => {
    if (SKIP_LINE.test(raw) || /\d\s*\/\s*\d/.test(raw)) return;
    const text = raw
      .replace(/\b(HP|PS)\s*\d+\b/gi, ' ')
      .replace(/\d+\s*(HP|PS)\b/gi, ' ')
      .replace(/[^\p{L}' .\-’&]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.replace(/[^\p{L}]/gu, '').length >= 3) lines.push({ text, weight });
  };
  const split = (t: string | undefined) => (t ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of split(input.nameText)) add(line, 1);
  split(input.fullText)
    .slice(0, maxBodyLines)
    .forEach((line, i) => add(line, i < 3 ? 0.85 : 0.6));
  return lines;
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
