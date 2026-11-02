import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { DatabaseTransactionExecutor } from '../db/client.js';

const HOUR_MS = 60 * 60 * 1000;

export interface ResendPolicy {
  now: Date;
  cooldownMs: number;
  maxJobsPerHour: number;
}

export type QueueVerificationEmail = (
  accountId: string,
  transaction: DatabaseTransactionExecutor,
) => Promise<void>;

interface ResendAccountRow {
  id: string;
  status: string;
  email_verified_at: Date | null;
}

interface JobWindowRow {
  job_count: number | string;
  latest_job_at: Date | string | null;
}

function firstRow<T>(result: { rows: unknown[] }): T | undefined {
  return result.rows[0] as T | undefined;
}

function dateMilliseconds(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

export interface EmailVerificationResendRepository {
  queueIfAllowed(
    email: string,
    policy: ResendPolicy,
    queue: QueueVerificationEmail,
  ): Promise<boolean>;
}

/**
 * Locks the account while checking its queue history and adding a job.
 * Verification consumes tokens under the same account-row lock.
 */
export function createEmailVerificationResendRepository(
  database: NodePgDatabase,
): EmailVerificationResendRepository {
  return {
    async queueIfAllowed(email, policy, queue) {
      return database.transaction(async (transaction) => {
        const accountResult = await transaction.execute(sql`
          SELECT id, status, email_verified_at
          FROM users
          WHERE lower(btrim(email)) = ${email}
          FOR UPDATE
        `);
        const account = firstRow<ResendAccountRow>(accountResult);

        if (
          !account ||
          account.status !== 'pending_email_verification' ||
          account.email_verified_at !== null
        ) {
          return false;
        }

        const hourStart = new Date(policy.now.getTime() - HOUR_MS);
        const windowResult = await transaction.execute(sql`
          SELECT count(*)::int AS job_count,
                 max(jobs.created_at) AS latest_job_at
          FROM email_verification_tokens AS tokens
          JOIN email_delivery_jobs AS jobs
            ON jobs.verification_token_id = tokens.id
          WHERE tokens.account_id = ${account.id}::uuid
            AND jobs.purpose = 'email_verification'
            AND jobs.created_at > ${hourStart}
        `);
        const window = firstRow<JobWindowRow>(windowResult);

        if (!window) {
          throw new Error(
            'Verification email job window query returned no row.',
          );
        }

        const count = Number(window.job_count);
        const latestJobAt = window.latest_job_at
          ? dateMilliseconds(window.latest_job_at)
          : undefined;
        const cooldownStart = policy.now.getTime() - policy.cooldownMs;

        // Count jobs, not SMTP attempts. Terminal jobs remain part of the
        // rolling-hour limit; retries update a job rather than inserting one.
        if (
          count >= policy.maxJobsPerHour ||
          (latestJobAt !== undefined && latestJobAt > cooldownStart)
        ) {
          return false;
        }

        await queue(account.id, transaction);
        return true;
      });
    },
  };
}
