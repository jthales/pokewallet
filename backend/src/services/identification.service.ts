import {
  CatalogUnavailableError,
  type CardCatalogProvider,
  type CatalogCardSummary,
  type CatalogLanguage,
} from '../integrations/catalog-provider.js';
import { normalizeLocalNumber, normalizeText, similarity } from '../lib/text.js';
import { parseOcrText, type CardHints, type OcrTextInput } from './ocr-parser.js';

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

const MAX_SETS_FROM_TOTAL = 8;

/**
 * Algoritmo de correspondência:
 * 1. Extrai nome(s), número local e total impresso do texto do OCR.
 * 2. Busca na TCGdex combinações (número + expansões com o mesmo total), (nome + número) e (nome).
 * 3. Pontua cada carta: nome (similaridade) + número local exato + expansão compatível com o total.
 *    A combinação nome + número + expansão vale mais do que o nome isolado.
 */
export class IdentificationService {
  constructor(private readonly catalog: CardCatalogProvider) {}

  async identify(input: IdentifyInput): Promise<IdentificationResult> {
    const hints = parseOcrText(input);
    const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);
    const offset = Math.max(input.offset ?? 0, 0);

    if (!hints.nameCandidates.length && !hints.localNumber) {
      return {
        hints,
        candidates: [],
        total: 0,
        hasMore: false,
        message: 'Não foi possível ler o nome nem o número da carta. Tente outra foto ou use a busca manual.',
      };
    }

    const languages: CatalogLanguage[] = ['en'];
    if (input.language === 'pt' || hints.detectedLanguage === 'pt') languages.push('pt');

    const pool = new Map<string, CatalogCardSummary>();
    let failures = 0;
    let attempts = 0;
    const collect = async (loader: () => Promise<CatalogCardSummary[]>) => {
      attempts++;
      try {
        for (const card of await loader()) if (!pool.has(card.externalId)) pool.set(card.externalId, card);
      } catch (error) {
        if (!(error instanceof CatalogUnavailableError)) throw error;
        failures++;
      }
    };

    // Expansões compatíveis com o total impresso (apenas uma pista para restringir).
    let setsFromTotal = new Set<string>();
    if (hints.printedTotal !== null) {
      try {
        const sets = await this.catalog.findSetsByOfficialCount(hints.printedTotal);
        setsFromTotal = new Set(sets.slice(0, MAX_SETS_FROM_TOTAL).map((s) => s.externalId));
      } catch (error) {
        if (!(error instanceof CatalogUnavailableError)) throw error;
        failures++;
        attempts++;
      }
    }

    const tasks: Promise<void>[] = [];
    const localNumber = hints.localNumber;
    if (localNumber) {
      for (const setId of setsFromTotal) tasks.push(collect(() => this.catalog.searchCardsByNumber(localNumber, { setId })));
    }
    for (const lang of languages) {
      for (const name of hints.nameCandidates) {
        if (localNumber) tasks.push(collect(() => this.catalog.searchCards({ name, localNumber, language: lang, pageSize: 50 })));
        tasks.push(collect(() => this.catalog.searchCards({ name, language: lang, pageSize: 60 })));
      }
    }
    if (localNumber && !hints.nameCandidates.length && !setsFromTotal.size) {
      tasks.push(collect(() => this.catalog.searchCardsByNumber(localNumber)));
    }
    await Promise.all(tasks);

    if (attempts > 0 && failures === attempts) {
      throw new CatalogUnavailableError('O catálogo de cartas está indisponível no momento. Tente novamente mais tarde.');
    }

    const ranked = [...pool.values()]
      .map((card) => this.score(card, hints, setsFromTotal))
      .filter((c) => c.score > 0.25)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

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

  private score(card: CatalogCardSummary, hints: CardHints, setsFromTotal: Set<string>): IdentificationCandidate {
    const reasons: string[] = [];
    const nameScore = hints.nameCandidates.reduce((best, candidate) => Math.max(best, nameSimilarity(candidate, card.name)), 0);
    const numberMatch = !!hints.localNumber && normalizeLocalNumber(card.localNumber) === normalizeLocalNumber(hints.localNumber);
    const setMatch = !!card.setId && setsFromTotal.has(card.setId);

    if (nameScore >= 0.8) reasons.push('nome');
    if (numberMatch) reasons.push('número');
    if (setMatch) reasons.push('expansão compatível com o total impresso');

    const hasName = hints.nameCandidates.length > 0;
    let score = 0;
    if (hasName) score += 0.5 * nameScore;
    if (numberMatch) score += 0.3;
    if (setMatch) score += 0.2;
    // Sem nome lido, número + expansão é a melhor evidência disponível.
    if (!hasName && numberMatch) score += 0.2;
    // Combinação completa ganha bônus para ficar acima de qualquer correspondência só por nome.
    if (nameScore >= 0.8 && numberMatch && setMatch) score += 0.2;
    // Número lido mas diferente: penaliza levemente sem descartar (o OCR pode ter errado).
    if (hints.localNumber && !numberMatch) score -= 0.05;
    if (!card.image) score -= 0.02;

    let confidence: Confidence | null = null;
    if (nameScore >= 0.8 && numberMatch && (setMatch || hints.printedTotal === null)) confidence = 'high';
    else if ((nameScore >= 0.8 && numberMatch) || (numberMatch && setMatch && nameScore >= 0.5)) confidence = 'medium';
    else if (nameScore >= 0.8 || (numberMatch && setMatch)) confidence = 'low';

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

/** Similaridade de nome que também considera nomes contidos um no outro ("Pikachu" em "Pikachu V"). */
export function nameSimilarity(ocrName: string, cardName: string): number {
  const a = normalizeText(ocrName);
  const b = normalizeText(cardName);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const direct = similarity(a, b);
  const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const containment = b.includes(a) || a.includes(b) ? 0.75 + 0.25 * ratio : 0;
  // Palavra a palavra, para tolerar ruído do OCR no começo ou no fim da linha.
  const wordsA = a.split(' ');
  const wordsB = b.split(' ');
  const wordScore = wordsB.reduce((sum, wb) => sum + Math.max(...wordsA.map((wa) => similarity(wa, wb))), 0) / wordsB.length;
  return Math.min(1, Math.max(direct, containment, wordScore * 0.95));
}
