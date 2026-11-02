import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from '../db/accounts.schema.js';

export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emailAddress: varchar('email_address', { length: 320 }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    consumedAt: timestamp('consumed_at', {
      withTimezone: true,
      mode: 'date',
    }),
    invalidatedAt: timestamp('invalidated_at', {
      withTimezone: true,
      mode: 'date',
    }),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'email_verification_tokens_email_not_blank',
      sql`length(btrim(${table.emailAddress})) > 0`,
    ),
    check(
      'email_verification_tokens_hash_format',
      sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'email_verification_tokens_one_terminal_state',
      sql`${table.consumedAt} IS NULL OR ${table.invalidatedAt} IS NULL`,
    ),
    uniqueIndex('email_verification_tokens_hash_unique').on(table.tokenHash),
    index('email_verification_tokens_account_idx').on(table.accountId),
  ],
);
