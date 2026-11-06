import 'dotenv/config';

const base = process.env['TEST_DATABASE_URL'] ?? 'postgresql://pokewallet:pokewallet@localhost:5432/pokewallet_test';
const url = new URL(base);
url.searchParams.set('schema', 'vitest');

/** URL do banco de testes, sempre no schema isolado "vitest". */
export const TEST_DATABASE_URL = url.toString();
