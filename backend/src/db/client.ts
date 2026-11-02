import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../config/runtime-env.js';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

export const db = drizzle({ client: pool });

/** Closes the shared PostgreSQL pool and releases its connections. */
export async function closeDatabase(): Promise<void> {
  await pool.end();
}
