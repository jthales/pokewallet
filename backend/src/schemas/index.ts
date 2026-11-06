import { z } from 'zod';
import { CONDITIONS, ITEM_STATUSES, PHYSICAL_LANGUAGES, VARIANTS } from '../domain.js';

const Lang = z.enum(['en', 'pt']).default('en');
const Cents = z.number().int().min(0).max(1_000_000_00);
const OptionalDate = z.coerce.date().nullable().optional();
const Notes = z.string().trim().max(1000).nullable().optional();
const Id = z.string().trim().min(1).max(100);

export const CatalogSearchQuerySchema = z
  .object({
    name: z.string().trim().max(80).optional(),
    number: z.string().trim().max(20).optional(),
    setId: z.string().trim().max(40).optional(),
    page: z.coerce.number().int().min(1).max(500).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(24),
    lang: Lang,
  })
  .refine((q) => !!(q.name || q.number || q.setId), { message: 'Informe nome, número ou expansão.' });

export const LangQuerySchema = z.object({ lang: Lang });

export const IdentifySchema = z
  .object({
    fullText: z.string().max(10_000).optional(),
    nameText: z.string().max(2_000).optional(),
    numberText: z.string().max(2_000).optional(),
    language: z.enum(['en', 'pt']).optional(),
    offset: z.number().int().min(0).max(200).default(0),
    limit: z.number().int().min(1).max(20).default(5),
  })
  .strict();

const ItemFields = {
  condition: z.enum(CONDITIONS),
  variant: z.enum(VARIANTS),
  language: z.enum(PHYSICAL_LANGUAGES),
  acquiredAt: OptionalDate,
  purchasePriceCents: Cents.nullable().optional(),
  notes: Notes,
};

export const CreateItemsSchema = z
  .object({
    provider: z.string().trim().min(1).max(30).default('tcgdex'),
    externalId: Id,
    quantity: z.number().int().min(1).max(50).default(1),
    ...ItemFields,
  })
  .strict();
export type CreateItemsInput = z.infer<typeof CreateItemsSchema>;

export const UpdateItemSchema = z
  .object({
    condition: ItemFields.condition.optional(),
    variant: ItemFields.variant.optional(),
    language: ItemFields.language.optional(),
    acquiredAt: OptionalDate,
    purchasePriceCents: ItemFields.purchasePriceCents,
    notes: Notes,
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nada para atualizar.' });
export type UpdateItemInput = z.infer<typeof UpdateItemSchema>;

export const CollectionQuerySchema = z.object({
  search: z.string().trim().max(80).optional(),
  setId: z.string().trim().max(40).optional(),
  rarity: z.string().trim().max(60).optional(),
  status: z.enum(ITEM_STATUSES).optional(),
  sort: z.enum(['name', 'createdAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).optional(),
});
export type CollectionQuery = z.infer<typeof CollectionQuerySchema>;

export const SellItemSchema = z
  .object({
    soldAt: z.coerce.date(),
    salePriceCents: Cents,
    notes: Notes,
  })
  .strict();
export type SellItemInput = z.infer<typeof SellItemSchema>;

export const UpdateSaleSchema = z
  .object({
    soldAt: z.coerce.date().optional(),
    salePriceCents: Cents.optional(),
    notes: Notes,
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nada para atualizar.' });
export type UpdateSaleInput = z.infer<typeof UpdateSaleSchema>;

export const SalesQuerySchema = z.object({
  includeCancelled: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
