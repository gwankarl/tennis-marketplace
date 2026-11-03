import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

export interface ClaimedEmailJob {
  id: string;
  claimId: string;
  purpose: 'email_verification';
  attemptCount: number;
  keyId: string;
  encryptedPayload: string;
  jobExpiresAt: Date;
  tokenExpiresAt: Date;
  tokenEmail: string;
  accountEmail: string;
}

export interface ClaimResult {
  job: ClaimedEmailJob | null;
  cancelledCount: number;
}

export type RetryResult = 'pending' | 'failed' | 'cancelled' | 'stale';

export interface EmailDeliveryRepository {
  claimNext(
    now: Date,
    leaseUntil: Date,
    claimId: string,
    maxAttempts: number,
  ): Promise<ClaimResult>;
  getCurrentClaim(
    jobId: string,
    claimId: string,
    now: Date,
  ): Promise<ClaimedEmailJob | null>;
  cancelClaim(jobId: string, claimId: string, now: Date): Promise<boolean>;
  markSent(jobId: string, claimId: string, now: Date): Promise<boolean>;
  markFailed(jobId: string, claimId: string, now: Date): Promise<boolean>;
  scheduleRetry(
    jobId: string,
    claimId: string,
    now: Date,
    retryAt: Date,
    maxAttempts: number,
  ): Promise<RetryResult>;
}

interface ClaimedRow {
  id: string;
  purpose: 'email_verification';
  attempt_count: number;
  encryption_key_id: string;
  encrypted_payload: string;
  job_expires_at: Date | string;
  token_expires_at: Date | string;
  token_email: string;
  account_email: string;
}

function firstRow<T>(result: { rows: unknown[] }): T | undefined {
  return result.rows[0] as T | undefined;
}

function asDate(value: Date | string): Date {
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid email delivery expiry value.');
  }

  return date;
}

async function readClaim(
  executor: Pick<NodePgDatabase, 'execute'>,
  jobId: string,
  claimId: string,
  now: Date,
): Promise<ClaimedRow | undefined> {
  const result = await executor.execute(sql`
    SELECT
      jobs.id,
      jobs.purpose,
      jobs.attempt_count,
      jobs.encryption_key_id,
      jobs.encrypted_payload,
      jobs.expires_at AS job_expires_at,
      tokens.expires_at AS token_expires_at,
      tokens.email_address AS token_email,
      users.email AS account_email
    FROM email_delivery_jobs AS jobs
    JOIN email_verification_tokens AS tokens
      ON tokens.id = jobs.verification_token_id
    JOIN users ON users.id = tokens.account_id
    WHERE jobs.id = ${jobId}::uuid
      AND jobs.status = 'leased'
      AND jobs.lease_owner = ${claimId}
      AND jobs.lease_expires_at > ${now}
      AND jobs.purpose = 'email_verification'
      AND jobs.expires_at > ${now}
      AND tokens.expires_at > ${now}
      AND tokens.consumed_at IS NULL
      AND tokens.invalidated_at IS NULL
      AND tokens.email_address = users.email
      AND users.status = 'pending_email_verification'
      AND users.email_verified_at IS NULL
    LIMIT 1
  `);

  return firstRow<ClaimedRow>(result);
}

function mapClaim(row: ClaimedRow, claimId: string): ClaimedEmailJob {
  return {
    id: row.id,
    claimId,
    purpose: row.purpose,
    attemptCount: row.attempt_count,
    keyId: row.encryption_key_id,
    encryptedPayload: row.encrypted_payload,
    jobExpiresAt: asDate(row.job_expires_at),
    tokenExpiresAt: asDate(row.token_expires_at),
    tokenEmail: row.token_email,
    accountEmail: row.account_email,
  };
}

