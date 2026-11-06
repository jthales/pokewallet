import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './tests/test-db.js';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/global-setup.ts'],
    env: { DATABASE_URL: TEST_DATABASE_URL, DATABASE_URL_UNPOOLED: TEST_DATABASE_URL },
    fileParallelism: false,
  },
});
