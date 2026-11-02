import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseTestDatabaseUrl } from '../../src/config/test-database.js';
import { ApplicationError } from '../../src/http/application-error.js';
import { users, userPermissions } from '../../src/db/accounts.schema.js';
import {
  createAccountRepository,
  type AccountRepository,
} from '../../src/identity/account.repository.js';
import { createEmailDeliveryRepository } from '../../src/identity/email-delivery.repository.js';
import {
  createEmailDeliveryWorker,
  type EmailWorkerDiagnostic,
} from '../../src/identity/email-delivery-worker.service.js';
import { createEmailVerificationRepository } from '../../src/identity/email-verification.repository.js';
import { createEmailVerificationService } from '../../src/identity/email-verification.service.js';
import { createRegistrationService } from '../../src/identity/registration.service.js';
import {
  registrationRequestSchema,
  type RegistrationRequest,
} from '../../src/identity/registration.schema.js';
import {
  hashPassword as hashPasswordWithArgon2id,
  verifyPassword,
  type PasswordService,
} from '../../src/identity/password.service.js';
import {
  EmailTransportError,
  type EmailTransport,
  type OutboundEmail,
} from '../../src/infrastructure/email/email-transport.js';

const connectionString = parseTestDatabaseUrl(process.env);
const TERMS_VERSION_FOR_TESTS = 'terms-v1';
const ACCEPTED_AT_FOR_TESTS = new Date('2026-01-15T12:00:00.000Z');
const TEST_QUEUE_CONFIG = {
  activeKey: {
    keyId: 'integration-test-key',
    key: Buffer.alloc(32, 7),
  },
  frontendOrigin: 'http://localhost:5173',
};
const TEST_WORKER_CONFIG = {
  pollIntervalMs: 1_000,
  concurrency: 1,
  leaseMs: 120_000,
  retryBaseMs: 30_000,
  retryMaxMs: 900_000,
  maxAttempts: 5 as const,
};

let pool: Pool | undefined;
let database: NodePgDatabase | undefined;
let accounts: AccountRepository | undefined;

function getPool(): Pool {
  if (!pool) {
    throw new Error('The guarded integration database is unavailable.');
  }

  return pool;
}

function getDatabase(): NodePgDatabase {
  if (!database) {
    throw new Error('The guarded integration database is unavailable.');
  }

  return database;
}

function getAccounts(): AccountRepository {
  if (!accounts) {
    throw new Error('The guarded integration database is unavailable.');
  }

  return accounts;
}

function makeInput(
  email: string,
  overrides: Partial<RegistrationRequest> = {},
) {
  return registrationRequestSchema.parse({
    firstName: 'Test',
    lastName: 'Registration',
    email,
    password: '  Correct Horse Battery Staple  ',
    termsAccepted: true,
    ...overrides,
  });
}

function makeService(
  screening: PasswordService['screenPassword'] = async () => 'clear',
  hashing: PasswordService['hashPassword'] = hashPasswordWithArgon2id,
  jobId?: string,
) {
  const now = () => new Date(ACCEPTED_AT_FOR_TESTS);
  const verification = createEmailVerificationService({
    repository: createEmailVerificationRepository(getDatabase()),
    queueConfig: TEST_QUEUE_CONFIG,
    now,
    ...(jobId ? { createJobId: () => jobId } : {}),
  });

  return createRegistrationService({
    accounts: getAccounts(),
    passwords: {
      screenPassword: screening,
      hashPassword: hashing,
    },
    verification,
    termsVersion: TERMS_VERSION_FOR_TESTS,
    now,
  });
}

async function withTestEmail<T>(
  email: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } finally {
    await getPool().query(
      'DELETE FROM users WHERE lower(btrim(email)) = lower(btrim($1))',
      [email],
    );
  }
}

async function findAccounts(email: string) {
  return getDatabase().select().from(users).where(eq(users.email, email));
}

async function findQueueCounts(email: string) {
  const result = await getPool().query<{
    token_count: number;
    job_count: number;
  }>(
    `SELECT count(DISTINCT tokens.id)::int AS token_count,
            count(DISTINCT jobs.id)::int AS job_count
     FROM users
     LEFT JOIN email_verification_tokens AS tokens
       ON tokens.account_id = users.id
     LEFT JOIN email_delivery_jobs AS jobs
       ON jobs.verification_token_id = tokens.id
     WHERE users.email = $1`,
    [email],
  );

  return result.rows[0] ?? { token_count: 0, job_count: 0 };
}

