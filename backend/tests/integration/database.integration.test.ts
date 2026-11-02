import 'dotenv/config';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseTestDatabaseUrl } from '../../src/config/test-database.js';

const connectionString = parseTestDatabaseUrl(process.env);

let pool: Pool | undefined;
let verifiedIdentity: { database_name: string; user_name: string } | undefined;

function getPool(): Pool {
  if (!pool) {
    throw new Error('The PostgreSQL integration pool is not available.');
  }

  return pool;
}

beforeAll(async () => {
  const candidate = new Pool({
    connectionString,
    max: 1,
  });

  try {
    const result = await candidate.query<{
      database_name: string;
      user_name: string;
    }>('SELECT current_database() AS database_name, current_user AS user_name');

    const identity = result.rows[0];

    if (
      identity?.database_name !== 'tennis_xpress_test' ||
      identity.user_name !== 'tennis_xpress_test'
    ) {
      throw new Error('Unexpected PostgreSQL identity.');
    }

    pool = candidate;
    verifiedIdentity = identity;
  } catch {
    await candidate.end().catch(() => undefined);

    throw new Error(
      'PostgreSQL integration preflight failed: the connected database and login must both be tennis_xpress_test. No test statements were run.',
    );
  }
});

afterAll(async () => {
  await pool?.end();
});

describe('PostgreSQL integration safety', () => {
  it('connects as the dedicated test login to the dedicated test database', () => {
    expect(verifiedIdentity).toEqual({
      database_name: 'tennis_xpress_test',
      user_name: 'tennis_xpress_test',
    });
  });

  it('rolls back temporary test data', async () => {
    const client = await getPool().connect();
    let transactionOpen = false;

    try {
      await client.query(
        'CREATE TEMP TABLE tennis_xpress_rollback_probe (id integer PRIMARY KEY)',
      );
      await client.query('BEGIN');
      transactionOpen = true;

      await client.query(
        'INSERT INTO tennis_xpress_rollback_probe (id) VALUES (1)',
      );
      await client.query('ROLLBACK');
      transactionOpen = false;

      const result = await client.query<{ row_count: string }>(
        'SELECT count(*)::text AS row_count FROM tennis_xpress_rollback_probe',
      );

      expect(result.rows[0]?.row_count).toBe('0');
    } finally {
      try {
        if (transactionOpen) {
          await client.query('ROLLBACK').catch(() => undefined);
        }

        await client
          .query('DROP TABLE IF EXISTS pg_temp.tennis_xpress_rollback_probe')
          .catch(() => undefined);
      } finally {
        client.release();
      }
    }
  });
});
