import 'dotenv/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EmailQueueConfig } from '../../../src/config/email-queue-env.js';
import { parseTestDatabaseUrl } from '../../../src/config/test-database.js';
import {
  users,
  userPermissions,
} from '../../../src/modules/identity/accounts/accounts.schema.js';
import { createPasswordResetRepository } from '../../../src/modules/identity/passwords/password-reset.repository.js';
import { createPasswordResetRequestRepository } from '../../../src/modules/identity/passwords/password-reset-request.repository.js';
import { createPasswordResetRequestService } from '../../../src/modules/identity/passwords/password-reset-request.service.js';
import { createPasswordResetService } from '../../../src/modules/identity/passwords/password-reset.service.js';
import type {
  LockedAccountOperation,
  UserSessionRepository,
} from '../../../src/modules/identity/sessions/user-session.repository.js';
import { createUserSessionRepository } from '../../../src/modules/identity/sessions/user-session.repository.js';
import {
  encryptDeliveryPayload,
  decryptDeliveryPayload,
} from '../../../src/modules/identity/verification/delivery/encrypted-delivery-payload.js';

const connectionString = parseTestDatabaseUrl(process.env);
const NOW = new Date('2026-11-02T12:00:00.000Z');
const TEST_PASSWORD = '  integration replacement password  ';
const ACKNOWLEDGEMENT = {
  data: {
    message:
      'If an account is eligible for a password reset, instructions may be sent.',
  },
} as const;

const queueConfig: EmailQueueConfig = {
  activeKey: {
    keyId: 'password-reset-integration-v1',
    key: Buffer.alloc(32, 17),
  },
  frontendOrigin: 'http://localhost:5173',
};

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

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

async function withAccount<T>(
  run: (accountId: string, email: string) => Promise<T>,
  options: {
    status?: 'active' | 'suspended' | 'pending_email_verification';
    verified?: boolean;
  } = {},
): Promise<T> {
  const accountId = randomUUID();
  const email = `password-reset-${accountId}@example.test`;
  const status = options.status ?? 'active';
  const verified = options.verified ?? status !== 'pending_email_verification';

  await getDatabase()
    .insert(users)
    .values({
      id: accountId,
      firstName: 'Reset',
      lastName: 'Test',
      email,
      passwordHash: 'old-password-hash',
      status,
      emailVerifiedAt: verified ? NOW : null,
      termsAcceptedVersion: 'terms-test',
      termsAcceptedAt: NOW,
    });

  try {
    return await run(accountId, email);
  } finally {
    await getPool().query('DELETE FROM users WHERE id = $1', [accountId]);
  }
}

function makeRequestService(now: () => Date, createJobId?: () => string) {
  return createPasswordResetRequestService({
    repository: createPasswordResetRequestRepository(getDatabase()),
    queueConfig,
    cooldownMs: 60_000,
    maxJobsPerHour: 5,
    now,
    ...(createJobId ? { createJobId } : {}),
  });
}

function makeResetService(
  now: () => Date = () => NOW,
  sessions: Pick<
    UserSessionRepository,
    'withLockedAccount' | 'revokeAllSessions'
  > = createUserSessionRepository(getDatabase()),
) {
  return createPasswordResetService({
    repository: createPasswordResetRepository(getDatabase()),
    sessions,
    passwords: {
      screenPassword: async () => 'clear',
      hashPassword: async () => 'new-password-hash',
    },
    now,
  });
}

