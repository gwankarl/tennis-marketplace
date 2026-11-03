import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { DatabaseTransactionExecutor } from '../../../db/client.js';

export interface LoginAccountRecord {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
  status: string;
  emailVerifiedAt: Date | null;
  isAdministrator: boolean;
}

export interface NewUserSession {
  userId: string;
  credentialHash: string;
  now: Date;
  absoluteExpiresAt: Date;
}

export interface SessionIdlePolicy {
  now: Date;
  standardIdleTimeoutMs: number;
  administratorIdleTimeoutMs: number;
}

export interface AuthenticatedSession {
  sessionId: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  isAdministrator: boolean;
}

export type LockedAccountOperation<T> = (
  account: LoginAccountRecord | null,
  transaction: DatabaseTransactionExecutor,
) => Promise<T>;

export interface UserSessionRepository {
  getLoginAccountByNormalizedEmail(
    email: string,
  ): Promise<LoginAccountRecord | null>;

  withLockedAccount<T>(
    userId: string,
    operation: LockedAccountOperation<T>,
  ): Promise<T>;

  createSession(
    transaction: DatabaseTransactionExecutor,
    session: NewUserSession,
  ): Promise<void>;

  validateAndTouch(
    credentialHash: string,
    policy: SessionIdlePolicy,
  ): Promise<AuthenticatedSession | null>;

  revokeCurrentSession(credentialHash: string, now: Date): Promise<boolean>;

  revokeAllSessions(
    transaction: DatabaseTransactionExecutor,
    userId: string,
    now: Date,
  ): Promise<number>;
}

interface SessionAccountRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  password_hash: string;
  status: string;
  email_verified_at: Date | null;
  is_administrator: boolean;
}

interface SessionOwnerRow {
  user_id: string;
}

interface SessionStateRow {
  id: string;
  last_activity_at: Date | string;
  absolute_expires_at: Date | string;
  revoked_at: Date | string | null;
}

function firstRow<T>(result: { rows: unknown[] }): T | undefined {
  return result.rows[0] as T | undefined;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function isSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function accountFromRow(row: SessionAccountRow): LoginAccountRecord {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    passwordHash: row.password_hash,
    status: row.status,
    emailVerifiedAt: row.email_verified_at,
    isAdministrator: row.is_administrator,
  };
}

async function selectAccount(
  executor: DatabaseTransactionExecutor,
  userId: string,
  lock: boolean,
): Promise<LoginAccountRecord | null> {
  const result = await executor.execute(sql`
    SELECT
      u.id,
      u.email,
      u.first_name,
      u.last_name,
      u.password_hash,
      u.status,
      u.email_verified_at,
      EXISTS (
        SELECT 1
        FROM user_permissions AS permissions
        WHERE permissions.user_id = u.id
          AND permissions.permission = 'administrator'
      ) AS is_administrator
    FROM users AS u
    WHERE u.id = ${userId}::uuid
    ${lock ? sql`FOR UPDATE OF u` : sql``}
  `);

  const row = firstRow<SessionAccountRow>(result);
  return row ? accountFromRow(row) : null;
}

/**
 * Account reads used before password verification are unlocked. Session
 * creation re-reads under a user-row lock so suspension and permission
 * changes can serialize with issuance.
 */
