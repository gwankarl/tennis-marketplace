import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseTestDatabaseUrl } from '../../src/config/test-database.js';
import {
  createAccountRepository,
  type AccountRepository,
} from '../../src/identity/account.repository.js';
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
import { ApplicationError } from '../../src/http/application-error.js';
import { users, userPermissions } from '../../src/db/accounts.schema.js';

const connectionString = parseTestDatabaseUrl(process.env);
const TERMS_VERSION_FOR_TESTS = 'terms-v1';
const ACCEPTED_AT_FOR_TESTS = new Date('2026-01-15T12:00:00.000Z');

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
) {
  return createRegistrationService({
    accounts: getAccounts(),
    passwords: {
      screenPassword: screening,
      hashPassword: hashing,
    },
    termsVersion: TERMS_VERSION_FOR_TESTS,
    now: () => new Date(ACCEPTED_AT_FOR_TESTS),
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
  it('creates an unverified account with a verifiable hash and server Terms metadata', async () => {
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

      const permissions = await getDatabase()
        .select()
        .from(userPermissions)
        .where(eq(userPermissions.userId, account!.id));

      // Administrator permissions are separate and are never assigned by
      // public registration; buying capability is not an admin permission row.
      expect(permissions).toEqual([]);
    });
  });

  it('returns the same acknowledgement for a duplicate without changing the account', async () => {
    const email = `duplicate-${randomUUID()}@example.test`;

    await withTestEmail(email, async () => {
      const firstInput = makeInput(email);
      const firstResponse = await makeService().register(firstInput);
      const [before] = await findAccounts(email);
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
    });
  });

  it('allows concurrent duplicate submissions to create only one account', async () => {
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
      const savedAccounts = await findAccounts(email);

      expect(responses[0]).toEqual(responses[1]);
      expect(savedAccounts).toHaveLength(1);
      expect(screenSpy).toHaveBeenCalledTimes(2);
      expect(hashSpy).toHaveBeenCalledTimes(2);
    });
  });

  it('does not create an account for a compromised password', async () => {
    const email = `compromised-${randomUUID()}@example.test`;

    await withTestEmail(email, async () => {
      const hashSpy = vi.fn<PasswordService['hashPassword']>(
        async () => '$must-not-be-used$',
      );
      const service = makeService(async () => 'compromised', hashSpy);

      await expect(service.register(makeInput(email))).rejects.toMatchObject({
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
    });
  });

  it('does not create an account when password screening is unavailable', async () => {
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
    });
  });

  it('does not swallow unrelated database constraint failures', async () => {
    const email = `database-error-${randomUUID()}@example.test`;

    await withTestEmail(email, async () => {
      await expect(
        getAccounts().createAccount({
          firstName: ' ',
          lastName: 'Valid',
          email,
          passwordHash: '$test-only$hash',
          status: 'pending_email_verification',
          emailVerifiedAt: null,
          termsAcceptedVersion: TERMS_VERSION_FOR_TESTS,
          termsAcceptedAt: ACCEPTED_AT_FOR_TESTS,
        }),
      ).rejects.toMatchObject({
        cause: {
          code: '23514',
          constraint: 'users_first_name_not_blank',
        },
      });

      expect(await findAccounts(email)).toEqual([]);
    });
  });

  it('confirms account creation requires no second write or transaction', async () => {
    const email = `single-write-${randomUUID()}@example.test`;

    await withTestEmail(email, async () => {
      await makeService().register(makeInput(email));

      const [account] = await findAccounts(email);
      expect(account).toBeDefined();

      const permissions = await getDatabase()
        .select()
        .from(userPermissions)
        .where(eq(userPermissions.userId, account!.id));

      expect(permissions).toEqual([]);
    });
  });
});