async function seedResetToken(
  accountId: string,
  email: string,
  options: {
    createdAt?: Date;
    expiresAt?: Date;
    status?: 'pending' | 'leased';
  } = {},
): Promise<{ token: string; jobId: string; tokenHash: string }> {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = sha256(token);
  const jobId = randomUUID();
  const createdAt = options.createdAt ?? NOW;
  const expiresAt =
    options.expiresAt ?? new Date(NOW.getTime() + 30 * 60 * 1000);
  const status = options.status ?? 'pending';
  const resetUrl = new URL('/reset-password', queueConfig.frontendOrigin);
  resetUrl.searchParams.set('token', token);
  const encrypted = encryptDeliveryPayload(
    {
      recipientEmail: email,
      passwordResetUrl: resetUrl.toString(),
      expiresAt: expiresAt.toISOString(),
    },
    jobId,
    'password_reset',
    queueConfig,
  );

  const tokenResult = await getPool().query<{ id: string }>(
    `INSERT INTO password_reset_tokens
       (account_id, email_address, token_hash, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [accountId, email, tokenHash, expiresAt, createdAt],
  );
  const tokenId = tokenResult.rows[0]!.id;
  const leased = status === 'leased';

  await getPool().query(
    `INSERT INTO email_delivery_jobs (
       id, verification_token_id, password_reset_token_id, purpose, status,
       attempt_count, available_at, expires_at, lease_owner, lease_expires_at,
       encryption_key_id, encrypted_payload, created_at, updated_at
     )
     VALUES (
       $1, NULL, $2, 'password_reset', $3, $4, $5, $6, $7, $8, $9, $10, $5, $5
     )`,
    [
      jobId,
      tokenId,
      status,
      leased ? 1 : 0,
      createdAt,
      expiresAt,
      leased ? 'integration-worker' : null,
      leased ? new Date(NOW.getTime() + 60_000) : null,
      encrypted.keyId,
      encrypted.serialized,
    ],
  );

  return { token, jobId, tokenHash };
}

async function countResetRows(
  accountId: string,
): Promise<{ tokens: number; jobs: number }> {
  const result = await getPool().query<{
    token_count: number;
    job_count: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM password_reset_tokens WHERE account_id = $1)
         AS token_count,
       (SELECT count(*)::int
          FROM email_delivery_jobs AS jobs
          JOIN password_reset_tokens AS tokens
            ON tokens.id = jobs.password_reset_token_id
         WHERE tokens.account_id = $1)
         AS job_count`,
    [accountId],
  );

  return {
    tokens: result.rows[0]!.token_count,
    jobs: result.rows[0]!.job_count,
  };
}

async function seedSession(accountId: string): Promise<void> {
  const sessions = createUserSessionRepository(getDatabase());
  const credential = randomBytes(32).toString('base64url');

  await sessions.withLockedAccount(accountId, async (_account, transaction) => {
    await sessions.createSession(transaction, {
      userId: accountId,
      credentialHash: sha256(credential),
      now: NOW,
      absoluteExpiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    });
  });
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
      'Password reset integration preflight failed. Confirm the guarded test database and migrations; credentials are not shown.',
    );
  }
});

afterAll(async () => {
  await pool?.end();
});

