import { defineConfig } from 'drizzle-kit';
import { env } from './src/config/runtime-env.js';

export default defineConfig({
  schema: [
    './src/db/accounts.schema.ts',
    './src/identity/user-session.schema.ts',
    './src/identity/login-attempt-counter.schema.ts',
    './src/identity/email-verification.schema.ts',
    './src/identity/email-delivery-job.schema.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
});
