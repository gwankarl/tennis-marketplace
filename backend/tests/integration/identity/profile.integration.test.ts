import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseTestDatabaseUrl } from '../../../src/config/test-database.js';
import { createAccountRepository } from '../../../src/modules/identity/accounts/account.repository.js';

const connectionString = parseTestDatabaseUrl(process.env);

let pool: Pool | undefined;
let accounts: ReturnType<typeof createAccountRepository> | undefined;

function getPool(): Pool {
  if (!pool) {
    throw new Error('The guarded integration database is unavailable.');
  }

  return pool;
}

function getAccounts(): NonNullable<typeof accounts> {
  if (!accounts) {
    throw new Error('The guarded integration repository is unavailable.');
  }

  return accounts;
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
    accounts = createAccountRepository(drizzle({ client: candidate }));
  } catch {
    await candidate.end().catch(() => undefined);
    throw new Error(
      'Profile integration preflight failed. Confirm the dedicated test database and migrations; no credentials are shown.',
    );
  }
});

afterAll(async () => {
  await pool?.end();
});

describe('PostgreSQL user profile persistence', () => {
  it('updates names and timestamp while preserving account security fields', async () => {
    const email = `profile-${randomUUID()}@example.test`;
    const passwordHash = '$test-only$profile-hash';
    const termsAcceptedAt = new Date('2026-01-01T00:00:00.000Z');
    const createdAt = new Date('2026-01-02T00:00:00.000Z');
    const originalUpdatedAt = new Date('2026-01-03T00:00:00.000Z');
    const nextUpdatedAt = new Date('2026-02-01T12:00:00.000Z');

    const inserted = await getPool().query<{ id: string }>(
      `INSERT INTO users (
         first_name, last_name, email, password_hash, status,
         email_verified_at, terms_accepted_version, terms_accepted_at,
         created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        'Test',
        'Player',
        email,
        passwordHash,
        termsAcceptedAt,
        'terms-v1',
        termsAcceptedAt,
        createdAt,
        originalUpdatedAt,
      ],
    );
    const userId = inserted.rows[0]!.id;

    try {
      await getPool().query(
        'INSERT INTO user_permissions (user_id, permission) VALUES ($1, $2)',
        [userId, 'administrator'],
      );

      const before = await getPool().query(
        `SELECT email, password_hash, status, email_verified_at,
                terms_accepted_version, terms_accepted_at, created_at,
                updated_at,
                (SELECT array_agg(permission::text ORDER BY permission::text)
                   FROM user_permissions WHERE user_id = users.id) AS permissions
           FROM users WHERE id = $1`,
        [userId],
      );

      await expect(getAccounts().getProfileById(userId)).resolves.toEqual({
        firstName: 'Test',
        lastName: 'Player',
        email,
        emailVerified: true,
        createdAt,
      });

      const updated = await getAccounts().updateProfileById(
        userId,
        { firstName: 'Serena', lastName: 'Williams' },
        nextUpdatedAt,
      );

      expect(updated).toEqual({
        firstName: 'Serena',
        lastName: 'Williams',
        email,
        emailVerified: true,
        createdAt,
      });

      const after = await getPool().query(
        `SELECT email, password_hash, status, email_verified_at,
                terms_accepted_version, terms_accepted_at, created_at,
                updated_at,
                (SELECT array_agg(permission::text ORDER BY permission::text)
                   FROM user_permissions WHERE user_id = users.id) AS permissions
           FROM users WHERE id = $1`,
        [userId],
      );

      expect(after.rows[0]).toEqual({
        ...before.rows[0],
        updated_at: nextUpdatedAt,
      });
      expect(JSON.stringify(updated)).not.toContain(passwordHash);
      expect(updated).not.toHaveProperty('status');
      expect(updated).not.toHaveProperty('permissions');
    } finally {
      await getPool().query('DELETE FROM users WHERE id = $1', [userId]);
    }
  });
});
