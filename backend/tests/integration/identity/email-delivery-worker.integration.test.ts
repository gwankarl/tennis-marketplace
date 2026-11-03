import 'dotenv/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EmailQueueConfig } from '../../../src/config/email-queue-env.js';
import type { EmailWorkerConfig } from '../../../src/config/email-worker-env.js';
import { parseTestDatabaseUrl } from '../../../src/config/test-database.js';
import { users } from '../../../src/modules/identity/accounts/accounts.schema.js';
import { createEmailDeliveryRepository } from '../../../src/modules/identity/verification/delivery/email-delivery.repository.js';
import { createEmailDeliveryWorker } from '../../../src/modules/identity/verification/delivery/email-delivery-worker.service.js';
import { EMAIL_VERIFICATION_PURPOSE } from '../../../src/modules/identity/verification/delivery/email-delivery-job.schema.js';
import { encryptDeliveryPayload } from '../../../src/modules/identity/verification/delivery/encrypted-delivery-payload.js';
import type {
  EmailTransport,
  OutboundEmail,
} from '../../../src/infrastructure/email/email-transport.js';
import type { EmailWorkerDiagnostic } from '../../../src/modules/identity/verification/delivery/email-delivery-worker.service.js';
import { decryptDeliveryPayload } from '../../../src/modules/identity/verification/delivery/encrypted-delivery-payload.js';
import { renderVerificationEmail } from '../../../src/modules/identity/verification/delivery/verification-email.js';

const connectionString = parseTestDatabaseUrl(process.env);
const TEST_NOW = new Date('2026-11-02T12:00:00.000Z');

const queueConfig: EmailQueueConfig = {
  activeKey: {
    keyId: 'worker-integration-v1',
    key: Buffer.alloc(32, 9),
  },
  frontendOrigin: 'http://localhost:5173',
};

const workerConfig: EmailWorkerConfig = {
  pollIntervalMs: 1_000,
  concurrency: 1,
  leaseMs: 120_000,
  retryBaseMs: 30_000,
  retryMaxMs: 900_000,
  maxAttempts: 5,
};

let pool: Pool | undefined;
let database: NodePgDatabase | undefined;

interface JobRow {
  id: string;
  status: string;
  attempt_count: number;
  encrypted_payload: string | null;
  encryption_key_id: string | null;
  lease_owner: string | null;
  lease_expires_at: Date | null;
}

function getPool(): Pool {
  if (!pool) throw new Error('Guarded test database is unavailable.');
  return pool;
}

function getDatabase(): NodePgDatabase {
  if (!database) throw new Error('Guarded test database is unavailable.');
  return database;
}

function fakeTransport(
  send: (message: OutboundEmail) => Promise<void> = async () => undefined,
): EmailTransport {
  return { send };
}

function makeWorker(
  transport: EmailTransport,
  diagnostics: EmailWorkerDiagnostic[] = [],
) {
  return createEmailDeliveryWorker({
    repository: createEmailDeliveryRepository(getDatabase()),
    transport,
    queueConfig,
    workerConfig,
    now: () => TEST_NOW,
    onDiagnostic: (event) => diagnostics.push(event),
  });
}

