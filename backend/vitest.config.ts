import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/global-setup.ts'],
    env: { DATABASE_URL: 'file:./test.db' },
    fileParallelism: false,
  },
});
