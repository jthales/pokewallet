import { execSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './test-db.js';

/**
 * Recria o schema do banco de testes e aplica as migrations reais.
 * Usa um schema próprio ("vitest") para nunca tocar nos dados de desenvolvimento.
 */
export default function setup() {
  const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL, DATABASE_URL_UNPOOLED: TEST_DATABASE_URL };
  execSync('npx prisma db execute --stdin --schema prisma/schema.prisma', {
    input: 'DROP SCHEMA IF EXISTS "vitest" CASCADE; CREATE SCHEMA "vitest";',
    env,
    stdio: ['pipe', 'ignore', 'inherit'],
  });
  execSync('npx prisma migrate deploy', { env, stdio: ['ignore', 'ignore', 'inherit'] });
}
