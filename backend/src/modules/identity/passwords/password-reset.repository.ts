import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { DatabaseTransactionExecutor } from '../../../db/client.js';

export interface PasswordResetCandidate {
  id: string;
  accountId: string;
  emailAddress: string;
}

export interface CompletePasswordReset {
  tokenId: string;
  accountId: string;
  emailAddress: string;
  tokenHash: string;
  passwordHash: string;
  now: Date;
}

export interface PasswordResetRepository {
  findCandidate(
    tokenHash: string,
    now: Date,
  ): Promise<PasswordResetCandidate | null>;

  complete(
    input: CompletePasswordReset,
    transaction: DatabaseTransactionExecutor,
  ): Promise<boolean>;
}

interface CandidateRow {
  id: string;
  account_id: string;
  email_address: string;
}

interface LockedTokenRow {
  id: string;
  email_address: string;
  is_unexpired: boolean;
  consumed_at: Date | null;
  invalidated_at: Date | null;
}

interface IdRow {
  id: string;
}

function firstRow<T>(result: { rows: unknown[] }): T | undefined {
  return result.rows[0] as T | undefined;
}

/**
 * Preflight finds a candidate without holding a lock during HIBP and Argon2
 * work. Completion rechecks the token under the user lock in the final
 * transaction and updates credentials, token state, and queued jobs atomically.
 */
export function createPasswordResetRepository(
  database: NodePgDatabase,
): PasswordResetRepository {
  return {
    async findCandidate(tokenHash, now) {
      const result = await database.execute(sql`
        SELECT
          reset_tokens.id,
          reset_tokens.account_id,
          reset_tokens.email_address
        FROM password_reset_tokens AS reset_tokens
        JOIN users ON users.id = reset_tokens.account_id
        WHERE reset_tokens.token_hash = ${tokenHash}
          AND reset_tokens.expires_at > ${now}
          AND reset_tokens.consumed_at IS NULL
          AND reset_tokens.invalidated_at IS NULL
          AND reset_tokens.email_address = users.email
          AND users.status = 'active'
          AND users.email_verified_at IS NOT NULL
        LIMIT 1
      `);

      const row = firstRow<CandidateRow>(result);

      return row
        ? {
            id: row.id,
            accountId: row.account_id,
            emailAddress: row.email_address,
          }
        : null;
    },

    async complete(input, transaction) {
      const tokenResult = await transaction.execute(sql`
        SELECT
          id,
          email_address,
          expires_at > ${input.now} AS is_unexpired,
          consumed_at,
          invalidated_at
        FROM password_reset_tokens
        WHERE id = ${input.tokenId}::uuid
          AND account_id = ${input.accountId}::uuid
          AND token_hash = ${input.tokenHash}
        FOR UPDATE
      `);
      const token = firstRow<LockedTokenRow>(tokenResult);

      if (
        !token ||
        !token.is_unexpired ||
        token.consumed_at !== null ||
        token.invalidated_at !== null ||
        token.email_address !== input.emailAddress
      ) {
        return false;
      }

      const accountUpdate = await transaction.execute(sql`
        UPDATE users
        SET password_hash = ${input.passwordHash},
            updated_at = ${input.now}
        WHERE id = ${input.accountId}::uuid
          AND email = ${input.emailAddress}
          AND status = 'active'
          AND email_verified_at IS NOT NULL
        RETURNING id
      `);

      if (!firstRow<IdRow>(accountUpdate)) {
        return false;
      }

      await transaction.execute(sql`
        UPDATE password_reset_tokens
        SET consumed_at = ${input.now}
        WHERE id = ${input.tokenId}::uuid
          AND consumed_at IS NULL
          AND invalidated_at IS NULL
      `);

      await transaction.execute(sql`
        UPDATE password_reset_tokens
        SET invalidated_at = ${input.now}
        WHERE account_id = ${input.accountId}::uuid
          AND id <> ${input.tokenId}::uuid
          AND consumed_at IS NULL
          AND invalidated_at IS NULL
      `);

      await transaction.execute(sql`
        UPDATE email_delivery_jobs
        SET status = 'cancelled',
            encryption_key_id = NULL,
            encrypted_payload = NULL,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = ${input.now}
        WHERE password_reset_token_id IN (
          SELECT id
          FROM password_reset_tokens
          WHERE account_id = ${input.accountId}::uuid
        )
          AND status IN ('pending', 'leased')
      `);

      return true;
    },
  };
}
