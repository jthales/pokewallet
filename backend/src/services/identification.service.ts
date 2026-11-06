import {
  CatalogUnavailableError,
  type CardCatalogProvider,
  type CatalogCardSummary,
  type CatalogLanguage,
} from '../integrations/catalog-provider.js';
import { normalizeLocalNumber, normalizeText } from '../lib/text.js';
import { buildNameIndex, matchCardNames, type NameIndex, type NameMatch } from './card-name-matcher.js';
import { digitsStream, numberEvidence } from './number-evidence.js';
import { extractNameLines, parseNumberCandidates, parseOcrText, type CardHints, type NumberCandidate, type OcrTextInput } from './ocr-parser.js';

export type Confidence = 'high' | 'medium' | 'low';

export interface IdentificationCandidate {
  externalId: string;
  provider: string;
  name: string;
  localNumber: string;
  setId: string | null;
  setName: string | null;
  rarity: string | null;
  image: CatalogCardSummary['image'];
  score: number;
  /** Indicador qualitativo; null quando não há base suficiente para afirmar algo. */
  confidence: Confidence | null;
  reasons: string[];
}

export interface IdentificationResult {
  hints: CardHints;
  candidates: IdentificationCandidate[];
  total: number;
  hasMore: boolean;
  /** Mensagem amigável quando nada pôde ser identificado. */
  message: string | null;
}

export interface IdentifyInput extends OcrTextInput {
  language?: CatalogLanguage;
  offset?: number;
  limit?: number;
}

/** Abaixo disso o trecho lido não é tratado como nome (ex.: palavra do corpo da carta parecida com um nome). */
const MIN_NAME_SCORE = 0.6;

/** Sufixos de mecânica impressos ao lado do nome (já normalizados). */
const MECHANIC_SUFFIXES = ['ex', 'v', 'vmax', 'vstar', 'gx', 'break', 'lv x', 'prime', 'legend', 'star', 'v union', 'tag team'];

const sameNumber = (a: string, b: string) => normalizeLocalNumber(a) === normalizeLocalNumber(b);

/**
 * Algoritmo de correspondência:
 * 1. Do texto do OCR extrai linhas ponderadas (região do nome vale mais) e todas as leituras plausíveis da numeração.
 * 2. Compara as linhas com o índice completo de nomes da TCGdex (inglês + português), tolerando erros de leitura.
 *    Isso substitui a busca por nome da API, que só encontra o nome escrito exatamente certo.
 * 3. Valida a numeração no catálogo: "136/189" só aponta uma expansão quando existe expansão com total 189.
 *    Leituras sem barra ("136202") só valem se a carta existir naquela expansão.
 * 4. Pontua cada carta: nome + número + expansão compatível; nome + expansão também é forte (o OCR erra dígitos).
 */
export class IdentificationService {
  private indexCache: { en: CatalogCardSummary[]; pt: CatalogCardSummary[]; index: NameIndex } | null = null;

  constructor(private readonly catalog: CardCatalogProvider) {}

  async identify(input: IdentifyInput): Promise<IdentificationResult> {
    const parsed = parseOcrText(input);
    const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);
    const offset = Math.max(input.offset ?? 0, 0);
    const lines = extractNameLines(input);
    const numberCandidates = parseNumberCandidates([input.numberText ?? '', input.fullText ?? ''].filter(Boolean).join('\n'));

    if (!lines.length && !numberCandidates.length) {
      return {
        hints: parsed,
        candidates: [],
        total: 0,
        hasMore: false,
        message: 'Não foi possível ler o nome nem o número da carta. Tente outra foto ou use a busca manual.',
      };
    }

    const [index, sets] = await Promise.all([this.loadIndex(), this.catalog.getSets()]);
    const setsByTotal = new Map<number, string[]>();
    for (const set of sets) {
      if (set.officialCount === null) continue;
      setsByTotal.set(set.officialCount, [...(setsByTotal.get(set.officialCount) ?? []), set.externalId]);
    }