async function createPendingJob(
  expiresAt = new Date(TEST_NOW.getTime() + 24 * 60 * 60 * 1000),
): Promise<{ accountId: string; jobId: string; email: string }> {
  const accountId = randomUUID();
  const jobId = randomUUID();
  const tokenId = randomUUID();
  const email = `worker-${accountId}@example.test`;
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const verificationUrl = new URL('/verify-email', queueConfig.frontendOrigin);
  verificationUrl.searchParams.set('token', token);
  const encrypted = encryptDeliveryPayload(
    {
      recipientEmail: email,
      verificationUrl: verificationUrl.toString(),
      expiresAt: expiresAt.toISOString(),
    },
    jobId,
    EMAIL_VERIFICATION_PURPOSE,
    queueConfig,
  );

  await getDatabase().insert(users).values({
    id: accountId,
    firstName: 'Worker',
    lastName: 'Test',
    email,
    passwordHash: '$integration-test$hash',
    status: 'pending_email_verification',
    emailVerifiedAt: null,
    termsAcceptedVersion: 'terms-v1',
    termsAcceptedAt: TEST_NOW,
  });

  await getPool().query(
    `INSERT INTO email_verification_tokens
       (id, account_id, email_address, token_hash, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tokenId, accountId, email, tokenHash, expiresAt, TEST_NOW],
  );

  await getPool().query(
    `INSERT INTO email_delivery_jobs
       (id, verification_token_id, purpose, status, attempt_count,
        available_at, expires_at, encryption_key_id, encrypted_payload,
        created_at, updated_at)
     VALUES ($1, $2, $3, 'pending', 0, $4, $5, $6, $7, $8, $8)`,
    [
      jobId,
      tokenId,
      EMAIL_VERIFICATION_PURPOSE,
      TEST_NOW,
      expiresAt,
      encrypted.keyId,
      encrypted.serialized,
      TEST_NOW,
    ],
  );

  return { accountId, jobId, email };
}

async function deleteAccount(accountId: string): Promise<void> {
  await getPool().query('DELETE FROM users WHERE id = $1', [accountId]);
}

async function readJob(jobId: string): Promise<JobRow> {
  const result = await getPool().query<JobRow>(
    `SELECT id, status, attempt_count, encrypted_payload,
            encryption_key_id, lease_owner, lease_expires_at
     FROM email_delivery_jobs
     WHERE id = $1`,
    [jobId],
  );

  const row = result.rows[0];
  if (!row) throw new Error('Expected the test job to exist.');
  return row;
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
      throw new Error('Unexpected PostgreSQL identity.');
    }

    await migrate(drizzle({ client: candidate }), {
      migrationsFolder: './drizzle',
    });

    pool = candidate;
    database = drizzle({ client: candidate });
  } catch {
    await candidate.end().catch(() => undefined);
    throw new Error(
      'Email worker integration preflight failed. Confirm the guarded test database and migrations; credentials are not shown.',
    );
  }
});

afterAll(async () => {
  await pool?.end();
});

describe('PostgreSQL email delivery worker', () => {
  it('sends a due job and clears its encrypted payload', async () => {
    const fixture = await createPendingJob();
    const sent: OutboundEmail[] = [];

    try {
      const diagnostics: EmailWorkerDiagnostic[] = [];
      const worker = makeWorker(
        fakeTransport(async (message) => {
          sent.push(message);
        }),
        diagnostics,
      );

      const stored = await getPool().query<{
        id: string;
        purpose: string;
        encryption_key_id: string;
        encrypted_payload: string;
        expires_at: Date;
      }>(
        `SELECT jobs.id, jobs.purpose, jobs.encryption_key_id,
          jobs.encrypted_payload, tokens.expires_at
   FROM email_delivery_jobs AS jobs
   JOIN email_verification_tokens AS tokens
     ON tokens.id = jobs.verification_token_id
   WHERE jobs.id = $1`,
        [fixture.jobId],
      );

      const row = stored.rows[0];
      if (!row) throw new Error('Expected the test job to exist.');

      const payload = decryptDeliveryPayload(
        {
          keyId: row.encryption_key_id,
          serialized: row.encrypted_payload,
        },
        row.id,
        EMAIL_VERIFICATION_PURPOSE,
        queueConfig,
      );

      const message = renderVerificationEmail(
        payload,
        queueConfig.frontendOrigin,
        fixture.email,
        row.expires_at,
      );

      expect(message.to).toBe(fixture.email);

      await expect(worker.runOnce()).resolves.toBe(1);

      expect(diagnostics).toContainEqual({
        jobId: fixture.jobId,
        status: 'sent',
        attemptCount: 1,
      });

      const job = await readJob(fixture.jobId);

      expect(sent).toHaveLength(1);
      expect(sent[0]?.to).toBe(fixture.email);
      expect(job.status).toBe('sent');
      expect(job.encrypted_payload).toBeNull();
      expect(job.encryption_key_id).toBeNull();
      expect(job.lease_owner).toBeNull();
      expect(job.lease_expires_at).toBeNull();
    } finally {
      await deleteAccount(fixture.accountId);
    }
  });

  it('lets competing workers claim distinct jobs', async () => {
    const first = await createPendingJob();
    const second = await createPendingJob();
    let sendCount = 0;
    let releaseBoth!: () => void;
    const bothSending = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });

    const transport = fakeTransport(async () => {
      sendCount += 1;
      if (sendCount === 2) releaseBoth();
      await bothSending;
    });

    try {
      const firstWorker = makeWorker(transport);
      const secondWorker = makeWorker(transport);

      await Promise.all([firstWorker.runOnce(), secondWorker.runOnce()]);

      expect(sendCount).toBe(2);
      expect((await readJob(first.jobId)).status).toBe('sent');
      expect((await readJob(second.jobId)).status).toBe('sent');
    } finally {
      await deleteAccount(first.accountId);
      await deleteAccount(second.accountId);
    }
  });

  it('recovers an expired lease and rejects the stale claim update', async () => {
    const fixture = await createPendingJob();
    const repository = createEmailDeliveryRepository(getDatabase());
    const oldClaimId = randomUUID();
    const newClaimId = randomUUID();
    const leaseUntil = new Date(TEST_NOW.getTime() + 60_000);
    const afterLease = new Date(leaseUntil.getTime() + 1);

    try {
      const first = await repository.claimNext(
        TEST_NOW,
        leaseUntil,
        oldClaimId,
        5,
      );
      expect(first.job?.id).toBe(fixture.jobId);

      const second = await repository.claimNext(
        afterLease,
        new Date(afterLease.getTime() + 60_000),
        newClaimId,
        5,
      );
      expect(second.job?.id).toBe(fixture.jobId);
      expect(second.job?.claimId).toBe(newClaimId);

      await expect(
        repository.markSent(fixture.jobId, oldClaimId, afterLease),
      ).resolves.toBe(false);

      await expect(
        repository.markSent(fixture.jobId, newClaimId, afterLease),
      ).resolves.toBe(true);

      const job = await readJob(fixture.jobId);
      expect(job.status).toBe('sent');
      expect(job.encrypted_payload).toBeNull();
    } finally {
      await deleteAccount(fixture.accountId);
    }
  });

  it('cancels expired work and clears its payload', async () => {
    const fixture = await createPendingJob(new Date(TEST_NOW.getTime() - 1));

    try {
      const worker = makeWorker(fakeTransport());

      await expect(worker.runOnce()).resolves.toBe(0);

      const job = await readJob(fixture.jobId);
      expect(job.status).toBe('cancelled');
      expect(job.encrypted_payload).toBeNull();
      expect(job.encryption_key_id).toBeNull();
    } finally {
      await deleteAccount(fixture.accountId);
    }
  });

  it('cancels work when the account has already been verified', async () => {
    const fixture = await createPendingJob();

    try {
      await getPool().query(
        `UPDATE users
         SET status = 'active', email_verified_at = $2
         WHERE id = $1`,
        [fixture.accountId, TEST_NOW],
      );

      const worker = makeWorker(fakeTransport());

      await expect(worker.runOnce()).resolves.toBe(0);

      const job = await readJob(fixture.jobId);
      expect(job.status).toBe('cancelled');
      expect(job.encrypted_payload).toBeNull();
      expect(job.encryption_key_id).toBeNull();
    } finally {
      await deleteAccount(fixture.accountId);
    }
  });
});
