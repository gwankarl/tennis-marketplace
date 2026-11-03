import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { DatabaseTransactionExecutor } from '../db/client.js';

export interface LoginCounterInput {
  now: Date;
  windowMs: number;
  ip: { keyHash: string; max: number };
  email: { keyHash: string; max: number };
}

export type LoginCounterDecision =
  | { allowed: true }
  | {
      allowed: false;
      scope: 'ip' | 'email';
      retryAfterSeconds: number;
    };

export interface LoginAttemptCounterRepository {
  checkAndIncrement(input: LoginCounterInput): Promise<LoginCounterDecision>;

  deleteExpiredCounters(
    now: Date,
    windowMs: number,
    batchSize?: number,
  ): Promise<number>;
}

interface CounterRow {
  window_started_at: Date | string;
  attempt_count: number | string;
}

function firstRow<T>(result: { rows: unknown[] }): T | undefined {
  return result.rows[0] as T | undefined;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function validateInput(input: LoginCounterInput): void {
  if (
    !Number.isFinite(input.now.getTime()) ||
    !Number.isInteger(input.windowMs) ||
    input.windowMs < 1
  ) {
    throw new Error('Invalid login counter window configuration.');
  }

  for (const counter of [input.ip, input.email]) {
    if (
      !/^[0-9a-f]{64}$/.test(counter.keyHash) ||
      !Number.isInteger(counter.max) ||
      counter.max < 1 ||
      counter.max > 1000
    ) {
      throw new Error('Invalid login counter key or limit.');
    }
  }
}

async function consumeCounter(
  transaction: DatabaseTransactionExecutor,
  scope: 'ip' | 'email',
  keyHash: string,
  now: Date,
  windowMs: number,
  max: number,
): Promise<LoginCounterDecision> {
  const inserted = await transaction.execute(sql`
    INSERT INTO login_attempt_counters (
      scope,
      key_hash,
      window_started_at,
      attempt_count
    )
    VALUES (
      ${scope}::login_rate_limit_scope,
      ${keyHash},
      ${now},
      1
    )
    ON CONFLICT (scope, key_hash) DO NOTHING
    RETURNING key_hash
  `);

  // A newly inserted row already represents this request's first attempt.
  if (inserted.rows.length > 0) {
    return { allowed: true };
  }

  // Existing rows are locked so concurrent requests cannot exceed the limit.
  const result = await transaction.execute(sql`
    SELECT window_started_at, attempt_count
    FROM login_attempt_counters
    WHERE scope = ${scope}::login_rate_limit_scope
      AND key_hash = ${keyHash}
    FOR UPDATE
  `);
  const row = firstRow<CounterRow>(result);

  if (!row) {
    throw new Error('Login counter row was not available after upsert.');
  }

  const windowStartedAt = asDate(row.window_started_at);
  const attemptCount = Number(row.attempt_count);

  if (
    !Number.isFinite(windowStartedAt.getTime()) ||
    !Number.isSafeInteger(attemptCount)
  ) {
    throw new Error('Login counter row contains invalid data.');
  }

  if (windowStartedAt.getTime() + windowMs <= now.getTime()) {
    await transaction.execute(sql`
      UPDATE login_attempt_counters
      SET window_started_at = ${now},
          attempt_count = 1
      WHERE scope = ${scope}::login_rate_limit_scope
        AND key_hash = ${keyHash}
    `);

    return { allowed: true };
  }

  if (attemptCount >= max) {
    return {
      allowed: false,
      scope,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil(
          (windowStartedAt.getTime() + windowMs - now.getTime()) / 1000,
        ),
      ),
    };
  }

  await transaction.execute(sql`
    UPDATE login_attempt_counters
    SET attempt_count = attempt_count + 1
    WHERE scope = ${scope}::login_rate_limit_scope
      AND key_hash = ${keyHash}
  `);

  return { allowed: true };
}

/**
 * Increments the IP and normalized-email buckets in one transaction.
 * Buckets are anchored fixed windows, not exact rolling windows.
 */
export function createLoginAttemptCounterRepository(
  database: NodePgDatabase,
): LoginAttemptCounterRepository {
  return {
    async checkAndIncrement(input) {
      validateInput(input);

      return database.transaction(async (transaction) => {
        // Always lock IP first and email second to keep a consistent order.
        const ipDecision = await consumeCounter(
          transaction,
          'ip',
          input.ip.keyHash,
          input.now,
          input.windowMs,
          input.ip.max,
        );
        const emailDecision = await consumeCounter(
          transaction,
          'email',
          input.email.keyHash,
          input.now,
          input.windowMs,
          input.email.max,
        );

        // Count each submitted attempt in both dimensions. Prefer the IP
        // response if both buckets are exhausted; neither reveals account state.
        if (!ipDecision.allowed) {
          return ipDecision;
        }

        if (!emailDecision.allowed) {
          return emailDecision;
        }

        return { allowed: true };
      });
    },

    async deleteExpiredCounters(now, windowMs, batchSize = 500) {
      if (
        !Number.isFinite(now.getTime()) ||
        !Number.isInteger(windowMs) ||
        windowMs < 1 ||
        !Number.isInteger(batchSize) ||
        batchSize < 1 ||
        batchSize > 5000
      ) {
        throw new Error('Invalid login counter cleanup configuration.');
      }

      const cutoff = new Date(now.getTime() - windowMs);
      const result = await database.execute(sql`
        WITH expired AS (
          SELECT scope, key_hash
          FROM login_attempt_counters
          WHERE window_started_at <= ${cutoff}
          ORDER BY window_started_at
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM login_attempt_counters AS counters
        USING expired
        WHERE counters.scope = expired.scope
          AND counters.key_hash = expired.key_hash
        RETURNING counters.key_hash
      `);

      return result.rows.length;
    },
  };
}
