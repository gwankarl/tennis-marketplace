import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EmailQueueConfig } from '../../../src/config/email-queue-env.js';
import { parseTestDatabaseUrl } from '../../../src/config/test-database.js';
import { users } from '../../../src/modules/identity/accounts/accounts.schema.js';
import { createEmailVerificationResendRepository } from '../../../src/modules/identity/verification/email-verification-resend.repository.js';
import { createEmailVerificationRepository } from '../../../src/modules/identity/verification/email-verification.repository.js';
import { createEmailVerificationService } from '../../../src/modules/identity/verification/email-verification.service.js';
import { createResendVerificationService } from '../../../src/modules/identity/verification/resend-verification.service.js';
import { EMAIL_VERIFICATION_PURPOSE } from '../../../src/modules/identity/verification/delivery/email-delivery-job.schema.js';
import { decryptDeliveryPayload } from '../../../src/modules/identity/verification/delivery/encrypted-delivery-payload.js';

const connectionString = parseTestDatabaseUrl(process.env);
const TEST_NOW = new Date('2026-11-02T12:00:00.000Z');
const TEST_QUEUE_CONFIG: EmailQueueConfig = {
  activeKey: {
    keyId: 'resend-integration-v1',
    key: Buffer.alloc(32, 7),
  },
  frontendOrigin: 'http://localhost:5173',
};
const ACKNOWLEDGEMENT = {
  data: {
    message: 'If an account needs verification, instructions may be sent.',
  },
} as const;

let pool: Pool | undefined;
let database: NodePgDatabase | undefined;

function getPool(): Pool {
  if (!pool) throw new Error('Guarded test database is unavailable.');
  return pool;
}

function getDatabase(): NodePgDatabase {
  if (!database) throw new Error('Guarded test database is unavailable.');
  return database;
}

function makeServices(now: () => Date, createJobId?: () => string) {
  const verification = createEmailVerificationService({
    repository: createEmailVerificationRepository(getDatabase()),
    queueConfig: TEST_QUEUE_CONFIG,
    now,
    ...(createJobId ? { createJobId } : {}),
  });

  const resend = createResendVerificationService({
    repository: createEmailVerificationResendRepository(getDatabase()),
    verification,
    cooldownMs: 60_000,
    maxJobsPerHour: 5,
    now,
  });

  return { verification, resend };
}

async function withPendingAccount<T>(
  run: (accountId: string, email: string) => Promise<T>,
): Promise<T> {
  const accountId = randomUUID();
  const email = `resend-${accountId}@example.test`;

  await getDatabase().insert(users).values({
    id: accountId,
    firstName: 'Resend',
    lastName: 'Test',
    email,
    passwordHash: '$test-only$hash',
    status: 'pending_email_verification',
    emailVerifiedAt: null,
    termsAcceptedVersion: 'terms-v1',
    termsAcceptedAt: TEST_NOW,
  });

  try {
    return await run(accountId, email);
  } finally {
    await getPool().query('DELETE FROM users WHERE id = $1', [accountId]);
  }
}

async function countJobs(accountId: string): Promise<number> {
  const result = await getPool().query(
    `SELECT count(*)::int AS count
     FROM email_verification_tokens AS tokens
     JOIN email_delivery_jobs AS jobs
       ON jobs.verification_token_id = tokens.id
     WHERE tokens.account_id = $1`,
    [accountId],
  );

  return result.rows[0].count as number;
}

/** Decrypts only test-created data to obtain a token for the consume call. */
async function readOldestToken(accountId: string): Promise<string> {
  const result = await getPool().query(
    `SELECT jobs.id, jobs.purpose, jobs.encryption_key_id,
            jobs.encrypted_payload
     FROM email_verification_tokens AS tokens
     JOIN email_delivery_jobs AS jobs
       ON jobs.verification_token_id = tokens.id
     WHERE tokens.account_id = $1
     ORDER BY jobs.created_at ASC, jobs.id ASC
     LIMIT 1`,
    [accountId],
  );

  const row = result.rows[0] as
    | {
        id: string;
        purpose: string;
        encryption_key_id: string;
        encrypted_payload: string;
      }
    | undefined;

  if (!row) throw new Error('Expected a test verification job.');

  const payload = decryptDeliveryPayload(
    {
      keyId: row.encryption_key_id,
      serialized: row.encrypted_payload,
    },
    row.id,
    EMAIL_VERIFICATION_PURPOSE,
    TEST_QUEUE_CONFIG,
  );
  const token = new URL(payload.verificationUrl).searchParams.get('token');

  if (!token) throw new Error('Expected a test token.');
  return token;
}

