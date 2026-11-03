import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { DatabaseTransactionExecutor } from '../../db/client.js';
import {
  userPermissions,
  users,
} from '../identity/accounts/accounts.schema.js';
import { sellerApplications } from './seller-application.schema.js';

type ApplicationColumns =
  | 'id'
  | 'status'
  | 'sellerType'
  | 'applicantRelationship'
  | 'proposedStoreName'
  | 'privateContactPhone'
  | 'city'
  | 'neighborhood'
  | 'sellerDescription'
  | 'inventoryCondition'
  | 'fulfillmentOption'
  | 'businessTradingName'
  | 'businessContactName'
  | 'registrationStatus'
  | 'registrationReference'
  | 'privateOperatingAddress'
  | 'createdAt'
  | 'updatedAt';

export type SellerApplicationDraftRecord = Omit<
  Pick<typeof sellerApplications.$inferSelect, ApplicationColumns>,
  'status'
> & { status: 'draft' };

export type SellerApplicationDraftChanges = Partial<
  Pick<
    typeof sellerApplications.$inferInsert,
    | 'sellerType'
    | 'applicantRelationship'
    | 'proposedStoreName'
    | 'privateContactPhone'
    | 'city'
    | 'neighborhood'
    | 'sellerDescription'
    | 'inventoryCondition'
    | 'fulfillmentOption'
    | 'businessTradingName'
    | 'businessContactName'
    | 'registrationStatus'
    | 'registrationReference'
    | 'privateOperatingAddress'
  >
>;

export type SellerApplicationFailureReason =
  | 'account_ineligible'
  | 'seller_exists'
  | 'application_closed'
  | 'application_not_editable'
  | 'draft_not_found';

export type SellerApplicationRepositoryResult<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'failure'; reason: SellerApplicationFailureReason };

export interface SellerApplicationRepository {
  getDraft(
    accountId: string,
  ): Promise<
    SellerApplicationRepositoryResult<SellerApplicationDraftRecord | null>
  >;
  createOrGetDraft(
    accountId: string,
    changes: SellerApplicationDraftChanges,
  ): Promise<SellerApplicationRepositoryResult<SellerApplicationDraftRecord>>;
  updateDraft(
    accountId: string,
    changes: SellerApplicationDraftChanges,
    updatedAt: Date,
  ): Promise<SellerApplicationRepositoryResult<SellerApplicationDraftRecord>>;
}

interface AccountEligibilityRow {
  status: string;
  email_verified_at: Date | null;
}

interface ApplicationRow {
  id: string;
  status: string;
  seller_type: string | null;
  applicant_relationship: string | null;
  proposed_store_name: string | null;
  private_contact_phone: string | null;
  city: string | null;
  neighborhood: string | null;
  seller_description: string | null;
  inventory_condition: string | null;
  fulfillment_option: string | null;
  business_trading_name: string | null;
  business_contact_name: string | null;
  registration_status: string | null;
  registration_reference: string | null;
  private_operating_address: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function firstRow<T>(result: { rows: unknown[] }): T | undefined {
  return result.rows[0] as T | undefined;
}

function asDate(value: Date | string): Date {
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid seller application timestamp.');
  }

  return date;
}

function toDraft(row: ApplicationRow): SellerApplicationDraftRecord {
  return {
    id: row.id,
    status: 'draft',
    sellerType: row.seller_type as SellerApplicationDraftRecord['sellerType'],
    applicantRelationship:
      row.applicant_relationship as SellerApplicationDraftRecord['applicantRelationship'],
    proposedStoreName: row.proposed_store_name,
    privateContactPhone: row.private_contact_phone,
    city: row.city,
    neighborhood: row.neighborhood,
    sellerDescription: row.seller_description,
    inventoryCondition:
      row.inventory_condition as SellerApplicationDraftRecord['inventoryCondition'],
    fulfillmentOption:
      row.fulfillment_option as SellerApplicationDraftRecord['fulfillmentOption'],
    businessTradingName: row.business_trading_name,
    businessContactName: row.business_contact_name,
    registrationStatus:
      row.registration_status as SellerApplicationDraftRecord['registrationStatus'],
    registrationReference: row.registration_reference,
    privateOperatingAddress: row.private_operating_address,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

async function lockAndCheckAccount(
  transaction: DatabaseTransactionExecutor,
  accountId: string,
): Promise<boolean> {
  const result = await transaction.execute(sql`
    SELECT status, email_verified_at
    FROM users
    WHERE id = ${accountId}::uuid
    FOR UPDATE
  `);

  const account = firstRow<AccountEligibilityRow>(result);

  return account?.status === 'active' && account.email_verified_at !== null;
}

async function hasSellerPermission(
  transaction: DatabaseTransactionExecutor,
  accountId: string,
): Promise<boolean> {
  const result = await transaction.execute(sql`
    SELECT 1
    FROM user_permissions
    WHERE user_id = ${accountId}::uuid
      AND permission = 'seller'
    LIMIT 1
  `);

  return result.rows.length > 0;
}

async function latestApplication(
  transaction: DatabaseTransactionExecutor,
  accountId: string,
): Promise<ApplicationRow | undefined> {
  const result = await transaction.execute(sql`
    SELECT *
    FROM seller_applications
    WHERE account_id = ${accountId}::uuid
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE
  `);

  return firstRow<ApplicationRow>(result);
}

function failureForClosedState(
  status: string,
): SellerApplicationRepositoryResult<never> {
  return {
    kind: 'failure',
    reason:
      status === 'approved' || status === 'rejected'
        ? 'application_closed'
        : 'application_not_editable',
  };
}

function onlyDefinedChanges(
  changes: SellerApplicationDraftChanges,
): SellerApplicationDraftChanges {
  return Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== undefined),
  ) as SellerApplicationDraftChanges;
}

