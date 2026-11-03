import { sql } from 'drizzle-orm';
import {
  check,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const accountStatus = pgEnum('account_status', [
  'pending_email_verification',
  'active',
  'suspended',
]);

// Buying eligibility is account state; this permission is separate from identity.
export const userPermission = pgEnum('user_permission', [
  'administrator',
  'seller',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firstName: varchar('first_name', { length: 100 }).notNull(),
    lastName: varchar('last_name', { length: 100 }).notNull(),
    email: varchar('email', { length: 320 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    status: accountStatus('status')
      .notNull()
      .default('pending_email_verification'),
    emailVerifiedAt: timestamp('email_verified_at', {
      withTimezone: true,
      mode: 'date',
    }),
    termsAcceptedVersion: varchar('terms_accepted_version', {
      length: 64,
    }).notNull(),
    termsAcceptedAt: timestamp('terms_accepted_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'users_first_name_not_blank',
      sql`length(btrim(${table.firstName})) > 0`,
    ),
    check(
      'users_last_name_not_blank',
      sql`length(btrim(${table.lastName})) > 0`,
    ),
    check(
      'users_email_not_blank',
      sql`length(btrim(${table.email})) > 0 AND ${table.email} = btrim(${table.email})`,
    ),
    check(
      'users_password_hash_not_blank',
      sql`length(btrim(${table.passwordHash})) > 0`,
    ),
    check(
      'users_terms_version_not_blank',
      sql`length(btrim(${table.termsAcceptedVersion})) > 0`,
    ),
    check(
      'users_active_requires_verified_email',
      sql`${table.status} <> 'active' OR ${table.emailVerifiedAt} IS NOT NULL`,
    ),
    check(
      'users_pending_requires_unverified_email',
      sql`${table.status} <> 'pending_email_verification' OR ${table.emailVerifiedAt} IS NULL`,
    ),
    // The functional index makes uniqueness case-insensitive, even for direct SQL writes.
    uniqueIndex('users_email_normalized_unique').on(
      sql`lower(btrim(${table.email}))`,
    ),
  ],
);

export const userPermissions = pgTable(
  'user_permissions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permission: userPermission('permission').notNull(),
    grantedAt: timestamp('granted_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'user_permissions_pk',
      columns: [table.userId, table.permission],
    }),
  ],
);
