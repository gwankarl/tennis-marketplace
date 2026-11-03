import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const loginRateLimitScope = pgEnum('login_rate_limit_scope', [
  'ip',
  'email',
]);

export const loginAttemptCounters = pgTable(
  'login_attempt_counters',
  {
    scope: loginRateLimitScope('scope').notNull(),
    // HMAC-derived key; neither submitted email nor client IP is stored here.
    keyHash: varchar('key_hash', { length: 64 }).notNull(),
    windowStartedAt: timestamp('window_started_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .defaultNow(),
    attemptCount: integer('attempt_count').notNull().default(1),
  },
  (table) => [
    primaryKey({
      name: 'login_attempt_counters_pk',
      columns: [table.scope, table.keyHash],
    }),
    check(
      'login_attempt_counters_key_hash_format',
      sql`${table.keyHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'login_attempt_counters_count_bounded',
      sql`${table.attemptCount} BETWEEN 1 AND 1000`,
    ),
    index('login_attempt_counters_window_idx').on(table.windowStartedAt),
  ],
);
