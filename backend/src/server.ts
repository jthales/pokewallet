import 'dotenv/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPrisma } from './db.js';
import { TcgdexCatalogService } from './integrations/tcgdex/tcgdex-catalog.service.js';

const config = loadConfig();
const prisma = createPrisma();
const catalog = new TcgdexCatalogService({
  baseUrl: config.TCGDEX_BASE_URL,
  timeoutMs: config.CATALOG_TIMEOUT_MS,
  cacheTtlMs: config.CATALOG_CACHE_TTL_SECONDS * 1000,
});

const staticDir = resolve(process.cwd(), '../frontend/dist/frontend/browser');
const app = createApp({
  prisma,
  catalog,
  corsOrigin: config.CORS_ORIGIN,
  staticDir: existsSync(staticDir) ? staticDir : undefined,
});

const server = app.listen(config.PORT, '0.0.0.0', () => {
  console.log(`PokéWallet API em http://localhost:${config.PORT}/api`);
});

const shutdown = () => {
  server.close(() => void prisma.$disconnect().then(() => process.exit(0)));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
