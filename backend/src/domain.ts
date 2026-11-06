export const CONDITIONS = ['MINT', 'NEAR_MINT', 'LIGHTLY_PLAYED', 'MODERATELY_PLAYED', 'HEAVILY_PLAYED', 'DAMAGED'] as const;
export type Condition = (typeof CONDITIONS)[number];

export const VARIANTS = ['NORMAL', 'HOLOFOIL', 'REVERSE_HOLOFOIL', 'FIRST_EDITION', 'OTHER'] as const;
export type Variant = (typeof VARIANTS)[number];

export const ITEM_STATUSES = ['AVAILABLE', 'SOLD'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** Idiomas físicos aceitos para um exemplar (códigos usados pela própria Pokémon/TCGdex). */
export const PHYSICAL_LANGUAGES = ['pt', 'en', 'es', 'fr', 'de', 'it', 'ja', 'ko', 'zh', 'other'] as const;

export const DEFAULT_CURRENCY = 'BRL';
