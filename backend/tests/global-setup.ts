import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

/** Cria um banco SQLite limpo e exclusivo para os testes aplicando as migrations reais. */
export default function setup() {
  const db = resolve(import.meta.dirname, '../prisma/test.db');
  for (const file of [db, `${db}-journal`]) rmSync(file, { force: true });
  execSync('npx prisma migrate deploy', { stdio: 'ignore', env: { ...process.env, DATABASE_URL: 'file:./test.db' } });
}
