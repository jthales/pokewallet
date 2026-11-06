import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  TCGDEX_BASE_URL: z.url().default('https://api.tcgdex.net/v2'),
  CATALOG_CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(21600),
  CATALOG_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  FX_BASE_URL: z.url().default('https://api.frankfurter.dev/v2'),
  PRICE_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  CORS_ORIGIN: z.string().default('http://localhost:4200'),
  NODE_ENV: z.string().default('development'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return EnvSchema.parse(env);
}
