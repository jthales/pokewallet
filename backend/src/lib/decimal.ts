import { Prisma } from '@prisma/client';

/**
 * Aritmética monetária segura: usamos o Decimal (decimal.js) que já vem com o Prisma,
 * nunca `number` de ponto flutuante, para câmbio, conversões e percentuais.
 */
export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

const ROUND_HALF_UP = 4; // Decimal.ROUND_HALF_UP

export function dec(value: Prisma.Decimal.Value): Decimal {
  return new Decimal(value);
}

/** Converte um valor decimal em reais (ex.: 12.345) para centavos inteiros, arredondando meio para cima. */
export function decimalToCents(value: Decimal): number {
  return value.mul(100).toDecimalPlaces(0, ROUND_HALF_UP).toNumber();
}

export function roundMoney(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, ROUND_HALF_UP);
}

/** Multiplica centavos por uma taxa e devolve centavos inteiros. */
export function convertCents(cents: number, rate: Prisma.Decimal.Value): number {
  return dec(cents).mul(rate).toDecimalPlaces(0, ROUND_HALF_UP).toNumber();
}

/** Percentual (2 casas) de `gain` sobre `base`; null quando a base é zero ou negativa. */
export function percent(gainCents: number, baseCents: number): number | null {
  if (!(baseCents > 0)) return null;
  return dec(gainCents).mul(100).div(baseCents).toDecimalPlaces(2, ROUND_HALF_UP).toNumber();
}

/** Valor de preço aceito como cotação real: número finito e estritamente positivo. */
export function isValidPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export const APP_TIME_ZONE = 'America/Sao_Paulo';

/** Dia civil (YYYY-MM-DD) de uma data no fuso do app. */
export function dayKey(date: Date, timeZone = APP_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Converte YYYY-MM-DD num Date à meia-noite UTC (formato usado nas colunas `@db.Date`). */
export function dayToDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function dateToDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