describe('PostgreSQL password reset', () => {
  it('queues a hashed token and encrypted job, and gives unknown addresses the same acknowledgement', async () => {
    await withAccount(async (accountId, email) => {
      const service = makeRequestService(() => NOW);

      const result = await service.requestReset({
        email: email.toUpperCase(),
      });
      const unknown = await service.requestReset({
        email: 'unknown-password-reset@example.test',
      });

      expect(result).toEqual(ACKNOWLEDGEMENT);
      expect(unknown).toEqual(result);

      const rows = await getPool().query<{
        token_hash: string;
        email_address: string;
        token_expires_at: Date | string;
        job_id: string;
        purpose: string;
        status: string;
        encrypted_payload: string;
        encryption_key_id: string;
        job_expires_at: Date | string;
      }>(
        `SELECT tokens.token_hash, tokens.email_address,
                tokens.expires_at AS token_expires_at,
                jobs.id AS job_id, jobs.purpose, jobs.status,
                jobs.encrypted_payload, jobs.encryption_key_id,
                jobs.expires_at AS job_expires_at
         FROM password_reset_tokens AS tokens
         JOIN email_delivery_jobs AS jobs
           ON jobs.password_reset_token_id = tokens.id
         WHERE tokens.account_id = $1`,
        [accountId],
      );

      expect(rows.rows).toHaveLength(1);
      const row = rows.rows[0]!;
      expect(row.email_address).toBe(email);
      expect(row.purpose).toBe('password_reset');
      expect(row.status).toBe('pending');
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.encryption_key_id).toBe(queueConfig.activeKey.keyId);
      expect(asDate(row.token_expires_at)).toEqual(
        new Date(NOW.getTime() + 30 * 60 * 1000),
      );
      expect(asDate(row.job_expires_at)).toEqual(asDate(row.token_expires_at));

      const payload = decryptDeliveryPayload(
        {
          keyId: row.encryption_key_id,
          serialized: row.encrypted_payload,
        },
        row.job_id,
        'password_reset',
        queueConfig,
      );
      const resetUrl = new URL(payload.passwordResetUrl);
      const rawToken = resetUrl.searchParams.get('token');

      expect(resetUrl.origin).toBe(queueConfig.frontendOrigin);
      expect(resetUrl.pathname).toBe('/reset-password');
      expect(payload.recipientEmail).toBe(email);
      expect(rawToken).toBeTruthy();
      expect(row.token_hash).toBe(sha256(rawToken!));
      expect(row.encrypted_payload).not.toContain(rawToken!);
    });
  });

  it('enforces cooldown and the rolling-hour account limit, including the exact hour boundary', async () => {
    await withAccount(async (accountId, email) => {
      let clock = new Date(NOW);
      const service = makeRequestService(() => new Date(clock));

      await service.requestReset({ email });
      clock = new Date(NOW.getTime() + 59_999);
      expect(await service.requestReset({ email })).toEqual(ACKNOWLEDGEMENT);
      expect(await countResetRows(accountId)).toEqual({ tokens: 1, jobs: 1 });

      clock = new Date(NOW.getTime() + 60_000);
      await service.requestReset({ email });

      for (let count = 3; count <= 5; count += 1) {
        clock = new Date(clock.getTime() + 60_000);
        await service.requestReset({ email });
      }

      clock = new Date(clock.getTime() + 60_000);
      await service.requestReset({ email });
      expect(await countResetRows(accountId)).toEqual({ tokens: 5, jobs: 5 });

      // At this point the oldest job is outside the strict rolling-hour window.
      clock = new Date(NOW.getTime() + 64 * 60 * 1000);
      await service.requestReset({ email });
      expect(await countResetRows(accountId)).toEqual({ tokens: 6, jobs: 6 });
    });
  });

  it('serializes concurrent account requests so the cooldown cannot be bypassed', async () => {
    await withAccount(async (accountId, email) => {
      const service = makeRequestService(() => NOW);

      await Promise.all(
        Array.from({ length: 5 }, () => service.requestReset({ email })),
      );

      expect(await countResetRows(accountId)).toEqual({ tokens: 1, jobs: 1 });
    });
  });

  it('rolls back a token if job insertion fails', async () => {
    await withAccount(async (accountId, email) => {
      const duplicateJobId = randomUUID();
      let clock = new Date(NOW);
      const service = makeRequestService(
        () => new Date(clock),
        () => duplicateJobId,
      );

      await service.requestReset({ email });
      clock = new Date(NOW.getTime() + 60_000);

      await expect(service.requestReset({ email })).rejects.toBeDefined();
      expect(await countResetRows(accountId)).toEqual({ tokens: 1, jobs: 1 });
    });
  });

  it('updates the password, invalidates other tokens, cancels reset jobs, preserves account state, and revokes sessions', async () => {
    await withAccount(async (accountId, email) => {
      await getDatabase().insert(userPermissions).values({
        userId: accountId,
        permission: 'seller',
        grantedAt: NOW,
      });
      await seedSession(accountId);

      const first = await seedResetToken(accountId, email);
      await seedResetToken(accountId, email, { status: 'leased' });

      await makeResetService().reset({
        token: first.token,
        password: TEST_PASSWORD,
      });

      const account = await getPool().query(
        `SELECT password_hash, status, email_verified_at
         FROM users WHERE id = $1`,
        [accountId],
      );
      expect(account.rows[0]).toMatchObject({
        password_hash: 'new-password-hash',
        status: 'active',
        email_verified_at: NOW,
      });

      const permissions = await getPool().query(
        'SELECT permission FROM user_permissions WHERE user_id = $1',
        [accountId],
      );
      expect(permissions.rows.map((row) => row.permission)).toEqual(['seller']);

      const tokens = await getPool().query(
        `SELECT token_hash, consumed_at, invalidated_at
         FROM password_reset_tokens
         WHERE account_id = $1
         ORDER BY token_hash`,
        [accountId],
      );
      expect(tokens.rows).toHaveLength(2);
      expect(
        tokens.rows.filter((row) => row.consumed_at !== null),
      ).toHaveLength(1);
      expect(
        tokens.rows.filter((row) => row.invalidated_at !== null),
      ).toHaveLength(1);

      const jobs = await getPool().query(
        `SELECT status, encrypted_payload, encryption_key_id,
                lease_owner, lease_expires_at
         FROM email_delivery_jobs AS jobs
         JOIN password_reset_tokens AS tokens
           ON tokens.id = jobs.password_reset_token_id
         WHERE tokens.account_id = $1`,
        [accountId],
      );
      expect(jobs.rows).toHaveLength(2);
      for (const job of jobs.rows) {
        expect(job).toMatchObject({
          status: 'cancelled',
          encrypted_payload: null,
          encryption_key_id: null,
          lease_owner: null,
          lease_expires_at: null,
        });
      }

      const sessions = await getPool().query(
        'SELECT revoked_at FROM user_sessions WHERE user_id = $1',
        [accountId],
      );
      expect(sessions.rows).toHaveLength(1);
      expect(sessions.rows[0].revoked_at).not.toBeNull();
    });
  });

  it('allows only one concurrent reset to consume a token', async () => {
    await withAccount(async (accountId, email) => {
      const issued = await seedResetToken(accountId, email);
      const service = makeResetService();

      const outcomes = await Promise.allSettled([
        service.reset({ token: issued.token, password: TEST_PASSWORD }),
        service.reset({ token: issued.token, password: TEST_PASSWORD }),
      ]);

      expect(
        outcomes.filter((outcome) => outcome.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        outcomes.filter((outcome) => outcome.status === 'rejected'),
      ).toHaveLength(1);

      const account = await getPool().query(
        'SELECT password_hash FROM users WHERE id = $1',
        [accountId],
      );
      expect(account.rows[0].password_hash).toBe('new-password-hash');
    });
  });

  it('rejects expired tokens and ineligible accounts without changing credentials', async () => {
    await withAccount(async (accountId, email) => {
      const expired = await seedResetToken(accountId, email, {
        expiresAt: new Date(NOW.getTime() - 1),
      });

      await expect(
        makeResetService().reset({
          token: expired.token,
          password: TEST_PASSWORD,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const account = await getPool().query(
        'SELECT password_hash FROM users WHERE id = $1',
        [accountId],
      );
      expect(account.rows[0].password_hash).toBe('old-password-hash');
    });

    await withAccount(
      async (accountId, email) => {
        const token = await seedResetToken(accountId, email);

        await expect(
          makeResetService().reset({
            token: token.token,
            password: TEST_PASSWORD,
          }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });

        const account = await getPool().query(
          'SELECT password_hash, status FROM users WHERE id = $1',
          [accountId],
        );
        expect(account.rows[0]).toMatchObject({
          password_hash: 'old-password-hash',
          status: 'suspended',
        });
      },
      { status: 'suspended' },
    );
  });

  it('rolls back password, token, job, and session changes if revocation fails', async () => {
    await withAccount(async (accountId, email) => {
      await seedSession(accountId);
      const issued = await seedResetToken(accountId, email);
      const actualSessions = createUserSessionRepository(getDatabase());

      const failingSessions: Pick<
        UserSessionRepository,
        'withLockedAccount' | 'revokeAllSessions'
      > = {
        async withLockedAccount<T>(
          userId: string,
          operation: LockedAccountOperation<T>,
        ) {
          return actualSessions.withLockedAccount(userId, operation);
        },
        async revokeAllSessions() {
          throw new Error('test-only rollback trigger');
        },
      };

      await expect(
        makeResetService(() => NOW, failingSessions).reset({
          token: issued.token,
          password: TEST_PASSWORD,
        }),
      ).rejects.toThrow('test-only rollback trigger');

      const account = await getPool().query(
        'SELECT password_hash FROM users WHERE id = $1',
        [accountId],
      );
      expect(account.rows[0].password_hash).toBe('old-password-hash');

      const token = await getPool().query(
        `SELECT consumed_at, invalidated_at
         FROM password_reset_tokens WHERE token_hash = $1`,
        [issued.tokenHash],
      );
      expect(token.rows[0]).toEqual({
        consumed_at: null,
        invalidated_at: null,
      });

      const job = await getPool().query(
        `SELECT status, encrypted_payload, encryption_key_id
         FROM email_delivery_jobs WHERE id = $1`,
        [issued.jobId],
      );
      expect(job.rows[0].status).toBe('pending');
      expect(job.rows[0].encrypted_payload).not.toBeNull();
      expect(job.rows[0].encryption_key_id).not.toBeNull();

      const sessions = await getPool().query(
        'SELECT revoked_at FROM user_sessions WHERE user_id = $1',
        [accountId],
      );
      expect(sessions.rows[0].revoked_at).toBeNull();
    });
  });
});