/**
 * Applies conditional clearing while holding the account and draft locks.
 * The database checks provide a second guard against stale commercial fields.
 */
function normalizeConditionalChanges(
  current: SellerApplicationDraftRecord | null,
  changes: SellerApplicationDraftChanges,
): SellerApplicationDraftChanges {
  const normalized = onlyDefinedChanges(changes);
  const nextSellerType =
    normalized.sellerType !== undefined
      ? normalized.sellerType
      : (current?.sellerType ?? null);

  if (nextSellerType !== 'commercial') {
    normalized.businessTradingName = null;
    normalized.businessContactName = null;
    normalized.registrationStatus = null;
    normalized.registrationReference = null;
    normalized.privateOperatingAddress = null;
  }

  const nextRegistrationStatus =
    normalized.registrationStatus !== undefined
      ? normalized.registrationStatus
      : (current?.registrationStatus ?? null);

  if (nextRegistrationStatus !== 'registered') {
    normalized.registrationReference = null;
  }

  return normalized;
}

export function createSellerApplicationRepository(
  database: NodePgDatabase,
): SellerApplicationRepository {
  return {
    async getDraft(accountId) {
      return database.transaction(async (transaction) => {
        if (!(await lockAndCheckAccount(transaction, accountId))) {
          return { kind: 'failure', reason: 'account_ineligible' } as const;
        }

        if (await hasSellerPermission(transaction, accountId)) {
          return { kind: 'failure', reason: 'seller_exists' } as const;
        }

        const row = await latestApplication(transaction, accountId);

        if (!row) {
          return { kind: 'ok', value: null } as const;
        }

        if (row.status !== 'draft') {
          return failureForClosedState(row.status);
        }

        return { kind: 'ok', value: toDraft(row) } as const;
      });
    },

    async createOrGetDraft(accountId, changes) {
      return database.transaction(async (transaction) => {
        // All applicant-side draft operations lock the account first, so two
        // concurrent create requests serialize before checking the partial index.
        if (!(await lockAndCheckAccount(transaction, accountId))) {
          return { kind: 'failure', reason: 'account_ineligible' } as const;
        }

        if (await hasSellerPermission(transaction, accountId)) {
          return { kind: 'failure', reason: 'seller_exists' } as const;
        }

        const existing = await latestApplication(transaction, accountId);

        if (existing) {
          if (existing.status === 'draft') {
            // A repeated POST is read-only; its submitted values are ignored.
            return { kind: 'ok', value: toDraft(existing) } as const;
          }

          return failureForClosedState(existing.status);
        }

        const initialValues = normalizeConditionalChanges(null, changes);
        const [created] = await transaction
          .insert(sellerApplications)
          .values({ accountId, ...initialValues })
          .returning();

        if (!created) {
          throw new Error('Seller application insert returned no row.');
        }

        return {
          kind: 'ok',
          value: {
            ...created,
            status: 'draft',
          },
        } as const;
      });
    },

    async updateDraft(accountId, changes, updatedAt) {
      return database.transaction(async (transaction) => {
        if (!(await lockAndCheckAccount(transaction, accountId))) {
          return { kind: 'failure', reason: 'account_ineligible' } as const;
        }

        if (await hasSellerPermission(transaction, accountId)) {
          return { kind: 'failure', reason: 'seller_exists' } as const;
        }

        const row = await latestApplication(transaction, accountId);

        if (!row) {
          return { kind: 'failure', reason: 'draft_not_found' } as const;
        }

        if (row.status !== 'draft') {
          return failureForClosedState(row.status);
        }

        const current = toDraft(row);
        const normalized = normalizeConditionalChanges(current, changes);

        const [updated] = await transaction
          .update(sellerApplications)
          .set({ ...normalized, updatedAt })
          .where(
            and(
              eq(sellerApplications.id, current.id),
              eq(sellerApplications.accountId, accountId),
              eq(sellerApplications.status, 'draft'),
            ),
          )
          .returning();

        if (!updated) {
          return { kind: 'failure', reason: 'draft_not_found' } as const;
        }

        return {
          kind: 'ok',
          value: {
            ...updated,
            status: 'draft',
          },
        } as const;
      });
    },
  };
}
