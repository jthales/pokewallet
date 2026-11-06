import { describe, expect, it } from 'vitest';
import { CatalogUnavailableError } from '../src/integrations/catalog-provider.js';
import { IdentificationService } from '../src/services/identification.service.js';
import { FakeCatalog } from './fakes.js';

describe('IdentificationService', () => {
  it('identifica a carta por nome + número + expansão com confiança alta', async () => {
    const service = new IdentificationService(new FakeCatalog());
    const result = await service.identify({ fullText: 'BASIC\nFurret HP 110\nEvolves from Sentret\nDAA EN 136/189' });
    expect(result.candidates[0]).toMatchObject({ externalId: 'swsh3-136', name: 'Furret', setName: 'Darkness Ablaze', rarity: 'Uncommon', confidence: 'high' });
    // Nome isolado (Furret de outra expansão) fica abaixo da combinação completa.
    const other = result.candidates.find((c) => c.externalId === 'hgss1-21');
    expect(other!.score).toBeLessThan(result.candidates[0]!.score);
  });

  it('prioriza número + expansão quando o nome não foi lido', async () => {
    const service = new IdentificationService(new FakeCatalog());
    const result = await service.identify({ numberText: '136/189' });
    const ids = result.candidates.map((c) => c.externalId);
    expect(ids).toContain('swsh3-136');
    expect(ids).toContain('swsh10-136');
    // Carta com mesmo número mas de expansão com total diferente não entra como melhor resultado.
    expect(ids.indexOf('sm1-136') === -1 || ids.indexOf('sm1-136') > 1).toBe(true);
    // Sem nome, não há base para confiança alta.
    expect(result.candidates.every((c) => c.confidence !== 'high')).toBe(true);
  });

  it('identifica por nome e número com zeros à esquerda', async () => {
    const service = new IdentificationService(new FakeCatalog());
    const result = await service.identify({ nameText: 'Pikachu', numberText: '025/165' });
    expect(result.candidates[0]).toMatchObject({ externalId: 'sv03.5-025', confidence: 'high' });
  });

  it('limita a 5 candidatos e permite buscar mais', async () => {
    const service = new IdentificationService(new FakeCatalog());
    const first = await service.identify({ nameText: 'Pikachu', limit: 2 });
    expect(first.candidates).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const next = await service.identify({ nameText: 'Pikachu', limit: 2, offset: 2 });
    expect(next.candidates[0]!.externalId).not.toBe(first.candidates[0]!.externalId);
  });

  it('falha de OCR: sem texto útil não consulta a API e orienta a busca manual', async () => {
    const catalog = new FakeCatalog();
    const service = new IdentificationService(catalog);
    const result = await service.identify({ fullText: '   \n ~~ ', nameText: '', numberText: '' });
    expect(result.candidates).toEqual([]);
    expect(result.message).toMatch(/busca manual/);
    expect(catalog.calls).toBe(0);
  });

  it('falha da API externa: lança CatalogUnavailableError', async () => {
    const catalog = new FakeCatalog();
    catalog.down = true;
    const service = new IdentificationService(catalog);
    await expect(service.identify({ fullText: 'Furret 136/189' })).rejects.toBeInstanceOf(CatalogUnavailableError);
  });

  it('não cria confiança quando nada corresponde', async () => {
    const service = new IdentificationService(new FakeCatalog());
    const result = await service.identify({ fullText: 'Zzyzzx' });
    expect(result.candidates).toEqual([]);
    expect(result.message).toBeTruthy();
  });
});
