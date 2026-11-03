import 'dotenv/config';
import { createHmac, randomUUID } from 'node:crypto';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseTestDatabaseUrl } from '../../src/config/test-database.js';
import { createLoginAttemptCounterRepository } from '../../src/identity/login-attempt-counter.repository.js';
import { createLoginService } from '../../src/identity/login.service.js';
import { createSessionService } from '../../src/identity/session.service.js';
import { hashSessionCredential } from '../../src/identity/session-credential.js';
import { createUserSessionRepository } from '../../src/identity/user-session.repository.js';

const connectionString = parseTestDatabaseUrl(process.env);
const HMAC_KEY = Buffer.alloc(32, 19).toString('base64url');
const HMAC_KEY_BYTES = Buffer.from(HMAC_KEY, 'base64url');
const ATTEMPT_TIME = new Date('2026-02-01T12:00:00.000Z');

let pool: Pool | undefined;
let database: NodePgDatabase | undefined;

function getPool(): Pool {
  if (!pool) throw new Error('Guarded PostgreSQL test pool is unavailable.');
  return pool;
}

function getDatabase(): NodePgDatabase {
  if (!database) throw new Error('Guarded PostgreSQL database is unavailable.');
  return database;
}

function makeTestIp(): string {
  const hex = randomUUID().replaceAll('-', '');
  const groups = hex.match(/.{4}/g);

  if (!groups) {
    throw new Error('Could not create a test IP address.');
  }

  return `2001:db8:${groups.slice(0, 6).join(':')}`;
}

function privateKey(scope: 'ip' | 'email', value: string): string {
  return createHmac('sha256', HMAC_KEY_BYTES)
    .update(scope, 'utf8')
    .update('\0', 'utf8')
    .update(value, 'utf8')
    .digest('hex');
}

