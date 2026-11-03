import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EmailQueueConfig } from '../../../src/config/email-queue-env.js';
import { parseTestDatabaseUrl } from '../../../src/config/test-database.js';
import { users } from '../../../src/modules/identity/accounts/accounts.schema.js';
import { EMAIL_VERIFICATION_PURPOSE } from '../../../src/modules/identity/verification/delivery/email-delivery-job.schema.js';
import { createEmailVerificationRepository } from '../../../src/modules/identity/verification/email-verification.repository.js';
import { createEmailVerificationService } from '../../../src/modules/identity/verification/email-verification.service.js';
import { emailVerificationTokens } from '../../../src/modules/identity/verification/email-verification.schema.js';
import { decryptDeliveryPayload } from '../../../src/modules/identity/verification/delivery/encrypted-delivery-payload.js';

const connectionString = parseTestDatabaseUrl(process.env);
const TEST_NOW = new Date('2026-11-02T12:00:00.000Z');
const TEST_QUEUE_CONFIG: EmailQueueConfig = {
  activeKey: {
    keyId: 'integration-test-v1',
    key: Buffer.alloc(32, 9),
  },
  frontendOrigin: 'http://localhost:5173',
};

let pool: Pool | undefined;
let database: NodePgDatabase | undefined;

interface DeliveryRow {
  id: string;
  purpose: string;
  encryption_key_id: string;
  encrypted_payload: string;
  job_expires_at: Date | string;
  token_expires_at: Date | string;
  token_hash: string;
  email_address: string;
}

interface IssuedTestToken {
  token: string;
  jobId: string;
  expiresAt: Date;
  payload: ReturnType<typeof decryptDeliveryPayload>;
  row: DeliveryRow;
}

function getPool(): Pool {
  if (!pool) throw new Error('Guarded test database is unavailable.');
  return pool;
}

function getDatabase(): NodePgDatabase {
  if (!database) throw new Error('Guarded test database is unavailable.');
  return database;
}

