import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { EMAIL_VERIFICATION_PURPOSE } from './delivery/email-delivery-job.schema.js';
import type { DatabaseTransactionExecutor } from '../../../db/client.js';

export interface VerificationJobRecord {
  id: string;
  purpose: typeof EMAIL_VERIFICATION_PURPOSE;
  encryptionKeyId: string;
  encryptedPayload: string;
}

export interface CreateVerificationTokenAndJobRecord {
  accountId: string;
  emailAddress: string;
  tokenHash: string;
  expiresAt: Date;
  now: Date;
  job: VerificationJobRecord;
}

export interface EmailVerificationRepository {
  getEligibleAccountEmail(
    accountId: string,
    transaction?: DatabaseTransactionExecutor,
  ): Promise<string | null>;

  createTokenAndJob(
    input: CreateVerificationTokenAndJobRecord,
    transaction?: DatabaseTransactionExecutor,
  ): Promise<boolean>;
  consumeToken(tokenHash: string, now: Date): Promise<boolean>;
  cancelExpiredJobs(now: Date): Promise<number>;
}

interface AccountRow {
  id: string;
  email: string;
  status: string;
  email_verified_at: Date | null;
}

interface CandidateTokenRow {
  account_id: string;
}

interface LockedTokenRow {
  id: string;
  email_address: string;
  is_unexpired: boolean;
  consumed_at: Date | null;
  invalidated_at: Date | null;
}

interface InsertedTokenRow {
  id: string;
}

function firstRow<T>(result: { rows: unknown[] }): T | undefined {
  return result.rows[0] as T | undefined;
}

export function createEmailVerificationRepository(
  database: NodePgDatabase,
): EmailVerificationRepository {
  return {
    async getEligibleAccountEmail(accountId, transaction) {
      const executor = transaction ?? database;
      const result = await executor.execute(sql`
    SELECT email
    FROM users
    WHERE id = ${accountId}::uuid
      AND status = 'pending_email_verification'
      AND email_verified_at IS NULL
    LIMIT 1
  `);
      const account = firstRow<{ email: string }>(result);
      return account?.email ?? null;
    },

    async createTokenAndJob(input, transaction) {
      if (transaction) {
        return insertTokenAndJob(transaction, input);
      }

      return database.transaction((databaseTransaction) =>
        insertTokenAndJob(databaseTransaction, input),
      );
    },

    async consumeToken(tokenHash, now) {
      return database.transaction(async (transaction) => {
        const candidateResult = await transaction.execute(sql`
          SELECT account_id
          FROM email_verification_tokens
          WHERE token_hash = ${tokenHash}
          LIMIT 1
        `);
        const candidate = firstRow<CandidateTokenRow>(candidateResult);

        if (!candidate) return false;

        const accountResult = await transaction.execute(sql`
          SELECT id, email, status, email_verified_at
          FROM users
          WHERE id = ${candidate.account_id}::uuid
          FOR UPDATE
        `);
        const account = firstRow<AccountRow>(accountResult);

        if (
          !account ||
          account.email_verified_at !== null ||
          (account.status !== 'pending_email_verification' &&
            account.status !== 'suspended')
        ) {
          return false;
        }

        const tokenResult = await transaction.execute(sql`
          SELECT id, email_address, expires_at > ${now} AS is_unexpired,
                 consumed_at, invalidated_at
          FROM email_verification_tokens
          WHERE token_hash = ${tokenHash}
            AND account_id = ${account.id}::uuid
          FOR UPDATE
        `);
        const token = firstRow<LockedTokenRow>(tokenResult);

        if (
          !token ||
          token.consumed_at !== null ||
          token.invalidated_at !== null ||
          !token.is_unexpired ||
          token.email_address !== account.email
        ) {
          return false;
        }

        if (account.status === 'pending_email_verification') {
          await transaction.execute(sql`
            UPDATE users
            SET status = 'active', email_verified_at = ${now}
            WHERE id = ${account.id}::uuid
          `);
        } else {
          await transaction.execute(sql`
            UPDATE users
            SET email_verified_at = ${now}
            WHERE id = ${account.id}::uuid
          `);
        }

        await transaction.execute(sql`
          UPDATE email_verification_tokens
          SET consumed_at = ${now}
          WHERE id = ${token.id}::uuid
        `);

        await transaction.execute(sql`
          UPDATE email_verification_tokens
          SET invalidated_at = ${now}
          WHERE account_id = ${account.id}::uuid
            AND id <> ${token.id}::uuid
            AND consumed_at IS NULL
            AND invalidated_at IS NULL
        `);

        // Verification and cancellation/payload removal commit or roll back together.
        await transaction.execute(sql`
          UPDATE email_delivery_jobs
          SET status = 'cancelled',
              encryption_key_id = NULL,
              encrypted_payload = NULL,
              lease_owner = NULL,
              lease_expires_at = NULL,
              updated_at = ${now}
          WHERE verification_token_id IN (
            SELECT id
            FROM email_verification_tokens
            WHERE account_id = ${account.id}::uuid
          )
            AND status IN ('pending', 'leased')
        `);

        return true;
      });
    },

    async cancelExpiredJobs(now) {
      const result = await database.execute(sql`
        UPDATE email_delivery_jobs
        SET status = 'cancelled',
            encryption_key_id = NULL,
            encrypted_payload = NULL,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = ${now}
        WHERE status IN ('pending', 'leased')
          AND expires_at <= ${now}
        RETURNING id
      `);

      return result.rows.length;
    },
  };
}

async function insertTokenAndJob(
  transaction: DatabaseTransactionExecutor,
  input: CreateVerificationTokenAndJobRecord,
): Promise<boolean> {
  const accountResult = await transaction.execute(sql`
    SELECT id, email, status, email_verified_at
    FROM users
    WHERE id = ${input.accountId}::uuid
    FOR UPDATE
  `);
  const account = firstRow<AccountRow>(accountResult);

  if (
    !account ||
    account.email !== input.emailAddress ||
    account.status !== 'pending_email_verification' ||
    account.email_verified_at !== null
  ) {
    return false;
  }

  const tokenResult = await transaction.execute(sql`
    INSERT INTO email_verification_tokens
      (account_id, email_address, token_hash, expires_at, created_at)
    VALUES
      (${account.id}::uuid, ${input.emailAddress}, ${input.tokenHash},
       ${input.expiresAt}, ${input.now})
    RETURNING id
  `);
  const token = firstRow<InsertedTokenRow>(tokenResult);

  if (!token) {
    throw new Error('Verification token insert returned no row.');
  }

  await transaction.execute(sql`
    INSERT INTO email_delivery_jobs (
      id, verification_token_id, purpose, status, attempt_count,
      available_at, expires_at, encryption_key_id, encrypted_payload,
      created_at, updated_at
    )
    VALUES (
      ${input.job.id}::uuid,
      ${token.id}::uuid,
      ${input.job.purpose},
      'pending',
      0,
      ${input.now},
      ${input.expiresAt},
      ${input.job.encryptionKeyId},
      ${input.job.encryptedPayload},
      ${input.now},
      ${input.now}
    )
  `);

  return true;
}
