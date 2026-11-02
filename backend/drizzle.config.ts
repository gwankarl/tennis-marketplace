import { defineConfig } from 'drizzle-kit';
import { env } from './src/config/runtime-env.js';

export default defineConfig({
  schema: './src/db/accounts.schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
});