function getService(
  now: () => Date = () => TEST_NOW,
  createJobId?: () => string,
) {
  return createEmailVerificationService({
    repository: createEmailVerificationRepository(getDatabase()),
    queueConfig: TEST_QUEUE_CONFIG,
    now,
    ...(createJobId ? { createJobId } : {}),
  });
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

async function withPendingAccount<T>(
  run: (accountId: string, email: string) => Promise<T>,
): Promise<T> {
  const accountId = randomUUID();
  const email = `verification-${accountId}@example.test`;

  await getDatabase().insert(users).values({
    id: accountId,
    firstName: 'Verification',
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

/**
 * Reads a newly created job from this test database and decrypts it only to
 * obtain the token required by service consumption tests.
 */
async function issueAndReadToken(
  accountId: string,
  service: ReturnType<typeof getService> = getService(),
): Promise<IssuedTestToken> {
  const priorRows = await getPool().query(
    `SELECT jobs.id
     FROM email_delivery_jobs AS jobs
     JOIN email_verification_tokens AS tokens
       ON tokens.id = jobs.verification_token_id
     WHERE tokens.account_id = $1`,
    [accountId],
  );
  const priorJobIds = priorRows.rows.map(
    (row: { id: string }) => row.id as string,
  );

  await service.issueForAccount(accountId);

  const result = await getPool().query(
    `SELECT
       jobs.id,
       jobs.purpose,
       jobs.encryption_key_id,
       jobs.encrypted_payload,
       jobs.expires_at AS job_expires_at,
       tokens.expires_at AS token_expires_at,
       tokens.token_hash,
       tokens.email_address
     FROM email_delivery_jobs AS jobs
     JOIN email_verification_tokens AS tokens
       ON tokens.id = jobs.verification_token_id
     WHERE tokens.account_id = $1
       AND NOT (jobs.id = ANY($2::uuid[]))
     ORDER BY jobs.created_at DESC, jobs.id DESC
     LIMIT 1`,
    [accountId, priorJobIds],
  );

  const row = result.rows[0] as DeliveryRow | undefined;
  if (!row) {
    throw new Error('Expected the test verification job to exist.');
  }

  const payload = decryptDeliveryPayload(
    {
      keyId: row.encryption_key_id,
      serialized: row.encrypted_payload,
    },
    row.id,
    row.purpose,
    TEST_QUEUE_CONFIG,
  );
  const token = new URL(payload.verificationUrl).searchParams.get('token');

  if (!token) {
    throw new Error('Expected a token in the decrypted test payload.');
  }

  return {
    token,
    jobId: row.id,
    expiresAt: asDate(row.token_expires_at),
    payload,
    row,
  };
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
      'Email verification integration preflight failed. Confirm the guarded test database and migrations; credentials are not shown.',
    );
  }
});

afterAll(async () => {
  await pool?.end();
});

describe('email verification and delivery-job persistence', () => {
  it('creates one token and one encrypted job with the same original expiry', async () => {
    await withPendingAccount(async (accountId, email) => {
      const issued = await issueAndReadToken(accountId);
      const tokenRows = await getPool().query(
        `SELECT token_hash, email_address, expires_at
         FROM email_verification_tokens
         WHERE account_id = $1`,
        [accountId],
      );
      const jobRows = await getPool().query(
        `SELECT status, attempt_count, expires_at, encryption_key_id,
                encrypted_payload, lease_owner, lease_expires_at
         FROM email_delivery_jobs
         WHERE id = $1`,
        [issued.jobId],
      );

      expect(tokenRows.rows).toHaveLength(1);
      expect(jobRows.rows).toHaveLength(1);
      expect(tokenRows.rows[0].email_address).toBe(email);
      expect(tokenRows.rows[0].token_hash).toBe(issued.row.token_hash);
      expect(tokenRows.rows[0].token_hash).not.toBe(issued.token);
      expect(asDate(tokenRows.rows[0].expires_at)).toEqual(issued.expiresAt);
      expect(asDate(jobRows.rows[0].expires_at)).toEqual(issued.expiresAt);
      expect(issued.payload.expiresAt).toBe(issued.expiresAt.toISOString());
      expect(jobRows.rows[0].status).toBe('pending');
      expect(jobRows.rows[0].attempt_count).toBe(0);
      expect(jobRows.rows[0].lease_owner).toBeNull();
      expect(jobRows.rows[0].lease_expires_at).toBeNull();
      expect(jobRows.rows[0].encrypted_payload).not.toContain(email);
      expect(jobRows.rows[0].encrypted_payload).not.toContain(issued.token);
      expect(jobRows.rows[0].encryption_key_id).toBe(
        TEST_QUEUE_CONFIG.activeKey.keyId,
      );
    });
  });

  it('verifies the account and cancels all outstanding jobs while clearing payloads atomically', async () => {
    await withPendingAccount(async (accountId) => {
      const first = await issueAndReadToken(accountId);
      await issueAndReadToken(accountId);

      await getService().consume(first.token);

      const accountResult = await getPool().query(
        'SELECT status, email_verified_at FROM users WHERE id = $1',
        [accountId],
      );
      const tokenResult = await getPool().query(
        `SELECT consumed_at, invalidated_at
         FROM email_verification_tokens
         WHERE account_id = $1`,
        [accountId],
      );
      const jobResult = await getPool().query(
        `SELECT status, encrypted_payload, encryption_key_id,
                lease_owner, lease_expires_at
         FROM email_delivery_jobs AS jobs
         JOIN email_verification_tokens AS tokens
           ON tokens.id = jobs.verification_token_id
         WHERE tokens.account_id = $1`,
        [accountId],
      );

      expect(accountResult.rows[0].status).toBe('active');
      expect(accountResult.rows[0].email_verified_at).toEqual(TEST_NOW);
      expect(
        tokenResult.rows.filter((row) => row.consumed_at !== null),
      ).toHaveLength(1);
      expect(
        tokenResult.rows.filter((row) => row.invalidated_at !== null),
      ).toHaveLength(1);
      expect(jobResult.rows).toHaveLength(2);
      for (const job of jobResult.rows) {
        expect(job.status).toBe('cancelled');
        expect(job.encrypted_payload).toBeNull();
        expect(job.encryption_key_id).toBeNull();
        expect(job.lease_owner).toBeNull();
        expect(job.lease_expires_at).toBeNull();
      }
    });
  });

  it('rejects expired tokens without changing account or token state', async () => {
    await withPendingAccount(async (accountId) => {
      let now = TEST_NOW;
      const service = getService(() => now);
      const issued = await issueAndReadToken(accountId, service);
      now = new Date(issued.expiresAt.getTime() + 1);

      await expect(service.consume(issued.token)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'This verification link is invalid or expired.',
      });

      const accountResult = await getPool().query(
        'SELECT status, email_verified_at FROM users WHERE id = $1',
        [accountId],
      );
      const tokenResult = await getPool().query(
        `SELECT consumed_at, invalidated_at
         FROM email_verification_tokens
         WHERE account_id = $1`,
        [accountId],
      );

      expect(accountResult.rows[0].status).toBe('pending_email_verification');
      expect(accountResult.rows[0].email_verified_at).toBeNull();
      expect(tokenResult.rows[0].consumed_at).toBeNull();
      expect(tokenResult.rows[0].invalidated_at).toBeNull();
    });
  });

  it('clears expired job payloads without extending token expiry', async () => {
    await withPendingAccount(async (accountId) => {
      const issued = await issueAndReadToken(accountId);
      const later = new Date(issued.expiresAt.getTime() + 1);
      const repository = createEmailVerificationRepository(getDatabase());

      await expect(repository.cancelExpiredJobs(later)).resolves.toBe(1);

      const rows = await getPool().query(
        `SELECT jobs.status, jobs.encrypted_payload,
                jobs.encryption_key_id, jobs.expires_at AS job_expires_at,
                tokens.expires_at AS token_expires_at
         FROM email_delivery_jobs AS jobs
         JOIN email_verification_tokens AS tokens
           ON tokens.id = jobs.verification_token_id
         WHERE tokens.account_id = $1`,
        [accountId],
      );

      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].status).toBe('cancelled');
      expect(rows.rows[0].encrypted_payload).toBeNull();
      expect(rows.rows[0].encryption_key_id).toBeNull();
      expect(asDate(rows.rows[0].job_expires_at)).toEqual(issued.expiresAt);
      expect(asDate(rows.rows[0].token_expires_at)).toEqual(issued.expiresAt);
    });
  });

  it('rejects reuse of a consumed token with the same safe error', async () => {
    await withPendingAccount(async (accountId) => {
      const issued = await issueAndReadToken(accountId);
      const service = getService();

      await service.consume(issued.token);

      await expect(service.consume(issued.token)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'This verification link is invalid or expired.',
      });
    });
  });

  it('keeps multiple tokens valid until one succeeds, then invalidates the rest', async () => {
    await withPendingAccount(async (accountId) => {
      const service = getService();
      const first = await issueAndReadToken(accountId, service);
      const second = await issueAndReadToken(accountId, service);

      const before = await getPool().query(
        `SELECT invalidated_at
         FROM email_verification_tokens
         WHERE account_id = $1`,
        [accountId],
      );
      expect(before.rows).toHaveLength(2);
      expect(before.rows.every((row) => row.invalidated_at === null)).toBe(
        true,
      );

      await service.consume(first.token);

      await expect(service.consume(second.token)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'This verification link is invalid or expired.',
      });
    });
  });

  it('allows only one concurrent submission to consume a token', async () => {
    await withPendingAccount(async (accountId) => {
      const service = getService();
      const issued = await issueAndReadToken(accountId, service);

      const results = await Promise.allSettled([
        service.consume(issued.token),
        service.consume(issued.token),
      ]);

      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === 'rejected'),
      ).toHaveLength(1);
    });
  });

  it('keeps a suspended account suspended when its email is verified', async () => {
    await withPendingAccount(async (accountId) => {
      const issued = await issueAndReadToken(accountId);

      await getPool().query(
        `UPDATE users
         SET status = 'suspended'
         WHERE id = $1`,
        [accountId],
      );

      await getService().consume(issued.token);

      const accountResult = await getPool().query(
        'SELECT status, email_verified_at FROM users WHERE id = $1',
        [accountId],
      );
      const permissionResult = await getPool().query(
        'SELECT permission FROM user_permissions WHERE user_id = $1',
        [accountId],
      );

      expect(permissionResult.rows).toEqual([]);
      expect(accountResult.rows[0].status).toBe('suspended');
      expect(accountResult.rows[0].email_verified_at).toEqual(TEST_NOW);
    });
  });

  it('rolls back token insertion when delivery-job insertion fails', async () => {
    await withPendingAccount(async (accountId) => {
      const jobId = randomUUID();
      const suffix = randomUUID().replaceAll('-', '');
      const functionName = `fail_job_insert_${suffix}`;
      const triggerName = `fail_job_insert_trigger_${suffix}`;

      try {
        await getPool().query(`
          CREATE FUNCTION public.${functionName}()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF NEW.id = '${jobId}'::uuid THEN
              RAISE EXCEPTION 'test-only job insert failure';
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

        const service = getService(
          () => TEST_NOW,
          () => jobId,
        );

        await expect(service.issueForAccount(accountId)).rejects.toThrow();

        const tokenCount = await getPool().query(
          'SELECT count(*)::int AS count FROM email_verification_tokens WHERE account_id = $1',
          [accountId],
        );
        const jobCount = await getPool().query(
          `SELECT count(*)::int AS count
           FROM email_delivery_jobs AS jobs
           JOIN email_verification_tokens AS tokens
             ON tokens.id = jobs.verification_token_id
           WHERE tokens.account_id = $1`,
          [accountId],
        );

        expect(tokenCount.rows[0].count).toBe(0);
        expect(jobCount.rows[0].count).toBe(0);
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

  it('rolls back account and job cancellation if token persistence fails', async () => {
    await withPendingAccount(async (accountId) => {
      const issued = await issueAndReadToken(accountId);
      const suffix = randomUUID().replaceAll('-', '');
      const functionName = `fail_token_update_${suffix}`;
      const triggerName = `fail_token_update_trigger_${suffix}`;

      try {
        await getPool().query(`
          CREATE FUNCTION public.${functionName}()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF NEW.account_id = '${accountId}'::uuid THEN
              RAISE EXCEPTION 'test-only verification rollback';
            END IF;
            RETURN NEW;
          END;
          $$
        `);
        await getPool().query(`
          CREATE TRIGGER ${triggerName}
          BEFORE UPDATE ON email_verification_tokens
          FOR EACH ROW
          EXECUTE FUNCTION public.${functionName}()
        `);

        await expect(getService().consume(issued.token)).rejects.toThrow();

        const accountResult = await getPool().query(
          'SELECT status, email_verified_at FROM users WHERE id = $1',
          [accountId],
        );
        const tokenResult = await getPool().query(
          `SELECT consumed_at, invalidated_at
           FROM email_verification_tokens
           WHERE account_id = $1`,
          [accountId],
        );
        const jobResult = await getPool().query(
          `SELECT status, encrypted_payload, encryption_key_id
           FROM email_delivery_jobs AS jobs
           JOIN email_verification_tokens AS tokens
             ON tokens.id = jobs.verification_token_id
           WHERE tokens.account_id = $1`,
          [accountId],
        );

        expect(accountResult.rows[0].status).toBe('pending_email_verification');
        expect(accountResult.rows[0].email_verified_at).toBeNull();
        expect(tokenResult.rows[0].consumed_at).toBeNull();
        expect(tokenResult.rows[0].invalidated_at).toBeNull();
        expect(jobResult.rows[0].status).toBe('pending');
        expect(jobResult.rows[0].encrypted_payload).not.toBeNull();
        expect(jobResult.rows[0].encryption_key_id).not.toBeNull();
      } finally {
        await getPool().query(
          `DROP TRIGGER IF EXISTS ${triggerName} ON email_verification_tokens`,
        );
        await getPool().query(
          `DROP FUNCTION IF EXISTS public.${functionName}()`,
        );
      }
    });
  });
});