async function createAccount(options: {
  email: string;
  status?: 'active' | 'suspended';
  verified?: boolean;
}): Promise<string> {
  const result = await getPool().query<{ id: string }>(
    `INSERT INTO users
       (first_name, last_name, email, password_hash, status,
        email_verified_at, terms_accepted_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      'Integration',
      'Player',
      options.email,
      'integration-test-hash',
      options.status ?? 'active',
      options.verified === false ? null : ATTEMPT_TIME,
      'terms-test',
    ],
  );

  return result.rows[0]!.id;
}

async function makeServices(
  options: {
    ipLimit?: number;
    emailLimit?: number;
    now?: () => Date;
  } = {},
) {
  const sessions = createUserSessionRepository(getDatabase());
  const counters = createLoginAttemptCounterRepository(getDatabase());

  return {
    sessions,
    counters,
    login: await createLoginService({
      sessions,
      counters,
      passwords: {
        hashPassword: async () => 'dummy-hash',
        verifyPassword: async (hash, password) =>
          hash === 'integration-test-hash' && password === 'correct password',
      },
      rateLimitHmacKey: HMAC_KEY,
      ipLimit: options.ipLimit ?? 20,
      emailLimit: options.emailLimit ?? 10,
      windowMs: 900_000,
      now: options.now ?? (() => ATTEMPT_TIME),
    }),
  };
}

async function cleanFixture(email: string, ip: string): Promise<void> {
  await getPool().query('DELETE FROM users WHERE email = $1', [email]);
  await getPool().query(
    `DELETE FROM login_attempt_counters
      WHERE (scope = 'ip' AND key_hash = $1)
         OR (scope = 'email' AND key_hash = $2)`,
    [privateKey('ip', ip), privateKey('email', email)],
  );
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
      throw new Error('Unexpected test database identity.');
    }

    await migrate(drizzle({ client: candidate }), {
      migrationsFolder: './drizzle',
    });

    pool = candidate;
    database = drizzle({ client: candidate });
  } catch {
    await candidate.end().catch(() => undefined);
    throw new Error(
      'Login/session integration preflight failed. Confirm TEST_DATABASE_URL and migrations; credentials are not shown.',
    );
  }
});

afterAll(async () => {
  await pool?.end();
});

describe('PostgreSQL login and session lifecycle', () => {
  it('stores only a credential hash and supports independent sessions and logout', async () => {
    const email = `session-${randomUUID()}@example.test`;
    const ip = '192.0.2.51';

    try {
      const userId = await createAccount({ email });
      const services = await makeServices();
      const credentials = {
        email: email.toUpperCase(),
        password: 'correct password',
      };

      const first = await services.login.login(credentials, ip);
      const second = await services.login.login(credentials, ip);

      expect(first.kind).toBe('authenticated');
      expect(second.kind).toBe('authenticated');
      if (first.kind !== 'authenticated' || second.kind !== 'authenticated') {
        return;
      }

      expect(first.credential).not.toBe(second.credential);

      const stored = await getPool().query<{
        credential_hash: string;
        user_id: string;
      }>(
        `SELECT credential_hash, user_id
           FROM user_sessions
          WHERE user_id = $1
          ORDER BY created_at`,
        [userId],
      );

      expect(stored.rows).toHaveLength(2);
      expect(stored.rows.map((row) => row.credential_hash)).toEqual([
        hashSessionCredential(first.credential),
        hashSessionCredential(second.credential),
      ]);
      expect(stored.rows.map((row) => row.credential_hash)).not.toContain(
        first.credential,
      );

      const sessionService = createSessionService({
        repository: services.sessions,
        now: () => new Date(ATTEMPT_TIME.getTime() + 1_000),
      });

      await expect(
        sessionService.current(first.credential),
      ).resolves.toMatchObject({
        userId,
      });
      await expect(sessionService.logout(first.credential)).resolves.toBe(true);
      await expect(
        sessionService.current(first.credential),
      ).resolves.toBeNull();
      await expect(
        sessionService.current(second.credential),
      ).resolves.toMatchObject({
        userId,
      });
    } finally {
      await cleanFixture(email, ip);
    }
  });

  it('applies the normalized-email limit before password verification', async () => {
    const email = `limit-${randomUUID()}@example.test`;
    const ip = makeTestIp();

    try {
      await createAccount({ email });
      const services = await makeServices({ emailLimit: 2 });

      const first = await services.login.login(
        { email: email.toUpperCase(), password: 'wrong' },
        ip,
      );

      const second = await services.login.login(
        { email, password: 'wrong' },
        ip,
      );
      const third = await services.login.login(
        { email: email.toUpperCase(), password: 'correct password' },
        ip,
      );

      expect(first.kind).toBe('invalid_credentials');
      expect(second.kind).toBe('invalid_credentials');
      expect(third).toMatchObject({
        kind: 'rate_limited',
        retryAfterSeconds: expect.any(Number),
      });
    } finally {
      await cleanFixture(email, ip);
    }
  });

  it('serializes concurrent counter updates and enforces the IP limit', async () => {
    const email = `concurrent-${randomUUID()}@example.test`;
    const ip = makeTestIp();

    try {
      await createAccount({ email });
      const services = await makeServices({ ipLimit: 3 });

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          services.login.login({ email, password: 'wrong' }, ip),
        ),
      );

      expect(
        results.filter((result) => result.kind === 'invalid_credentials'),
      ).toHaveLength(3);
      expect(
        results.filter((result) => result.kind === 'rate_limited'),
      ).toHaveLength(5);
    } finally {
      await cleanFixture(email, ip);
    }
  });

  it('rejects a session after the account becomes suspended', async () => {
    const email = `suspended-${randomUUID()}@example.test`;
    const ip = '192.0.2.54';

    try {
      const userId = await createAccount({ email });
      const services = await makeServices();
      const result = await services.login.login(
        { email, password: 'correct password' },
        ip,
      );

      expect(result.kind).toBe('authenticated');
      if (result.kind !== 'authenticated') return;

      await getPool().query(
        `UPDATE users SET status = 'suspended' WHERE id = $1`,
        [userId],
      );

      const sessionService = createSessionService({
        repository: services.sessions,
        now: () => new Date(ATTEMPT_TIME.getTime() + 1_000),
      });

      await expect(
        sessionService.current(result.credential),
      ).resolves.toBeNull();
    } finally {
      await cleanFixture(email, ip);
    }
  });

  it('rejects a session after its absolute expiry', async () => {
    const email = `expiry-${randomUUID()}@example.test`;
    const ip = '192.0.2.55';

    try {
      await createAccount({ email });
      const services = await makeServices();
      const result = await services.login.login(
        { email, password: 'correct password' },
        ip,
      );

      expect(result.kind).toBe('authenticated');
      if (result.kind !== 'authenticated') return;

      const sessionService = createSessionService({
        repository: services.sessions,
        now: () => new Date(ATTEMPT_TIME.getTime() + 8 * 24 * 60 * 60 * 1000),
      });

      await expect(
        sessionService.current(result.credential),
      ).resolves.toBeNull();
    } finally {
      await cleanFixture(email, ip);
    }
  });
});