    // Numeração: leituras confirmadas (a carta existe naquela expansão) e expansões compatíveis com o total lido.
    const confirmed: { candidate: NumberCandidate; card: CatalogCardSummary }[] = [];
    const compatibleSets = new Set<string>();
    for (const candidate of numberCandidates) {
      if (candidate.printedTotal === null) continue;
      const setIds = setsByTotal.get(candidate.printedTotal) ?? [];
      // Leitura sem barra só aponta expansão se a carta existir; senão é coincidência de dígitos.
      if (candidate.quality !== 'guess') setIds.forEach((id) => compatibleSets.add(id));
      for (const setId of setIds) {
        const card = index.bySet.get(setId)?.find((c) => sameNumber(c.localNumber, candidate.localNumber));
        if (card) {
          confirmed.push({ candidate, card });
          compatibleSets.add(setId);
        }
      }
    }
    const exactNumbers = numberCandidates.filter((c) => c.quality === 'exact');
    const primaryNumber = confirmed.find((c) => c.candidate.quality !== 'guess')?.candidate ?? exactNumbers[0] ?? confirmed[0]?.candidate ?? null;
    // Cartas cuja numeração foi lida e confirmada no catálogo (leitura sem barra vale menos).
    const confirmedEvidence = new Map<string, number>();
    for (const { candidate, card } of confirmed) {
      const value = candidate.quality === 'guess' ? 0.6 : 1;
      confirmedEvidence.set(card.externalId, Math.max(confirmedEvidence.get(card.externalId) ?? 0, value));
    }
    const officialBySet = new Map(sets.map((s) => [s.externalId, s.officialCount]));
    const streams = { bottom: digitsStream(input.numberText ?? ''), full: digitsStream(input.fullText ?? '') };

    const names = matchCardNames(lines, index).filter((m) => m.score >= MIN_NAME_SCORE);

    const pool = new Map<string, CatalogCardSummary>();
    for (const { card } of confirmed) pool.set(card.externalId, card);
    for (const match of names) {
      for (const card of index.byName.get(match.key) ?? []) pool.set(card.externalId, card);
      // Variações com sufixo de mecânica ("Pikachu" lido, carta "Pikachu VMAX"): o sufixo costuma sair ilegível.
      for (const suffix of MECHANIC_SUFFIXES) {
        for (const card of index.byName.get(`${match.key} ${suffix}`) ?? []) pool.set(card.externalId, card);
      }
    }
    // Promos ou números sem total, sem nome legível: todas as cartas com aquele número.
    if (!names.length && !confirmed.length) {
      const promos = exactNumbers.filter((c) => c.printedTotal === null);
      for (const list of index.bySet.values()) {
        for (const card of list) if (promos.some((n) => sameNumber(card.localNumber, n.localNumber))) pool.set(card.externalId, card);
      }
    }

    const hints: CardHints = {
      ...parsed,
      nameCandidates: names.length ? names.slice(0, 3).map((n) => n.display) : parsed.nameCandidates,
      localNumber: primaryNumber?.localNumber ?? null,
      printedTotal: primaryNumber?.printedTotal ?? null,
      printedTotalRaw: primaryNumber?.printedTotalRaw ?? null,
    };

    const ranked = [...pool.values()]
      .map((card) => this.score(card, names, this.numberScore(card, officialBySet, streams, confirmedEvidence), compatibleSets))
      .filter((c) => c.score > 0.25)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    capAmbiguousConfidence(ranked);

    const page = ranked.slice(offset, offset + limit);
    const enriched = await Promise.all(page.map((c) => this.enrich(c)));

