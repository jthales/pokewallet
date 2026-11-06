import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from './test-db.js';

/**
 * Aplica as migrations uma a uma num schema separado, com dados "de produção" inseridos ANTES da migration
 * da carteira, e confere que nada foi perdido ou alterado.
 */
const url = new URL(TEST_DATABASE_URL);
url.searchParams.set('schema', 'vitest_migration');
const env = { ...process.env, DATABASE_URL: url.toString(), DATABASE_URL_UNPOOLED: url.toString() };
const migrationsDir = join(process.cwd(), 'prisma', 'migrations');
const migrations = readdirSync(migrationsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();

const sql = (input: string) => execSync('npx prisma db execute --stdin --schema prisma/schema.prisma', { input, env, stdio: ['pipe', 'ignore', 'inherit'] });
const applyMigration = (name: string) =>
  execSync(`npx prisma db execute --file ${join(migrationsDir, name, 'migration.sql')} --schema prisma/schema.prisma`, { env, stdio: ['ignore', 'ignore', 'inherit'] });

let client: PrismaClient | undefined;
afterAll(async () => {
  await client?.$disconnect();
  sql('DROP SCHEMA IF EXISTS "vitest_migration" CASCADE;');
});

describe('Migrations', () => {
  it('a migration da carteira preserva cartas, exemplares, aquisições, vendas, condições e variantes', async () => {
    const portfolioIndex = migrations.findIndex((m) => m.endsWith('_portfolio'));
    expect(portfolioIndex).toBeGreaterThan(0);

    sql('DROP SCHEMA IF EXISTS "vitest_migration" CASCADE; CREATE SCHEMA "vitest_migration"; SET search_path TO "vitest_migration";');
    // As migrations não qualificam o schema; o search_path vem da URL (?schema=).
    for (const m of migrations.slice(0, portfolioIndex)) applyMigration(m);
    sql(`
      INSERT INTO "CardCatalog" ("id","externalId","provider","name","localNumber","setId","setName","rarity","imageUrl","metadata","updatedAt")
        VALUES ('card1','swsh3-136','tcgdex','Furret','136','swsh3','Darkness Ablaze','Uncommon',NULL,'{"variants":{"normal":true}}',NOW());
      INSERT INTO "CollectionItem" ("id","cardCatalogId","condition","variant","language","acquiredAt","purchasePriceCents","currency","notes","status","updatedAt")
        VALUES ('item1','card1','NEAR_MINT','REVERSE_HOLOFOIL','pt','2026-10-01',1250,'BRL','primeira','SOLD',NOW()),
               ('item2','card1','LIGHTLY_PLAYED','NORMAL','en',NULL,NULL,'BRL',NULL,'AVAILABLE',NOW());
      INSERT INTO "Sale" ("id","collectionItemId","soldAt","salePriceCents","currency","notes","updatedAt")
        VALUES ('sale1','item1','2026-11-01',4590,'BRL','vendida',NOW());
    `);

    for (const m of migrations.slice(portfolioIndex)) applyMigration(m);

    client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    const card = await client.cardCatalog.findUniqueOrThrow({ where: { id: 'card1' } });
    expect(card).toMatchObject({ name: 'Furret', externalId: 'swsh3-136', rarity: 'Uncommon', metadata: { variants: { normal: true } }, pricesCheckedAt: null });
    const items = await client.collectionItem.findMany({ orderBy: { id: 'asc' } });
    expect(items).toMatchObject([
      { id: 'item1', condition: 'NEAR_MINT', variant: 'REVERSE_HOLOFOIL', purchasePriceCents: 1250, currency: 'BRL', status: 'SOLD', notes: 'primeira', manualValueCents: null, purchaseFxRate: null },
      { id: 'item2', condition: 'LIGHTLY_PLAYED', variant: 'NORMAL', purchasePriceCents: null, status: 'AVAILABLE' },
    ]);
    expect(items[0]!.acquiredAt!.toISOString().slice(0, 10)).toBe('2026-10-01');
    const sale = await client.sale.findUniqueOrThrow({ where: { id: 'sale1' } });
    expect(sale).toMatchObject({ salePriceCents: 4590, notes: 'vendida', cancelledAt: null, feesCents: null });
    // O índice que impede duas vendas ativas continua valendo.
    await expect(client.sale.create({ data: { collectionItemId: 'item1', soldAt: new Date(), salePriceCents: 1 } })).rejects.toThrow();
    // As tabelas novas existem e funcionam.
    expect(await client.cardPriceSnapshot.count()).toBe(0);
  });
});
