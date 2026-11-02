import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { users } from '../db/accounts.schema.js';

export interface NewAccountRecord {
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  status: 'pending_email_verification';
  emailVerifiedAt: null;
  termsAcceptedVersion: string;
  termsAcceptedAt: Date;
}

export type CreateAccountResult = 'created' | 'duplicate_email';

export interface AccountRepository {
  createAccount(account: NewAccountRecord): Promise<CreateAccountResult>;
}

interface PostgreSqlConstraintError extends Error {
  code?: unknown;
  constraint?: unknown;
}

function hasNormalizedEmailConstraint(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const databaseError = value as PostgreSqlConstraintError;

  return (
    databaseError.code === '23505' &&
    databaseError.constraint === 'users_email_normalized_unique'
  );
}

function isNormalizedEmailUniqueViolation(error: unknown): boolean {
  if (hasNormalizedEmailConstraint(error)) {
    return true;
  }

  if (error instanceof Error) {
    return hasNormalizedEmailConstraint(error.cause);
  }

  return false;
}

/**
 * Inserts one account. Only the named normalized-email unique constraint is
 * converted to a duplicate result; all other persistence errors propagate.
 */
export function createAccountRepository(
  database: NodePgDatabase,
): AccountRepository {
  return {
    async createAccount(account) {
      try {
        await database.insert(users).values(account);
        return 'created';
      } catch (error) {
        if (isNormalizedEmailUniqueViolation(error)) {
          return 'duplicate_email';
        }

        throw error;
      }
    },
  };
}
