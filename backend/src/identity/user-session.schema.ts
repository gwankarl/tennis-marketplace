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

export const userSessions = pgTable(
  'user_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // SHA-256 hex of the random bearer credential; never store the credential itself.
    credentialHash: varchar('credential_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .defaultNow(),
    lastActivityAt: timestamp('last_activity_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .defaultNow(),
    absoluteExpiresAt: timestamp('absolute_expires_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    revokedAt: timestamp('revoked_at', {
      withTimezone: true,
      mode: 'date',
    }),
  },
  (table) => [
    check(
      'user_sessions_credential_hash_format',
      sql`${table.credentialHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'user_sessions_expiry_after_creation',
      sql`${table.absoluteExpiresAt} > ${table.createdAt}`,
    ),
    check(
      'user_sessions_activity_after_creation',
      sql`${table.lastActivityAt} >= ${table.createdAt}`,
    ),
    check(
      'user_sessions_revocation_after_creation',
      sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`,
    ),
    uniqueIndex('user_sessions_credential_hash_unique').on(
      table.credentialHash,
    ),
    index('user_sessions_user_idx').on(table.userId),
    index('user_sessions_active_expiry_idx')
      .on(table.absoluteExpiresAt)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);