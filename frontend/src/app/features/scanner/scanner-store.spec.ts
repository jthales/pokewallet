import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { IdentificationResult } from '../../core/models';
import { OcrService } from './ocr.service';
import { ScannerStore } from './scanner-store';

const result: IdentificationResult = {
  hints: { nameCandidates: ['Furret'], localNumber: '136', printedTotal: 189, printedTotalRaw: '189', detectedLanguage: 'en' },
  candidates: [
    {
      externalId: 'swsh3-136', provider: 'tcgdex', name: 'Furret', localNumber: '136', setId: 'swsh3', setName: 'Darkness Ablaze',
      rarity: 'Uncommon', image: null, score: 1.2, confidence: 'high', reasons: ['nome', 'número'],
    },
  ],
  total: 1,
  hasMore: false,
  message: null,
};

function setup(ocr: Partial<OcrService>, api: Partial<ApiService>) {
  TestBed.configureTestingModule({
    providers: [ScannerStore, { provide: OcrService, useValue: { progress: () => null, release: async () => undefined, ...ocr } }, { provide: ApiService, useValue: api }],
  });
  return TestBed.inject(ScannerStore);
}

const photo = () => new File([new Uint8Array([1, 2, 3])], 'carta.jpg', { type: 'image/jpeg' });

describe('ScannerStore', () => {
  beforeAll(() => {
    URL.createObjectURL ??= () => 'blob:test';
    URL.revokeObjectURL ??= () => undefined;
  });

  it('rejeita arquivo inválido sem sair da etapa de captura', () => {
    const store = setup({}, {});
    expect(store.setImage(new File(['x'], 'a.gif', { type: 'image/gif' }))).toBe(false);
    expect(store.step()).toBe('capture');
    expect(store.error()).toMatch(/Formato/);
  });

  it('identifica a carta e mostra os candidatos', async () => {
    const identify = vi.fn(() => of(result));
    const store = setup({ recognize: async () => ({ fullText: 'Furret 136/189', nameText: 'Furret', numberText: '136/189' }) }, { identify });
    store.setImage(photo());
    await store.identify();
    expect(identify).toHaveBeenCalledWith(expect.objectContaining({ nameText: 'Furret', numberText: '136/189', limit: 5, offset: 0 }));
    expect(store.step()).toBe('results');
    expect(store.candidates()[0]?.externalId).toBe('swsh3-136');
  });

  it('falha de OCR: volta para a prévia com mensagem e sugere a busca manual', async () => {
    const identify = vi.fn();
    const store = setup({ recognize: async () => Promise.reject(new Error('Não foi possível iniciar o OCR neste navegador.')) }, { identify });
    store.setImage(photo());
    await store.identify();
    expect(store.step()).toBe('preview');
    expect(store.error()).toMatch(/OCR/);
    expect(store.error()).toMatch(/busca manual/);
    expect(identify).not.toHaveBeenCalled();
  });

  it('falha da API externa: mostra a mensagem do servidor', async () => {
    const error = new HttpErrorResponse({ status: 503, error: { error: { code: 'CATALOG_UNAVAILABLE', message: 'O catálogo de cartas (TCGdex) está indisponível no momento.' } } });
    const store = setup({ recognize: async () => ({ fullText: 'Furret', nameText: '', numberText: '' }) }, { identify: () => throwError(() => error) });
    store.setImage(photo());
    await store.identify();
    expect(store.step()).toBe('preview');
    expect(store.error()).toMatch(/indisponível/);
  });

  it('carrega mais resultados acumulando candidatos', async () => {
    const more = { ...result, candidates: [{ ...result.candidates[0]!, externalId: 'hgss1-21' }] };
    const identify = vi.fn().mockReturnValueOnce(of({ ...result, hasMore: true })).mockReturnValueOnce(of(more));
    const store = setup({ recognize: async () => ({ fullText: 'Furret', nameText: '', numberText: '' }) }, { identify });
    store.setImage(photo());
    await store.identify();
    await store.loadMore();
    expect(identify).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 1 }));
    expect(store.candidates().map((c) => c.externalId)).toEqual(['swsh3-136', 'hgss1-21']);
  });
});