export function createEmailDeliveryRepository(
  database: NodePgDatabase,
): EmailDeliveryRepository {
  return {
    async claimNext(now, leaseUntil, claimId, maxAttempts) {
      return database.transaction(async (transaction) => {
        const expired = await transaction.execute(sql`
          UPDATE email_delivery_jobs AS jobs
          SET status = 'cancelled',
              encryption_key_id = NULL,
              encrypted_payload = NULL,
              lease_owner = NULL,
              lease_expires_at = NULL,
              updated_at = ${now}
          WHERE jobs.status IN ('pending', 'leased')
            AND (
              jobs.expires_at <= ${now}
              OR NOT EXISTS (
                SELECT 1
                FROM email_verification_tokens AS tokens
                JOIN users ON users.id = tokens.account_id
                WHERE tokens.id = jobs.verification_token_id
                  AND tokens.expires_at > ${now}
                  AND tokens.consumed_at IS NULL
                  AND tokens.invalidated_at IS NULL
                  AND tokens.email_address = users.email
                  AND users.status = 'pending_email_verification'
                  AND users.email_verified_at IS NULL
              )
            )
          RETURNING jobs.id
        `);

        await transaction.execute(sql`
          UPDATE email_delivery_jobs
          SET status = 'failed',
              encryption_key_id = NULL,
              encrypted_payload = NULL,
              lease_owner = NULL,
              lease_expires_at = NULL,
              updated_at = ${now}
          WHERE status = 'leased'
            AND lease_expires_at <= ${now}
            AND attempt_count >= ${maxAttempts}
        `);

        const candidate = await transaction.execute(sql`
          WITH next_job AS (
            SELECT jobs.id
            FROM email_delivery_jobs AS jobs
            JOIN email_verification_tokens AS tokens
              ON tokens.id = jobs.verification_token_id
            JOIN users ON users.id = tokens.account_id
            WHERE jobs.purpose = 'email_verification'
              AND jobs.expires_at > ${now}
              AND tokens.expires_at > ${now}
              AND tokens.consumed_at IS NULL
              AND tokens.invalidated_at IS NULL
              AND tokens.email_address = users.email
              AND users.status = 'pending_email_verification'
              AND users.email_verified_at IS NULL
              AND jobs.attempt_count < ${maxAttempts}
              AND (
                (jobs.status = 'pending' AND jobs.available_at <= ${now})
                OR (
                  jobs.status = 'leased'
                  AND jobs.lease_expires_at <= ${now}
                )
              )
            ORDER BY jobs.available_at, jobs.created_at
            LIMIT 1
            FOR UPDATE OF jobs SKIP LOCKED
          )
          UPDATE email_delivery_jobs AS jobs
          SET status = 'leased',
              attempt_count = jobs.attempt_count + 1,
              lease_owner = ${claimId},
              lease_expires_at = ${leaseUntil},
              updated_at = ${now}
          FROM next_job
          WHERE jobs.id = next_job.id
          RETURNING jobs.id
        `);

        const claimedId = firstRow<{ id: string }>(candidate)?.id;
        const row = claimedId
          ? await readClaim(transaction, claimedId, claimId, now)
          : undefined;

        return {
          job: row ? mapClaim(row, claimId) : null,
          cancelledCount: expired.rows.length,
        };
      });
    },

    async getCurrentClaim(jobId, claimId, now) {
      const row = await readClaim(database, jobId, claimId, now);
      return row ? mapClaim(row, claimId) : null;
    },

    async cancelClaim(jobId, claimId, now) {
      const result = await database.execute(sql`
        UPDATE email_delivery_jobs
        SET status = 'cancelled',
            encryption_key_id = NULL,
            encrypted_payload = NULL,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = ${now}
        WHERE id = ${jobId}::uuid
          AND status = 'leased'
          AND lease_owner = ${claimId}
          AND lease_expires_at > ${now}
        RETURNING id
      `);

      return result.rows.length === 1;
    },

    async markSent(jobId, claimId, now) {
      const result = await database.execute(sql`
        UPDATE email_delivery_jobs
        SET status = 'sent',
            encryption_key_id = NULL,
            encrypted_payload = NULL,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = ${now}
        WHERE id = ${jobId}::uuid
          AND status = 'leased'
          AND lease_owner = ${claimId}
          AND lease_expires_at > ${now}
        RETURNING id
      `);

      return result.rows.length === 1;
    },

    async markFailed(jobId, claimId, now) {
      const result = await database.execute(sql`
        UPDATE email_delivery_jobs
        SET status = 'failed',
            encryption_key_id = NULL,
            encrypted_payload = NULL,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = ${now}
        WHERE id = ${jobId}::uuid
          AND status = 'leased'
          AND lease_owner = ${claimId}
          AND lease_expires_at > ${now}
        RETURNING id
      `);

      return result.rows.length === 1;
    },

    async scheduleRetry(jobId, claimId, now, retryAt, maxAttempts) {
      const result = await database.execute(sql`
        UPDATE email_delivery_jobs
        SET status = CASE
             WHEN attempt_count >= ${maxAttempts}
                THEN 'failed'::email_delivery_job_status
              WHEN ${retryAt} >= expires_at
                THEN 'cancelled'::email_delivery_job_status
              ELSE 'pending'::email_delivery_job_status
            END,
            available_at = CASE
              WHEN attempt_count < ${maxAttempts}
                AND ${retryAt} < expires_at THEN ${retryAt}
              ELSE available_at
            END,
            encryption_key_id = CASE
              WHEN attempt_count < ${maxAttempts}
                AND ${retryAt} < expires_at THEN encryption_key_id
              ELSE NULL
            END,
            encrypted_payload = CASE
              WHEN attempt_count < ${maxAttempts}
                AND ${retryAt} < expires_at THEN encrypted_payload
              ELSE NULL
            END,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = ${now}
        WHERE id = ${jobId}::uuid
          AND status = 'leased'
          AND lease_owner = ${claimId}
          AND lease_expires_at > ${now}
        RETURNING status
      `);

      const status = firstRow<{ status: RetryResult }>(result)?.status;
      return status ?? 'stale';
    },
  };
}
