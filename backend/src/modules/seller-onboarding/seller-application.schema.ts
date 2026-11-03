import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from '../identity/accounts/accounts.schema.js';

export const sellerApplicationStatus = pgEnum('seller_application_status', [
  'draft',
  'submitted',
  'changes_requested',
  'approved',
  'rejected',
]);

export const sellerType = pgEnum('seller_type', ['individual', 'commercial']);

export const sellerApplicantRelationship = pgEnum(
  'seller_applicant_relationship',
  ['owner', 'authorized_representative'],
);

export const sellerInventoryCondition = pgEnum('seller_inventory_condition', [
  'new',
  'used',
  'both',
]);

export const sellerFulfillmentOption = pgEnum('seller_fulfillment_option', [
  'pickup',
  'local_delivery',
  'both',
]);

export const sellerRegistrationStatus = pgEnum('seller_registration_status', [
  'registered',
  'registration_pending',
  'not_registered',
]);

export const sellerApplications = pgTable(
  'seller_applications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    status: sellerApplicationStatus('status').notNull().default('draft'),
    sellerType: sellerType('seller_type'),
    applicantRelationship: sellerApplicantRelationship(
      'applicant_relationship',
    ),

    proposedStoreName: varchar('proposed_store_name', { length: 120 }),
    privateContactPhone: varchar('private_contact_phone', { length: 32 }),
    city: varchar('city', { length: 100 }).default('Yaoundé'),
    neighborhood: varchar('neighborhood', { length: 100 }),
    sellerDescription: varchar('seller_description', { length: 500 }),
    inventoryCondition: sellerInventoryCondition('inventory_condition'),
    fulfillmentOption: sellerFulfillmentOption('fulfillment_option'),

    businessTradingName: varchar('business_trading_name', { length: 150 }),
    businessContactName: varchar('business_contact_name', { length: 100 }),
    registrationStatus: sellerRegistrationStatus('registration_status'),
    registrationReference: varchar('registration_reference', { length: 100 }),
    privateOperatingAddress: varchar('private_operating_address', {
      length: 250,
    }),

    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('seller_applications_account_idx').on(table.accountId),

    // Draft, submitted, and changes-requested applications are active.
    // PostgreSQL enforces this under concurrent creation attempts.
    uniqueIndex('seller_applications_one_active_per_account')
      .on(table.accountId)
      .where(
        sql`${table.status} IN ('draft', 'submitted', 'changes_requested')`,
      ),

    check(
      'seller_applications_commercial_fields_require_commercial_type',
      sql`(
        COALESCE(${table.sellerType} = 'commercial', false)
        OR (
          ${table.businessTradingName} IS NULL
          AND ${table.businessContactName} IS NULL
          AND ${table.registrationStatus} IS NULL
          AND ${table.registrationReference} IS NULL
          AND ${table.privateOperatingAddress} IS NULL
        )
      )`,
    ),

    // A reference may be absent from an incomplete draft, but it cannot be
    // retained after the registration status changes away from "registered".
    check(
      'seller_applications_registration_reference_requires_registered_status',
      sql`(
        COALESCE(${table.registrationStatus} = 'registered', false)
        OR ${table.registrationReference} IS NULL
      )`,
    ),
  ],
);
