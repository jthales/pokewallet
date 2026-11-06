import { z } from 'zod';

/**
 * Schemas das respostas da TCGdex REST API v2, validados com Zod.
 * Usamos `.loose()` para tolerar campos novos sem quebrar, mas exigimos os campos de que dependemos.
 */

const CardCount = z
  .object({
    official: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
  })
  .loose();

export const TcgdexCardBriefSchema = z
  .object({
    id: z.string().min(1),
    localId: z.union([z.string(), z.number()]).transform(String),
    name: z.string().min(1),
    image: z.url().optional(),
  })
  .loose();
export type TcgdexCardBrief = z.infer<typeof TcgdexCardBriefSchema>;

export const TcgdexCardBriefListSchema = z.array(TcgdexCardBriefSchema);

export const TcgdexSetBriefSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    logo: z.url().optional(),
    symbol: z.url().optional(),
    cardCount: CardCount.optional(),
  })
  .loose();
export type TcgdexSetBrief = z.infer<typeof TcgdexSetBriefSchema>;

export const TcgdexSetBriefListSchema = z.array(TcgdexSetBriefSchema);

const Variants = z
  .object({
    normal: z.boolean().optional(),
    reverse: z.boolean().optional(),
    holo: z.boolean().optional(),
    firstEdition: z.boolean().optional(),
    wPromo: z.boolean().optional(),
  })
  .loose();

export const TcgdexCardSchema = z
  .object({
    id: z.string().min(1),
    localId: z.union([z.string(), z.number()]).transform(String),
    name: z.string().min(1),
    image: z.url().optional(),
    category: z.string().optional(),
    illustrator: z.string().optional(),
    rarity: z.string().optional(),
    set: TcgdexSetBriefSchema,
    variants: Variants.optional(),
  })
  .loose();
export type TcgdexCard = z.infer<typeof TcgdexCardSchema>;

export const TcgdexSetSchema = TcgdexSetBriefSchema.extend({
  releaseDate: z.string().optional(),
  serie: z.object({ id: z.string(), name: z.string() }).loose().optional(),
  cards: TcgdexCardBriefListSchema.default([]),
});
export type TcgdexSet = z.infer<typeof TcgdexSetSchema>;

export const TcgdexSerieSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    sets: z.array(TcgdexSetBriefSchema).default([]),
  })
  .loose();
