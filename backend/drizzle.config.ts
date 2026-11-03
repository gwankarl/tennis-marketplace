import { defineConfig } from 'drizzle-kit';
import { env } from './src/config/runtime-env.js';

export default defineConfig({
  schema: [
    './src/modules/identity/accounts/accounts.schema.ts',
    './src/modules/identity/sessions/user-session.schema.ts',
    './src/modules/identity/sessions/login-attempt-counter.schema.ts',
    './src/modules/identity/verification/email-verification.schema.ts',
    './src/modules/identity/passwords/password-reset-token.schema.ts',
    './src/modules/identity/verification/delivery/email-delivery-job.schema.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
});
