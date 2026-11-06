const formatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Formata centavos inteiros como moeda BRL. */
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return formatter.format(cents / 100);
}

/**
 * Converte o texto digitado ("12,50", "1.234,56", "12.5") em centavos inteiros, sem ponto flutuante acumulado.
 * Retorna null para vazio e NaN para entrada inválida.
 */
export function parseMoneyToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  let text = String(input).trim().replace(/\s|R\$/g, '');
  if (!text) return null;
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return Number.NaN;
  const [int, frac = ''] = text.split('.');
  return Number(int) * 100 + Number(frac.padEnd(2, '0'));
}

export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}
