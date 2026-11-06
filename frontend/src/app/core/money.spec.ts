import { centsToInput, formatCents, parseMoneyToCents } from './money';

describe('money', () => {
  it('converte texto em centavos sem erro de ponto flutuante', () => {
    expect(parseMoneyToCents('12,50')).toBe(1250);
    expect(parseMoneyToCents('1.234,56')).toBe(123456);
    expect(parseMoneyToCents('0,1')).toBe(10);
    expect(parseMoneyToCents('19.99')).toBe(1999);
    expect(parseMoneyToCents('')).toBeNull();
    expect(parseMoneyToCents('abc')).toBeNaN();
    expect(parseMoneyToCents('1,234')).toBeNaN();
  });

  it('formata em BRL', () => {
    expect(formatCents(4590).replace(/\s/g, ' ')).toBe('R$ 45,90');
    expect(formatCents(null)).toBe('—');
    expect(centsToInput(1250)).toBe('12,50');
  });
});
