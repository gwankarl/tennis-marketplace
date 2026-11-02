import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { users } from '../db/accounts.schema.js';
import type { DatabaseTransactionExecutor } from '../db/client.js';

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

export type AfterAccountInsert = (
  accountId: string,
  transaction: DatabaseTransactionExecutor,
) => Promise<void>;

export interface AccountRepository {
  createAccount(
    account: NewAccountRecord,
    afterInsert: AfterAccountInsert,
  ): Promise<CreateAccountResult>;
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
 * Inserts the account and runs queue creation on the same transaction.
 * Only the normalized-email unique violation becomes a duplicate result.
 */
export function createAccountRepository(
  database: NodePgDatabase,
): AccountRepository {
  return {
    async createAccount(account, afterInsert) {
      try {
        await database.transaction(async (transaction) => {
          const [createdAccount] = await transaction
            .insert(users)
            .values(account)
            .returning({ id: users.id });

          if (!createdAccount) {
            throw new Error('Account insert returned no row.');
          }

          await afterInsert(createdAccount.id, transaction);
        });

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