export function createUserSessionRepository(
  database: NodePgDatabase,
): UserSessionRepository {
  return {
    async getLoginAccountByNormalizedEmail(email) {
      const result = await database.execute(sql`
        SELECT
          u.id,
          u.email,
          u.first_name,
          u.last_name,
          u.password_hash,
          u.status,
          u.email_verified_at,
          EXISTS (
            SELECT 1
            FROM user_permissions AS permissions
            WHERE permissions.user_id = u.id
              AND permissions.permission = 'administrator'
          ) AS is_administrator
        FROM users AS u
        WHERE lower(btrim(u.email)) = ${email}
        LIMIT 1
      `);

      const row = firstRow<SessionAccountRow>(result);
      return row ? accountFromRow(row) : null;
    },

    async withLockedAccount(userId, operation) {
      return database.transaction(async (transaction) => {
        const account = await selectAccount(transaction, userId, true);
        return operation(account, transaction);
      });
    },

    async createSession(transaction, session) {
      if (!isSha256Hex(session.credentialHash)) {
        throw new Error('Invalid session credential hash.');
      }

      if (session.absoluteExpiresAt <= session.now) {
        throw new Error('Session expiry must be in the future.');
      }

      await transaction.execute(sql`
        INSERT INTO user_sessions (
          user_id,
          credential_hash,
          created_at,
          last_activity_at,
          absolute_expires_at
        )
        VALUES (
          ${session.userId}::uuid,
          ${session.credentialHash},
          ${session.now},
          ${session.now},
          ${session.absoluteExpiresAt}
        )
      `);
    },

    async validateAndTouch(credentialHash, policy) {
      if (!isSha256Hex(credentialHash)) {
        return null;
      }

      return database.transaction(async (transaction) => {
        // Lock order is user first, then session. Account-state mutation
        // services must use this same order before revoking sessions.
        const ownerResult = await transaction.execute(sql`
          SELECT user_id
          FROM user_sessions
          WHERE credential_hash = ${credentialHash}
          LIMIT 1
        `);
        const owner = firstRow<SessionOwnerRow>(ownerResult);

        if (!owner) {
          return null;
        }

        const account = await selectAccount(transaction, owner.user_id, true);

        if (
          !account ||
          account.status !== 'active' ||
          account.emailVerifiedAt === null
        ) {
          return null;
        }

        const sessionResult = await transaction.execute(sql`
          SELECT id, last_activity_at, absolute_expires_at, revoked_at
          FROM user_sessions
          WHERE user_id = ${account.id}::uuid
            AND credential_hash = ${credentialHash}
          FOR UPDATE
        `);
        const session = firstRow<SessionStateRow>(sessionResult);

        if (!session || session.revoked_at !== null) {
          return null;
        }

        const lastActivityAt = asDate(session.last_activity_at);
        const absoluteExpiresAt = asDate(session.absolute_expires_at);
        const idleTimeoutMs = account.isAdministrator
          ? policy.administratorIdleTimeoutMs
          : policy.standardIdleTimeoutMs;

        if (
          !Number.isFinite(lastActivityAt.getTime()) ||
          !Number.isFinite(absoluteExpiresAt.getTime()) ||
          absoluteExpiresAt.getTime() <= policy.now.getTime() ||
          lastActivityAt.getTime() <= policy.now.getTime() - idleTimeoutMs
        ) {
          return null;
        }

        await transaction.execute(sql`
          UPDATE user_sessions
          SET last_activity_at = GREATEST(last_activity_at, ${policy.now})
          WHERE id = ${session.id}::uuid
            AND revoked_at IS NULL
        `);

        return {
          sessionId: session.id,
          userId: account.id,
          email: account.email,
          firstName: account.firstName,
          lastName: account.lastName,
          isAdministrator: account.isAdministrator,
        };
      });
    },

    async revokeCurrentSession(credentialHash, now) {
      if (!isSha256Hex(credentialHash)) {
        return false;
      }

      return database.transaction(async (transaction) => {
        const ownerResult = await transaction.execute(sql`
          SELECT user_id
          FROM user_sessions
          WHERE credential_hash = ${credentialHash}
          LIMIT 1
        `);
        const owner = firstRow<SessionOwnerRow>(ownerResult);

        if (!owner) {
          return false;
        }

        // Use the same lock order as validation and account-state changes.
        await selectAccount(transaction, owner.user_id, true);

        const result = await transaction.execute(sql`
          UPDATE user_sessions
          SET revoked_at = ${now}
          WHERE user_id = ${owner.user_id}::uuid
            AND credential_hash = ${credentialHash}
            AND revoked_at IS NULL
          RETURNING id
        `);

        return result.rows.length > 0;
      });
    },

    async revokeAllSessions(transaction, userId, now) {
      // Account suspension and administrator-permission changes must lock
      // the user row before changing state and revoking sessions.
      await selectAccount(transaction, userId, true);

      const result = await transaction.execute(sql`
        UPDATE user_sessions
        SET revoked_at = ${now}
        WHERE user_id = ${userId}::uuid
          AND revoked_at IS NULL
        RETURNING id
      `);

      return result.rows.length;
    },
  };
}
