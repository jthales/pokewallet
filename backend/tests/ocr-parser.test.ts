import { describe, expect, it } from 'vitest';
import { extractNameCandidates, extractNameLines, parseCardNumber, parseNumberCandidates, parseOcrText } from '../src/services/ocr-parser.js';
import { normalizeLocalNumber } from '../src/lib/text.js';

describe('parseCardNumber', () => {
  it('interpreta 136/189 como número local 136 e total impresso 189', () => {
    expect(parseCardNumber('DAA EN 136/189')).toEqual({ localNumber: '136', printedTotal: 189, printedTotalRaw: '189' });
  });

  it('preserva zeros à esquerda e tolera espaços', () => {
    expect(parseCardNumber('025 / 165')).toMatchObject({ localNumber: '025', printedTotal: 165 });
  });

  it('aceita números locais alfanuméricos', () => {
    expect(parseCardNumber('TG01/TG30')).toMatchObject({ localNumber: 'TG01', printedTotal: null, printedTotalRaw: 'TG30' });
  });

  it('corrige confusões comuns do OCR (l, O)', () => {
    expect(parseCardNumber('l36/l89')).toMatchObject({ localNumber: '136', printedTotal: 189 });
    expect(parseCardNumber('O25/165')).toMatchObject({ localNumber: '025', printedTotal: 165 });
  });

  it('reconhece promos sem total', () => {
    expect(parseCardNumber('SWSH050')).toMatchObject({ localNumber: 'SWSH050', printedTotal: null });
  });

  it('não inventa número quando não há padrão', () => {
    expect(parseCardNumber('texto sem numeração')).toEqual({ localNumber: null, printedTotal: null, printedTotalRaw: null });
  });
});

describe('parseNumberCandidates', () => {
  it('recupera a numeração quando o OCR perde a barra (só como palpite)', () => {
    expect(parseNumberCandidates('W O 136202 6')).toContainEqual({ localNumber: '136', printedTotal: 202, printedTotalRaw: '202', quality: 'guess' });
  });

  it('corta o lixo colado no total ("130/1674" → 130/167)', () => {
    expect(parseNumberCandidates('Knocked Out, 130/1674 e')).toContainEqual({ localNumber: '130', printedTotal: 167, printedTotalRaw: '167', quality: 'repaired' });
  });

  it('não trata dano de ataque de 3 dígitos como numeração', () => {
    expect(parseNumberCandidates('G-Max Volt Tackle 220')).toEqual([]);
  });
});

describe('extractNameLines', () => {
  it('dá mais peso à região do nome e mantém linhas com © do símbolo de energia', () => {
    const lines = extractNameLines({ nameText: 'Furret..as © we', fullText: 'Evolves from Sentret\nKeen Eye\n©2008 Pokémon / Nintendo' });
    expect(lines[0]).toEqual({ text: 'Furret..as we', weight: 1 });
    expect(lines.map((l) => l.text)).not.toContain('Evolves from Sentret');
    expect(lines.some((l) => /Nintendo/.test(l.text))).toBe(false);
  });
});

describe('extractNameCandidates', () => {
  it('remove HP/PS, estágio e linhas de evolução', () => {
    expect(extractNameCandidates('BASIC\nPikachu HP 60\nEvolves from Pichu')).toEqual(['Pikachu']);
    expect(extractNameCandidates('ESTÁGIO 1\nRaichu PS 120\nEvolui de Pikachu')).toEqual(['Raichu']);
  });

  it('mantém sufixos de mecânica no nome', () => {
    expect(extractNameCandidates('Charizard ex 330 HP')[0]).toBe('Charizard ex');
  });

  it('ignora linhas de numeração e raridade', () => {
    expect(extractNameCandidates('Furret\nDAA EN 136/189')).toEqual(['Furret']);
  });
});

describe('parseOcrText', () => {
  it('combina regiões de nome e número e detecta o idioma', () => {
    const hints = parseOcrText({ nameText: 'Básico Pikachu PS 60', numberText: '025/165', fullText: 'Fraqueza Resistência Recuo' });
    expect(hints).toMatchObject({ localNumber: '025', printedTotal: 165, detectedLanguage: 'pt' });
    expect(hints.nameCandidates[0]).toBe('Pikachu');
  });

  it('retorna pistas vazias para texto vazio (falha de OCR)', () => {
    expect(parseOcrText({ fullText: '' })).toEqual({ nameCandidates: [], localNumber: null, printedTotal: null, printedTotalRaw: null, detectedLanguage: null });
  });
});

describe('normalizeLocalNumber', () => {
  it('compara números com e sem zeros à esquerda', () => {
    expect(normalizeLocalNumber('025')).toBe(normalizeLocalNumber('25'));
    expect(normalizeLocalNumber('TG01')).toBe('TG1');
    expect(normalizeLocalNumber('136')).not.toBe(normalizeLocalNumber('1136'));
  });
});
