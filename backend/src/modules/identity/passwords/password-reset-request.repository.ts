import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { DatabaseTransactionExecutor } from '../../../db/client.js';

const HOUR_MS = 60 * 60 * 1000;

export interface PasswordResetRequestPolicy {
  now: Date;
  cooldownMs: number;
  maxJobsPerHour: number;
}

export interface LockedResetAccount {
  id: string;
  email: string;
}

export type QueuePasswordReset = (
  account: LockedResetAccount,
  transaction: DatabaseTransactionExecutor,
) => Promise<void>;

export interface CreatePasswordResetTokenAndJob {
  accountId: string;
  emailAddress: string;
  tokenHash: string;
  expiresAt: Date;
  now: Date;
  job: {
    id: string;
    encryptionKeyId: string;
    encryptedPayload: string;
  };
}

export interface PasswordResetRequestRepository {
  queueIfAllowed(
    email: string,
    policy: PasswordResetRequestPolicy,
    queue: QueuePasswordReset,
  ): Promise<boolean>;

  createTokenAndJob(
    input: CreatePasswordResetTokenAndJob,
    transaction: DatabaseTransactionExecutor,
  ): Promise<boolean>;
}

interface ResetAccountRow {
  id: string;
  email: string;
  status: string;
  email_verified_at: Date | null;
}

interface JobWindowRow {
  job_count: number | string;
  latest_job_at: Date | string | null;
}

interface InsertedTokenRow {
  id: string;
}

function firstRow<T>(result: { rows: unknown[] }): T | undefined {
  return result.rows[0] as T | undefined;
}

function dateMilliseconds(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

/**
 * Serializes account reset requests by locking the user row before checking
 * queued-job limits and inserting the token/job in the same transaction.
 */
export function createPasswordResetRequestRepository(
  database: NodePgDatabase,
): PasswordResetRequestRepository {
  return {
    async queueIfAllowed(email, policy, queue) {
      return database.transaction(async (transaction) => {
        const accountResult = await transaction.execute(sql`
          SELECT id, email, status, email_verified_at
          FROM users
          WHERE lower(btrim(email)) = ${email}
          FOR UPDATE
        `);
        const account = firstRow<ResetAccountRow>(accountResult);

        if (
          !account ||
          account.status !== 'active' ||
          account.email_verified_at === null
        ) {
          return false;
        }

        const hourStart = new Date(policy.now.getTime() - HOUR_MS);
        const windowResult = await transaction.execute(sql`
          SELECT count(*)::int AS job_count,
                 max(jobs.created_at) AS latest_job_at
          FROM password_reset_tokens AS tokens
          JOIN email_delivery_jobs AS jobs
            ON jobs.password_reset_token_id = tokens.id
          WHERE tokens.account_id = ${account.id}::uuid
            AND jobs.purpose = 'password_reset'
            AND jobs.created_at > ${hourStart}
        `);
        const window = firstRow<JobWindowRow>(windowResult);

        if (!window) {
          throw new Error('Password reset job window query returned no row.');
        }

        const latestJobAt = window.latest_job_at
          ? dateMilliseconds(window.latest_job_at)
          : undefined;
        const cooldownStart = policy.now.getTime() - policy.cooldownMs;

        if (
          Number(window.job_count) >= policy.maxJobsPerHour ||
          (latestJobAt !== undefined && latestJobAt > cooldownStart)
        ) {
          return false;
        }

        await queue({ id: account.id, email: account.email }, transaction);
        return true;
      });
    },

    async createTokenAndJob(input, transaction) {
      const accountResult = await transaction.execute(sql`
        SELECT id, email, status, email_verified_at
        FROM users
        WHERE id = ${input.accountId}::uuid
        FOR UPDATE
      `);
      const account = firstRow<ResetAccountRow>(accountResult);

      if (
        !account ||
        account.email !== input.emailAddress ||
        account.status !== 'active' ||
        account.email_verified_at === null
      ) {
        return false;
      }

      const tokenResult = await transaction.execute(sql`
        INSERT INTO password_reset_tokens
          (account_id, email_address, token_hash, expires_at, created_at)
        VALUES
          (${account.id}::uuid, ${input.emailAddress}, ${input.tokenHash},
           ${input.expiresAt}, ${input.now})
        RETURNING id
      `);
      const token = firstRow<InsertedTokenRow>(tokenResult);

      if (!token) {
        throw new Error('Password reset token insert returned no row.');
      }

      await transaction.execute(sql`
        INSERT INTO email_delivery_jobs (
          id, verification_token_id, password_reset_token_id, purpose, status,
          attempt_count, available_at, expires_at, encryption_key_id,
          encrypted_payload, created_at, updated_at
        )
        VALUES (
          ${input.job.id}::uuid,
          NULL,
          ${token.id}::uuid,
          'password_reset',
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
    },
  };
}
