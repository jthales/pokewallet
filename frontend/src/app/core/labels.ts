import { CatalogVariants, Condition, PhysicalLanguage, Variant } from './models';

export const CONDITION_OPTIONS: { value: Condition; label: string; short: string }[] = [
  { value: 'MINT', label: 'Mint', short: 'M' },
  { value: 'NEAR_MINT', label: 'Near Mint', short: 'NM' },
  { value: 'LIGHTLY_PLAYED', label: 'Lightly Played', short: 'LP' },
  { value: 'MODERATELY_PLAYED', label: 'Moderately Played', short: 'MP' },
  { value: 'HEAVILY_PLAYED', label: 'Heavily Played', short: 'HP' },
  { value: 'DAMAGED', label: 'Damaged', short: 'DMG' },
];

export const VARIANT_OPTIONS: { value: Variant; label: string }[] = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HOLOFOIL', label: 'Holofoil' },
  { value: 'REVERSE_HOLOFOIL', label: 'Reverse Holofoil' },
  { value: 'FIRST_EDITION', label: '1ª edição' },
  { value: 'OTHER', label: 'Outra' },
];

export const LANGUAGE_OPTIONS: { value: PhysicalLanguage; label: string }[] = [
  { value: 'pt', label: 'Português' },
  { value: 'en', label: 'Inglês' },
  { value: 'es', label: 'Espanhol' },
  { value: 'fr', label: 'Francês' },
  { value: 'de', label: 'Alemão' },
  { value: 'it', label: 'Italiano' },
  { value: 'ja', label: 'Japonês' },
  { value: 'ko', label: 'Coreano' },
  { value: 'zh', label: 'Chinês' },
  { value: 'other', label: 'Outro' },
];

export const conditionLabel = (v: string) => CONDITION_OPTIONS.find((o) => o.value === v)?.label ?? v;
export const conditionShort = (v: string) => CONDITION_OPTIONS.find((o) => o.value === v)?.short ?? v;
export const variantLabel = (v: string) => VARIANT_OPTIONS.find((o) => o.value === v)?.label ?? v;
export const languageLabel = (v: string) => LANGUAGE_OPTIONS.find((o) => o.value === v)?.label ?? v;

/**
 * Variantes oferecidas no formulário. Quando o catálogo informa as variantes existentes, mostramos só elas
 * (mais "Outra"); quando não informa, mostramos todas, sem presumir nada.
 */
export function variantOptionsFor(variants: CatalogVariants | null | undefined) {
  if (!variants) return VARIANT_OPTIONS;
  const allowed = new Set<Variant>(['OTHER']);
  if (variants.normal) allowed.add('NORMAL');
  if (variants.holo) allowed.add('HOLOFOIL');
  if (variants.reverse) allowed.add('REVERSE_HOLOFOIL');
  if (variants.firstEdition) allowed.add('FIRST_EDITION');
  if (allowed.size === 1) return VARIANT_OPTIONS;
  return VARIANT_OPTIONS.filter((o) => allowed.has(o.value));
}

export const CONFIDENCE_LABEL = { high: 'Alta confiança', medium: 'Média confiança', low: 'Baixa confiança' } as const;

export const MARKETPLACE_OPTIONS = [
  { value: 'cardmarket', label: 'Cardmarket', currency: 'EUR' },
  { value: 'tcgplayer', label: 'TCGplayer', currency: 'USD' },
] as const;
export const marketplaceLabel = (v: string) => MARKETPLACE_OPTIONS.find((o) => o.value === v)?.label ?? v;

export const PURCHASE_CURRENCY_OPTIONS = [
  { value: 'BRL', label: 'Real (R$)', prefix: 'R$' },
  { value: 'USD', label: 'Dólar (US$)', prefix: 'US$' },
  { value: 'EUR', label: 'Euro (€)', prefix: '€' },
] as const;

export const PERIOD_OPTIONS = [
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
  { value: '1y', label: '1 ano' },
  { value: 'all', label: 'Tudo' },
] as const;