async function findJobState(email: string) {
  const result = await getPool().query<{
    status: string;
    attempt_count: number;
    payload_present: boolean;
  }>(
    `SELECT jobs.status,
            jobs.attempt_count,
            jobs.encrypted_payload IS NOT NULL AS payload_present
     FROM users
     JOIN email_verification_tokens AS tokens
       ON tokens.account_id = users.id
     JOIN email_delivery_jobs AS jobs
       ON jobs.verification_token_id = tokens.id
     WHERE users.email = $1`,
    [email],
  );

  return result.rows[0];
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
    accounts = createAccountRepository(database);
  } catch {
    await candidate.end().catch(() => undefined);
    throw new Error(
      'Registration integration preflight failed. Confirm the dedicated test database and migration files; no credentials are shown.',
    );
  }
});

afterAll(async () => {
  await pool?.end();
});

describe('registration service and repository', () => {
  it('creates an unverified account, token and job with safe defaults', async () => {
    const email = `registration-${randomUUID()}@example.test`;

    await withTestEmail(email, async () => {
      const input = makeInput(email);
      const result = await makeService().register(input);
      const [account] = await findAccounts(email);

      expect(result).toEqual({
        data: { message: 'Registration request received.' },
      });
      expect(account).toBeDefined();
      expect(account?.status).toBe('pending_email_verification');
      expect(account?.emailVerifiedAt).toBeNull();
      expect(account?.termsAcceptedVersion).toBe(TERMS_VERSION_FOR_TESTS);
      expect(account?.termsAcceptedAt).toEqual(ACCEPTED_AT_FOR_TESTS);
      expect(account?.passwordHash).not.toBe(input.password);
      await expect(
        verifyPassword(account!.passwordHash, input.password),
      ).resolves.toBe(true);

      expect(await findQueueCounts(email)).toEqual({
        token_count: 1,
        job_count: 1,
      });

      const permissions = await getDatabase()
        .select()
        .from(userPermissions)
        .where(eq(userPermissions.userId, account!.id));

      expect(permissions).toEqual([]);
    });
  });

  it('returns the same acknowledgement for duplicates without changing account or queue data', async () => {
    const email = `duplicate-${randomUUID()}@example.test`;

    await withTestEmail(email, async () => {
      const firstResponse = await makeService().register(makeInput(email));
      const [before] = await findAccounts(email);
      const beforeCounts = await findQueueCounts(email);
      const screenSpy = vi.fn<PasswordService['screenPassword']>(
        async () => 'clear',
      );
      const hashSpy = vi.fn<PasswordService['hashPassword']>(
        async () => '$second-test-hash$',
      );

      const secondResponse = await makeService(screenSpy, hashSpy).register(
        makeInput(email.toUpperCase(), {
          firstName: 'Different',
          lastName: 'Submission',
          password: '  Another Valid Password  ',
        }),
      );
      const [after] = await findAccounts(email);

      expect(firstResponse).toEqual(secondResponse);
      expect(screenSpy).toHaveBeenCalledOnce();
      expect(hashSpy).toHaveBeenCalledOnce();
      expect(after).toEqual(before);
      expect(await findQueueCounts(email)).toEqual(beforeCounts);
    });
  });

  it('allows concurrent duplicate submissions to create only one account, token and job', async () => {
    const email = `concurrent-${randomUUID()}@example.test`;

    await withTestEmail(email, async () => {
      const screenSpy = vi.fn<PasswordService['screenPassword']>(
        async () => 'clear',
      );
      const hashSpy = vi.fn<PasswordService['hashPassword']>(
        async () => `$concurrent-test-hash$${randomUUID()}`,
      );
      const service = makeService(screenSpy, hashSpy);
      const input = makeInput(email);

      const responses = await Promise.all([
        service.register(input),
        service.register(input),
      ]);

      expect(responses[0]).toEqual(responses[1]);
      expect(await findAccounts(email)).toHaveLength(1);
      expect(await findQueueCounts(email)).toEqual({
        token_count: 1,
        job_count: 1,
      });
      expect(screenSpy).toHaveBeenCalledTimes(2);
      expect(hashSpy).toHaveBeenCalledTimes(2);
    });
  });

  it('does not create related records for a compromised password', async () => {
    const email = `compromised-${randomUUID()}@example.test`;
    const hashSpy = vi.fn<PasswordService['hashPassword']>(
      async () => '$must-not-be-used$',
    );

    await withTestEmail(email, async () => {
      await expect(
        makeService(async () => 'compromised', hashSpy).register(
          makeInput(email),
        ),
      ).rejects.toMatchObject({
        name: 'ApplicationError',
        code: 'VALIDATION_ERROR',
        details: [
          {
            field: 'password',
            code: 'PASSWORD_COMPROMISED',
          },
        ],
      });

      expect(hashSpy).not.toHaveBeenCalled();
      expect(await findAccounts(email)).toEqual([]);
      expect(await findQueueCounts(email)).toEqual({
        token_count: 0,
        job_count: 0,
      });
    });
  });

  it('does not create related records when password screening is unavailable', async () => {
    const email = `screening-outage-${randomUUID()}@example.test`;
    const safeOutage = new ApplicationError(
      'SERVICE_UNAVAILABLE',
      'Password screening is temporarily unavailable.',
    );

    await withTestEmail(email, async () => {
      await expect(
        makeService(async () => {
          throw safeOutage;
        }).register(makeInput(email)),
      ).rejects.toBe(safeOutage);

      expect(await findAccounts(email)).toEqual([]);
      expect(await findQueueCounts(email)).toEqual({
        token_count: 0,
        job_count: 0,
      });
    });
  });

  it('rolls back the account and token when queue-job creation fails', async () => {
    const existingEmail = `rollback-existing-${randomUUID()}@example.test`;
    const rejectedEmail = `rollback-rejected-${randomUUID()}@example.test`;
    const collidingJobId = randomUUID();

    await withTestEmail(existingEmail, async () =>
      withTestEmail(rejectedEmail, async () => {
        await makeService(
          async () => 'clear',
          async () => '$rollback-test-hash$existing',
          collidingJobId,
        ).register(makeInput(existingEmail));

        await expect(
          makeService(
            async () => 'clear',
            async () => '$rollback-test-hash$rejected',
            collidingJobId,
          ).register(makeInput(rejectedEmail)),
        ).rejects.toThrow();

        expect(await findAccounts(rejectedEmail)).toEqual([]);
        expect(await findQueueCounts(rejectedEmail)).toEqual({
          token_count: 0,
          job_count: 0,
        });
        expect(await findQueueCounts(existingEmail)).toEqual({
          token_count: 1,
          job_count: 1,
        });
      }),
    );
  });

  it('commits registration independently of SMTP and delivers through the fake worker', async () => {
    const email = `worker-delivery-${randomUUID()}@example.test`;

    await withTestEmail(email, async () => {
      const acknowledgement = await makeService().register(makeInput(email));
      const messages: OutboundEmail[] = [];
      const transport: EmailTransport = {
        async send(message) {
          messages.push(message);
        },
      };
      const worker = createEmailDeliveryWorker({
        repository: createEmailDeliveryRepository(getDatabase()),
        transport,
        queueConfig: TEST_QUEUE_CONFIG,
        workerConfig: TEST_WORKER_CONFIG,
        // Match the fixed issuance clock so this test token remains due.
        now: () => new Date(ACCEPTED_AT_FOR_TESTS),
      });

      expect(acknowledgement).toEqual({
        data: { message: 'Registration request received.' },
      });
      expect(await worker.runOnce()).toBe(1);
      expect(messages).toHaveLength(1);
      expect(messages[0]?.to).toBe(email);
      expect(messages[0]?.subject).toBe('Verify your Tennis Xpress email');

      const job = await findJobState(email);
      expect(job).toEqual({
        status: 'sent',
        attempt_count: 1,
        payload_present: false,
      });
    });
  });

  it('keeps queued work when the worker encounters temporary SMTP unavailability', async () => {
    const email = `worker-outage-${randomUUID()}@example.test`;

    await withTestEmail(email, async () => {
      const acknowledgement = await makeService().register(makeInput(email));
      const diagnostics: EmailWorkerDiagnostic[] = [];
      const transport: EmailTransport = {
        async send() {
          throw new EmailTransportError('transient');
        },
      };
      const worker = createEmailDeliveryWorker({
        repository: createEmailDeliveryRepository(getDatabase()),
        transport,
        queueConfig: TEST_QUEUE_CONFIG,
        workerConfig: TEST_WORKER_CONFIG,
        now: () => new Date(ACCEPTED_AT_FOR_TESTS),
        onDiagnostic: (event) => diagnostics.push(event),
      });

      expect(acknowledgement).toEqual({
        data: { message: 'Registration request received.' },
      });
      expect(await worker.runOnce()).toBe(1);
      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          status: 'retry_scheduled',
          classification: 'temporary_smtp',
        }),
      );
      expect(await findAccounts(email)).toHaveLength(1);
      expect(await findQueueCounts(email)).toEqual({
        token_count: 1,
        job_count: 1,
      });
      expect(await findJobState(email)).toEqual({
        status: 'pending',
        attempt_count: 1,
        payload_present: true,
      });
    });
  });

  it('does not swallow unrelated database constraint failures', async () => {
    const email = `database-error-${randomUUID()}@example.test`;

    await withTestEmail(email, async () => {
      await expect(
        getAccounts().createAccount(
          {
            firstName: ' ',
            lastName: 'Valid',
            email,
            passwordHash: '$test-only$hash',
            status: 'pending_email_verification',
            emailVerifiedAt: null,
            termsAcceptedVersion: TERMS_VERSION_FOR_TESTS,
            termsAcceptedAt: ACCEPTED_AT_FOR_TESTS,
          },
          async () => undefined,
        ),
      ).rejects.toMatchObject({
        cause: {
          code: '23514',
          constraint: 'users_first_name_not_blank',
        },
      });

      expect(await findAccounts(email)).toEqual([]);
    });
  });
});
