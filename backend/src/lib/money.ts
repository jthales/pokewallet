/** Converte um valor decimal informado (ex.: 12.5 ou "12,50") em centavos inteiros. */
export function toCents(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const normalized = typeof value === 'string' ? Number(value.replace(/\./g, '').replace(',', '.')) : value;
  if (!Number.isFinite(normalized)) throw new Error('Valor monetário inválido');
  return Math.round(normalized * 100);
}
