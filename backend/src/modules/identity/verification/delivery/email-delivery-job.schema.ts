import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  text,
} from 'drizzle-orm/pg-core';
import { passwordResetTokens } from '../../passwords/password-reset-token.schema.js';
import { emailVerificationTokens } from '../email-verification.schema.js';

export const EMAIL_VERIFICATION_PURPOSE = 'email_verification' as const;
export const PASSWORD_RESET_PURPOSE = 'password_reset' as const;

export const emailDeliveryJobStatus = pgEnum('email_delivery_job_status', [
  'pending',
  'leased',
  'sent',
  'failed',
  'cancelled',
]);

export const emailDeliveryJobs = pgTable(
  'email_delivery_jobs',
  {
    id: uuid('id').primaryKey(),
    verificationTokenId: uuid('verification_token_id').references(
      () => emailVerificationTokens.id,
      { onDelete: 'cascade' },
    ),
    passwordResetTokenId: uuid('password_reset_token_id').references(
      () => passwordResetTokens.id,
      { onDelete: 'cascade' },
    ),
    purpose: varchar('purpose', { length: 32 }).notNull(),
    status: emailDeliveryJobStatus('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    availableAt: timestamp('available_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    leaseOwner: varchar('lease_owner', { length: 128 }),
    leaseExpiresAt: timestamp('lease_expires_at', {
      withTimezone: true,
      mode: 'date',
    }),
    encryptionKeyId: varchar('encryption_key_id', { length: 64 }),
    encryptedPayload: text('encrypted_payload'),
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
      'email_delivery_jobs_purpose_check',
      sql`${table.purpose} IN ('email_verification', 'password_reset')`,
    ),
    check(
      'email_delivery_jobs_token_purpose_check',
      sql`(
        ${table.purpose} = 'email_verification'
        AND ${table.verificationTokenId} IS NOT NULL
        AND ${table.passwordResetTokenId} IS NULL
      ) OR (
        ${table.purpose} = 'password_reset'
        AND ${table.verificationTokenId} IS NULL
        AND ${table.passwordResetTokenId} IS NOT NULL
      )`,
    ),
    check(
      'email_delivery_jobs_attempt_count_bounded',
      sql`${table.attemptCount} BETWEEN 0 AND 5`,
    ),
    check(
      'email_delivery_jobs_lease_shape',
      sql`(
        ${table.status} = 'leased'
        AND ${table.leaseOwner} IS NOT NULL
        AND ${table.leaseExpiresAt} IS NOT NULL
      ) OR (
        ${table.status} <> 'leased'
        AND ${table.leaseOwner} IS NULL
        AND ${table.leaseExpiresAt} IS NULL
      )`,
    ),
    check(
      'email_delivery_jobs_payload_matches_status',
      sql`(
        ${table.status} IN ('pending', 'leased')
        AND ${table.encryptionKeyId} IS NOT NULL
        AND ${table.encryptedPayload} IS NOT NULL
      ) OR (
        ${table.status} IN ('sent', 'failed', 'cancelled')
        AND ${table.encryptionKeyId} IS NULL
        AND ${table.encryptedPayload} IS NULL
      )`,
    ),
    uniqueIndex('email_delivery_jobs_token_unique').on(
      table.verificationTokenId,
    ),
    uniqueIndex('email_delivery_jobs_password_reset_token_unique')
      .on(table.passwordResetTokenId)
      .where(sql`${table.passwordResetTokenId} IS NOT NULL`),
    index('email_delivery_jobs_schedule_idx').on(
      table.status,
      table.availableAt,
    ),
    index('email_delivery_jobs_expiry_idx').on(table.status, table.expiresAt),
  ],
);