    return {
      hints,
      candidates: enriched,
      total: ranked.length,
      hasMore: offset + limit < ranked.length,
      message: ranked.length ? null : 'Nenhuma carta correspondente foi encontrada. Use a busca manual para encontrá-la.',
    };
  }

  /** Índice de nomes em inglês + português (o português é opcional: se falhar, seguimos só com o inglês). */
  private async loadIndex(): Promise<NameIndex> {
    const [en, pt] = await Promise.all([
      this.catalog.getCardIndex('en'),
      this.catalog.getCardIndex('pt').catch((error: unknown) => {
        if (error instanceof CatalogUnavailableError) return [] as CatalogCardSummary[];
        throw error;
      }),
    ]);
    // O provedor guarda as listas em cache; só reconstruímos o índice quando elas mudam.
    if (this.indexCache?.en === en && this.indexCache.pt === pt) return this.indexCache.index;
    // Cartas em português usam os mesmos ids; a imagem em inglês é preferida porque existe para mais cartas.
    const enById = new Map(en.map((c) => [c.externalId, c]));
    const ptAliases = pt.map((c) => {
      const twin = enById.get(c.externalId);
      return { ...c, image: twin?.image ?? c.image, setId: c.setId ?? twin?.setId ?? null };
    });
    const index = buildNameIndex([en, ptAliases]);
    this.indexCache = { en, pt, index };
    return index;
  }

  /** Quanto o nome da carta corresponde aos nomes lidos (0–1). */
  private nameScore(card: CatalogCardSummary, names: NameMatch[]): number {
    const key = normalizeText(card.name);
    let best = 0;
    for (const match of names) {
      if (match.key === key) best = Math.max(best, match.score);
      // "Pikachu" lido e carta "Pikachu VMAX": o sufixo costuma sair ilegível.
      else if (MECHANIC_SUFFIXES.some((suffix) => key === `${match.key} ${suffix}`)) best = Math.max(best, match.score * 0.85);
    }
    return best;
  }

  /**
   * Evidência (0–1) de que a numeração desta carta está impressa na foto. Confere o número do candidato no texto
   * do rodapé com tolerância a erros, em vez de depender de o OCR ter lido o número inteiro certo.
   */
  private numberScore(
    card: CatalogCardSummary,
    officialBySet: Map<string, number | null>,
    streams: { bottom: string; full: string },
    confirmedEvidence: Map<string, number>,
  ): number {
    const total = card.setId ? (officialBySet.get(card.setId) ?? null) : null;
    const bottom = numberEvidence(card.localNumber, total, streams.bottom);
    // No texto da carta inteira há HP, dano e anos: lá só vale a numeração exata.
    const full = numberEvidence(card.localNumber, total, streams.full) === 1 ? 1 : 0;
    return Math.max(bottom, full, confirmedEvidence.get(card.externalId) ?? 0);
  }

  private score(card: CatalogCardSummary, names: NameMatch[], numberScore: number, compatibleSets: Set<string>): IdentificationCandidate {
    const reasons: string[] = [];
    const nameScore = this.nameScore(card, names);
    const setMatch = !!card.setId && compatibleSets.has(card.setId);
    // Total da expansão lido mas número da carta não: pista parcial (o OCR errou um dígito do número).
    const number = Math.max(numberScore, setMatch ? 0.35 : 0);

    if (nameScore >= 0.8) reasons.push('nome');
    if (number >= 0.8) reasons.push('número');
    else if (number >= 0.5) reasons.push('número parecido');
    if (setMatch) reasons.push('expansão compatível com o total impresso');

    // Nome e número pesam quase igual; sem nome legível, só o número decide.
    let score = names.length ? 0.55 * nameScore + 0.45 * number : 0.8 * number;
    if (!card.image) score -= 0.02;

    let confidence: Confidence | null = null;
    if (nameScore >= 0.8 && number >= 0.8) confidence = 'high';
    else if ((nameScore >= 0.8 && number >= 0.5) || (nameScore >= 0.6 && number >= 0.8) || (!names.length && number === 1 && setMatch)) confidence = 'medium';
    else if (nameScore >= 0.6 || number >= 0.5) confidence = 'low';

    return {
      externalId: card.externalId,
      provider: this.catalog.providerId,
      name: card.name,
      localNumber: card.localNumber,
      setId: card.setId,
      setName: null,
      rarity: null,
      image: card.image,
      score: Math.round(Math.max(score, 0) * 1000) / 1000,
      confidence,
      reasons,
    };
  }

  /** Completa raridade e nome da expansão com os detalhes da carta (cacheados). */
  private async enrich(candidate: IdentificationCandidate): Promise<IdentificationCandidate> {
    try {
      const card = await this.catalog.getCardById(candidate.externalId);
      if (!card) return candidate;
      return {
        ...candidate,
        rarity: card.rarity,
        setId: card.set.externalId,
        setName: card.set.name,
        image: candidate.image ?? card.image,
      };
    } catch {
      return candidate;
    }
  }
}

const LOWER: Record<Confidence, Confidence | null> = { high: 'medium', medium: 'low', low: 'low' };

/**
 * Se dois candidatos ficaram praticamente empatados, nenhum deles merece a confiança que teria sozinho:
 * rebaixa um nível os empatados (ex.: duas impressões do mesmo Pokémon sem número legível).
 */
export function capAmbiguousConfidence(ranked: IdentificationCandidate[], margin = 0.03): void {
  const first = ranked[0];
  const second = ranked[1];
  if (!first?.confidence || !second || first.score - second.score >= margin) return;
  for (const c of ranked) {
    if (first.score - c.score >= margin) break;
    if (c.confidence) c.confidence = LOWER[c.confidence];
  }
}
