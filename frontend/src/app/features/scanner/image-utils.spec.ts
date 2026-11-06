import { MAX_IMAGE_BYTES, validateImageFile } from './image-utils';

describe('validateImageFile', () => {
  it('aceita JPG, PNG e WebP dentro do limite', () => {
    expect(validateImageFile({ type: 'image/jpeg', size: 1000 })).toBeNull();
    expect(validateImageFile({ type: 'image/png', size: 1000 })).toBeNull();
    expect(validateImageFile({ type: 'image/webp', size: 1000 })).toBeNull();
  });

  it('rejeita formatos não suportados', () => {
    expect(validateImageFile({ type: 'image/gif', size: 1000 })).toMatch(/Formato não suportado/);
    expect(validateImageFile({ type: 'application/pdf', size: 1000 })).toMatch(/Formato não suportado/);
  });

  it('rejeita arquivos vazios ou acima do tamanho máximo', () => {
    expect(validateImageFile({ type: 'image/jpeg', size: 0 })).toMatch(/vazio/);
    expect(validateImageFile({ type: 'image/jpeg', size: MAX_IMAGE_BYTES + 1 })).toMatch(/10 MB/);
  });
});
