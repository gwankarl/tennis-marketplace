import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { users } from './accounts.schema.js';
import type { DatabaseTransactionExecutor } from '../../../db/client.js';

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

export interface UserProfileRecord {
  firstName: string;
  lastName: string;
  email: string;
  emailVerified: boolean;
  createdAt: Date;
}

export type ProfileNameChanges = Partial<
  Pick<UserProfileRecord, 'firstName' | 'lastName'>
>;

export interface AccountRepository {
  createAccount(
    account: NewAccountRecord,
    afterInsert: AfterAccountInsert,
  ): Promise<CreateAccountResult>;
  getProfileById(userId: string): Promise<UserProfileRecord | null>;
  updateProfileById(
    userId: string,
    changes: ProfileNameChanges,
    updatedAt: Date,
  ): Promise<UserProfileRecord | null>;
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

const profileColumns = {
  firstName: users.firstName,
  lastName: users.lastName,
  email: users.email,
  emailVerifiedAt: users.emailVerifiedAt,
  createdAt: users.createdAt,
};

type ProfileRow = Pick<
  typeof users.$inferSelect,
  'firstName' | 'lastName' | 'email' | 'emailVerifiedAt' | 'createdAt'
>;

function toUserProfile(row: ProfileRow): UserProfileRecord {
  return {
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    emailVerified: row.emailVerifiedAt !== null,
    createdAt: row.createdAt,
  };
}

/**
 * Persists identity data and returns only approved profile fields.
 * Callers must derive userId from the authenticated session.
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

    async getProfileById(userId) {
      const [row] = await database
        .select(profileColumns)
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      return row ? toUserProfile(row) : null;
    },

    async updateProfileById(userId, changes, updatedAt) {
      const [row] = await database
        .update(users)
        .set({ ...changes, updatedAt })
        .where(eq(users.id, userId))
        .returning(profileColumns);

      return row ? toUserProfile(row) : null;
    },
  };
}
