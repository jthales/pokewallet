import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPrisma } from './db.js';
import { FrankfurterExchangeRateSource } from './integrations/frankfurter/frankfurter.source.js';
import { TcgdexCatalogService } from './integrations/tcgdex/tcgdex-catalog.service.js';
import { TcgdexMarketPriceProvider } from './integrations/tcgdex/tcgdex-pricing.js';

/**
 * Ponto de entrada da função serverless do Vercel (veja /api/index.mjs e /vercel.json).
 * O app é criado uma vez por instância e reaproveitado entre requisições, junto com o cache do catálogo.
 * O frontend é servido como arquivo estático pelo próprio Vercel, então aqui só existe a API.
 */
const config = loadConfig();
const app = createApp({
  prisma: createPrisma(),
  catalog: new TcgdexCatalogService({
    baseUrl: config.TCGDEX_BASE_URL,
    timeoutMs: config.CATALOG_TIMEOUT_MS,
    cacheTtlMs: config.CATALOG_CACHE_TTL_SECONDS * 1000,
  }),
  prices: new TcgdexMarketPriceProvider({ baseUrl: config.TCGDEX_BASE_URL, timeoutMs: config.PRICE_TIMEOUT_MS }),
  exchangeRates: new FrankfurterExchangeRateSource({ baseUrl: config.FX_BASE_URL, timeoutMs: config.PRICE_TIMEOUT_MS }),
});

export default app;
