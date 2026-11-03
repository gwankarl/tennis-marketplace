import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseTestDatabaseUrl } from '../../../src/config/test-database.js';

// Never fall back to DATABASE_URL for integration tests.
const connectionString = parseTestDatabaseUrl(process.env);

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    throw new Error('The guarded integration database is unavailable.');
  }

  return pool;
}

async function withRollback<T>(
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  let transactionOpen = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;
    return await run(client);
  } finally {
    try {
      if (transactionOpen) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
    } finally {
      client.release();
    }
  }
}

beforeAll(async () => {
  const candidate = new Pool({ connectionString, max: 1 });

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
  } catch {
    await candidate.end().catch(() => undefined);
    throw new Error(
      'Account migration integration preflight failed. Confirm the dedicated test database and migration files; no credentials are shown.',
    );
  }
});

afterAll(async () => {
  await pool?.end();
});

describe('account migration and constraints', () => {
  it('applies the account migration and creates both tables', async () => {
    const result = await getPool().query<{
      users_table: string | null;
      permissions_table: string | null;
    }>(`
      SELECT
        to_regclass('public.users')::text AS users_table,
        to_regclass('public.user_permissions')::text AS permissions_table
    `);

    expect(result.rows[0]).toEqual({
      users_table: 'users',
      permissions_table: 'user_permissions',
    });
  });

  it('stores a pending account, enforces normalized email uniqueness, and rolls back test data', async () => {
    await withRollback(async (client) => {
      const email = `m1-${randomUUID()}@example.test`;
      const passwordHash = '$test-only$not-a-real-credential';

      const insertAccount = (values: {
        firstName: string;
        lastName: string;
        email: string;
      }) =>
        client.query<{
          id: string;
          status: string;
          email_verified_at: Date | null;
          terms_accepted_version: string;
          terms_accepted_at: Date;
          created_at: Date;
        }>(
          `INSERT INTO users
             (first_name, last_name, email, password_hash, terms_accepted_version)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, status, email_verified_at, terms_accepted_version,
                     terms_accepted_at, created_at`,
          [
            values.firstName,
            values.lastName,
            values.email,
            passwordHash,
            'terms-v1',
          ],
        );

      const inserted = await insertAccount({
        firstName: 'Test',
        lastName: 'Account',
        email,
      });
      const account = inserted.rows[0];

      expect(account).toBeDefined();
      expect(account?.status).toBe('pending_email_verification');
      expect(account?.email_verified_at).toBeNull();
      expect(account?.terms_accepted_version).toBe('terms-v1');
      expect(account?.terms_accepted_at).toBeInstanceOf(Date);
      expect(account?.created_at).toBeInstanceOf(Date);

      await client.query('SAVEPOINT duplicate_email');
      await expect(
        insertAccount({
          firstName: 'Duplicate',
          lastName: 'Account',
          email: email.toUpperCase(),
        }),
      ).rejects.toMatchObject({ code: '23505' });
      await client.query('ROLLBACK TO SAVEPOINT duplicate_email');

      await client.query('SAVEPOINT blank_name');
      await expect(
        insertAccount({
          firstName: '   ',
          lastName: 'Account',
          email: `blank-${randomUUID()}@example.test`,
        }),
      ).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK TO SAVEPOINT blank_name');

      await client.query('SAVEPOINT unverified_activation');
      await expect(
        client.query(`UPDATE users SET status = 'active' WHERE id = $1`, [
          account?.id,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK TO SAVEPOINT unverified_activation');

      const permissionRows = await client.query(
        'SELECT permission FROM user_permissions WHERE user_id = $1',
        [account?.id],
      );
      expect(permissionRows.rows).toEqual([]);

      const accountColumns = await client.query<{ column_name: string }>(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'users'`,
      );
      const columnNames = accountColumns.rows.map((row) => row.column_name);
      expect(columnNames).not.toContain('confirm_password');
      expect(columnNames).not.toContain('role');
    });
  });
});