beforeAll(async () => {
  const candidate = new Pool({ connectionString, max: 4 });

  try {
    const identity = await candidate.query<{
      database_name: string;
      user_name: string;
    }>('SELECT current_database() AS database_name, current_user AS user_name');

    if (
      identity.rows[0]?.database_name !== 'tennis_xpress_test' ||
      identity.rows[0]?.user_name !== 'tennis_xpress_test'
    ) {
      throw new Error('Unexpected integration database identity.');
    }

    await migrate(drizzle({ client: candidate }), {
      migrationsFolder: './drizzle',
    });

    pool = candidate;
    database = drizzle({ client: candidate });
  } catch {
    await candidate.end().catch(() => undefined);
    throw new Error(
      'Resend integration preflight failed. Confirm the guarded test database; credentials are not shown.',
    );
  }
});

afterAll(async () => {
  await pool?.end();
});

describe('verification email resend persistence', () => {
  it('counts the initial job, enforces cooldown, and stops at five jobs in the hour', async () => {
    await withPendingAccount(async (accountId, email) => {
      let clock = new Date(TEST_NOW);
      const now = () => new Date(clock);
      const { verification, resend } = makeServices(now);

      await verification.issueForAccount(accountId);
      expect(await countJobs(accountId)).toBe(1);

      clock = new Date(TEST_NOW.getTime() + 59_999);
      expect(await resend.resend({ email })).toEqual(ACKNOWLEDGEMENT);
      expect(await countJobs(accountId)).toBe(1);

      // The exact 60-second boundary is eligible.
      clock = new Date(TEST_NOW.getTime() + 60_000);
      await resend.resend({ email });
      expect(await countJobs(accountId)).toBe(2);

      for (let jobNumber = 3; jobNumber <= 5; jobNumber += 1) {
        clock = new Date(clock.getTime() + 60_000);
        await resend.resend({ email });
        expect(await countJobs(accountId)).toBe(jobNumber);
      }

      clock = new Date(clock.getTime() + 60_000);
      await resend.resend({ email });
      expect(await countJobs(accountId)).toBe(5);
    });
  });

  it('excludes a job exactly one hour old from the rolling-hour count', async () => {
    await withPendingAccount(async (accountId, email) => {
      let clock = new Date(TEST_NOW.getTime() - 60 * 60 * 1000);
      const now = () => new Date(clock);
      const { verification, resend } = makeServices(now);

      await verification.issueForAccount(accountId);
      clock = new Date(TEST_NOW);

      await resend.resend({ email });

      expect(await countJobs(accountId)).toBe(2);
    });
  });

  it('serializes concurrent resend requests so only one job is added', async () => {
    await withPendingAccount(async (accountId, email) => {
      const now = () => new Date(TEST_NOW);
      const { resend } = makeServices(now);

      const results = await Promise.all([
        resend.resend({ email }),
        resend.resend({ email }),
      ]);

      expect(results[0]).toEqual(ACKNOWLEDGEMENT);
      expect(results[1]).toEqual(ACKNOWLEDGEMENT);
      expect(await countJobs(accountId)).toBe(1);
    });
  });

  it('keeps an older unexpired token usable after a resend', async () => {
    await withPendingAccount(async (accountId, email) => {
      let clock = new Date(TEST_NOW);
      const now = () => new Date(clock);
      const { verification, resend } = makeServices(now);

      await verification.issueForAccount(accountId);
      const oldToken = await readOldestToken(accountId);

      clock = new Date(TEST_NOW.getTime() + 60_000);
      await resend.resend({ email });
      expect(await countJobs(accountId)).toBe(2);

      await expect(verification.consume(oldToken)).resolves.toBeUndefined();

      const account = await getPool().query(
        'SELECT status, email_verified_at FROM users WHERE id = $1',
        [accountId],
      );
      const jobs = await getPool().query(
        `SELECT jobs.status, jobs.encrypted_payload
         FROM email_verification_tokens AS tokens
         JOIN email_delivery_jobs AS jobs
           ON jobs.verification_token_id = tokens.id
         WHERE tokens.account_id = $1`,
        [accountId],
      );

      expect(account.rows[0].email_verified_at).not.toBeNull();
      expect(jobs.rows).toHaveLength(2);
      expect(jobs.rows.every((job) => job.status === 'cancelled')).toBe(true);
      expect(jobs.rows.every((job) => job.encrypted_payload === null)).toBe(
        true,
      );
    });
  });

  it('coordinates a resend racing verification through the account lock', async () => {
    await withPendingAccount(async (accountId, email) => {
      let clock = new Date(TEST_NOW);
      const now = () => new Date(clock);
      const { verification, resend } = makeServices(now);

      await verification.issueForAccount(accountId);
      const token = await readOldestToken(accountId);
      clock = new Date(TEST_NOW.getTime() + 60_000);

      await Promise.all([
        resend.resend({ email }),
        verification.consume(token),
      ]);

      const account = await getPool().query(
        'SELECT email_verified_at FROM users WHERE id = $1',
        [accountId],
      );
      const jobs = await getPool().query(
        `SELECT jobs.status, jobs.encrypted_payload
         FROM email_verification_tokens AS tokens
         JOIN email_delivery_jobs AS jobs
           ON jobs.verification_token_id = tokens.id
         WHERE tokens.account_id = $1`,
        [accountId],
      );

      expect(account.rows[0].email_verified_at).not.toBeNull();
      expect(jobs.rows.length).toBeGreaterThanOrEqual(1);
      expect(jobs.rows.every((job) => job.status === 'cancelled')).toBe(true);
      expect(jobs.rows.every((job) => job.encrypted_payload === null)).toBe(
        true,
      );
    });
  });

  it('suppresses unknown and ineligible addresses with the same acknowledgement', async () => {
    await withPendingAccount(async (accountId, email) => {
      const { resend } = makeServices(() => new Date(TEST_NOW));

      await getPool().query(
        `UPDATE users
         SET status = 'active', email_verified_at = $2
         WHERE id = $1`,
        [accountId, TEST_NOW],
      );

      const unknown = await resend.resend({
        email: 'unknown-address@example.test',
      });
      const verified = await resend.resend({ email });

      expect(unknown).toEqual(ACKNOWLEDGEMENT);
      expect(verified).toEqual(unknown);
      expect(await countJobs(accountId)).toBe(0);
    });
  });

  it('rolls back token creation when delivery-job insertion fails', async () => {
    await withPendingAccount(async (accountId, email) => {
      const jobId = randomUUID();
      const suffix = randomUUID().replaceAll('-', '');
      const functionName = `fail_resend_job_${suffix}`;
      const triggerName = `fail_resend_job_trigger_${suffix}`;
      const { resend } = makeServices(
        () => new Date(TEST_NOW),
        () => jobId,
      );

      try {
        await getPool().query(`
          CREATE FUNCTION public.${functionName}()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF NEW.id = '${jobId}'::uuid THEN
              RAISE EXCEPTION 'test-only resend job failure';
            END IF;
            RETURN NEW;
          END;
          $$
        `);
        await getPool().query(`
          CREATE TRIGGER ${triggerName}
          BEFORE INSERT ON email_delivery_jobs
          FOR EACH ROW
          EXECUTE FUNCTION public.${functionName}()
        `);

        await expect(resend.resend({ email })).rejects.toThrow();

        const tokenCount = await getPool().query(
          `SELECT count(*)::int AS count
           FROM email_verification_tokens
           WHERE account_id = $1`,
          [accountId],
        );

        expect(tokenCount.rows[0].count).toBe(0);
        expect(await countJobs(accountId)).toBe(0);
      } finally {
        await getPool().query(
          `DROP TRIGGER IF EXISTS ${triggerName} ON email_delivery_jobs`,
        );
        await getPool().query(
          `DROP FUNCTION IF EXISTS public.${functionName}()`,
        );
      }
    });
  });
});
