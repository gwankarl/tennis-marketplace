import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseTestDatabaseUrl } from '../../../src/config/test-database.js';
import { ApplicationError } from '../../../src/http/application-error.js';
import { createSellerApplicationRepository } from '../../../src/modules/seller-onboarding/seller-application.repository.js';
import { createSellerApplicationService } from '../../../src/modules/seller-onboarding/seller-application.service.js';

const connectionString = parseTestDatabaseUrl(process.env);
const UPDATED_AT = new Date('2026-06-01T12:00:00.000Z');
const TEST_PASSWORD_HASH = '$test-only$seller-application-hash';

let pool: Pool | undefined;
let service: ReturnType<typeof createSellerApplicationService> | undefined;

function getPool(): Pool {
  if (!pool) {
    throw new Error('The guarded integration database is unavailable.');
  }

  return pool;
}

function getService(): NonNullable<typeof service> {
  if (!service) {
    throw new Error('The guarded seller application service is unavailable.');
  }

  return service;
}

async function createAccount(
  status: 'active' | 'suspended' | 'pending_email_verification' = 'active',
): Promise<string> {
  const email = `seller-draft-${randomUUID()}@example.test`;
  const emailVerifiedAt =
    status === 'pending_email_verification'
      ? null
      : new Date('2026-05-01T12:00:00.000Z');

  const result = await getPool().query<{ id: string }>(
    `INSERT INTO users (
       first_name, last_name, email, password_hash, status,
       email_verified_at, terms_accepted_version
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      'Test',
      'Applicant',
      email,
      TEST_PASSWORD_HASH,
      status,
      emailVerifiedAt,
      'terms-test-v1',
    ],
  );

  const accountId = result.rows[0]?.id;

  if (!accountId) {
    throw new Error('Test account creation returned no ID.');
  }

  return accountId;
}

async function withAccount(
  run: (accountId: string) => Promise<void>,
  status: 'active' | 'suspended' | 'pending_email_verification' = 'active',
): Promise<void> {
  const accountId = await createAccount(status);

  try {
    await run(accountId);
  } finally {
    await getPool().query('DELETE FROM users WHERE id = $1', [accountId]);
  }
}

async function readAccountState(accountId: string) {
  const result = await getPool().query(
    `SELECT
       status,
       email_verified_at,
       password_hash,
       terms_accepted_version,
       COALESCE(
         (
           SELECT array_agg(permission::text ORDER BY permission::text)
           FROM user_permissions
           WHERE user_id = users.id
         ),
         ARRAY[]::text[]
       ) AS permissions
     FROM users
     WHERE id = $1`,
    [accountId],
  );

  return result.rows[0];
}

beforeAll(async () => {
  const candidate = new Pool({ connectionString, max: 4 });

  try {
    const identity = await candidate.query<{
      database_name: string;
      user_name: string;
    }>('SELECT current_database() AS database_name, current_user AS user_name');

    if (
      identity.rows[0]?.database_name !== 'tennis_xpress_test' ||
      identity.rows[0]?.user_name !== 'tennis_xpress_test'
    ) {
      throw new Error('Unexpected integration database identity.');
    }

    await migrate(drizzle({ client: candidate }), {
      migrationsFolder: './drizzle',
    });

    pool = candidate;
    service = createSellerApplicationService({
      repository: createSellerApplicationRepository(
        drizzle({ client: candidate }),
      ),
      now: () => UPDATED_AT,
    });
  } catch {
    await candidate.end().catch(() => undefined);
    throw new Error(
      'Seller application integration preflight failed. Confirm the guarded test database and migrations; no credentials are shown.',
    );
  }
});

afterAll(async () => {
  await pool?.end();
});

describe('PostgreSQL seller application drafts', () => {
  it('creates an incomplete draft and persists updates across reads', async () => {
    await withAccount(async (accountId) => {
      const created = await getService().createOrGetDraft(accountId, {});

      expect(created.status).toBe('draft');
      expect(created.sellerType).toBeNull();
      expect(created.proposedStoreName).toBeNull();
      expect(created.city).toBe('Yaoundé');

      const updated = await getService().updateDraft(accountId, {
        sellerType: 'individual',
        proposedStoreName: 'Racquets',
      });

      expect(updated.updatedAt).toEqual(UPDATED_AT);

      const readBack = await getService().getDraft(accountId);

      expect(readBack).toMatchObject({
        id: created.id,
        status: 'draft',
        sellerType: 'individual',
        proposedStoreName: 'Racquets',
      });
    });
  });

  it('does not expose or update another account’s draft', async () => {
    const ownerId = await createAccount();
    const otherId = await createAccount();

    try {
      const ownerDraft = await getService().createOrGetDraft(ownerId, {
        proposedStoreName: 'Private shop',
      });

      await expect(getService().getDraft(otherId)).resolves.toBeNull();
      await expect(
        getService().updateDraft(otherId, {
          proposedStoreName: 'Changed by another account',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      await expect(getService().getDraft(ownerId)).resolves.toMatchObject({
        id: ownerDraft.id,
        proposedStoreName: 'Private shop',
      });
    } finally {
      await getPool().query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [ownerId, otherId],
      ]);
    }
  });

  it.each(['suspended', 'pending_email_verification'] as const)(
    'rejects draft creation for %s accounts',
    async (status) => {
      await withAccount(async (accountId) => {
        await expect(
          getService().createOrGetDraft(accountId, {}),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });

        const count = await getPool().query<{ count: number }>(
          'SELECT count(*)::int AS count FROM seller_applications WHERE account_id = $1',
          [accountId],
        );

        expect(count.rows[0]?.count).toBe(0);
      }, status);
    },
  );

  it('returns the same draft for concurrent and repeated creation attempts', async () => {
    await withAccount(async (accountId) => {
      const [first, second] = await Promise.all([
        getService().createOrGetDraft(accountId, {
          proposedStoreName: 'First request',
        }),
        getService().createOrGetDraft(accountId, {
          proposedStoreName: 'Second request',
        }),
      ]);

      expect(second.id).toBe(first.id);
      expect(second.proposedStoreName).toBe(first.proposedStoreName);

      const repeated = await getService().createOrGetDraft(accountId, {
        proposedStoreName: 'Must not overwrite',
      });

      expect(repeated.id).toBe(first.id);
      expect(repeated.proposedStoreName).toBe(first.proposedStoreName);

      const rows = await getPool().query<{ count: number }>(
        'SELECT count(*)::int AS count FROM seller_applications WHERE account_id = $1',
        [accountId],
      );

      expect(rows.rows[0]?.count).toBe(1);

      await expect(
        getPool().query(
          `INSERT INTO seller_applications (account_id, status)
           VALUES ($1, 'draft')`,
          [accountId],
        ),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'seller_applications_one_active_per_account',
      });
    });
  });

  it('clears stale conditional fields and preserves omitted values', async () => {
    await withAccount(async (accountId) => {
      const before = await readAccountState(accountId);

      const created = await getService().createOrGetDraft(accountId, {
        sellerType: 'commercial',
        proposedStoreName: 'Central Racquets',
        city: 'Yaoundé',
        businessTradingName: 'Central Trading',
        registrationStatus: 'registered',
        registrationReference: 'REG-123',
        privateOperatingAddress: 'Test operating address',
      });

      const partialUpdate = await getService().updateDraft(accountId, {
        neighborhood: 'Melen',
      });

      expect(partialUpdate.proposedStoreName).toBe('Central Racquets');
      expect(partialUpdate.city).toBe('Yaoundé');
      expect(partialUpdate.registrationReference).toBe('REG-123');

      const statusChanged = await getService().updateDraft(accountId, {
        registrationStatus: 'registration_pending',
        registrationReference: 'STALE-REFERENCE',
      });

      expect(statusChanged.registrationStatus).toBe('registration_pending');
      expect(statusChanged.registrationReference).toBeNull();

      const switchedToIndividual = await getService().updateDraft(accountId, {
        sellerType: 'individual',
        businessTradingName: 'Stale value',
      });

      expect(switchedToIndividual.businessTradingName).toBeNull();
      expect(switchedToIndividual.businessContactName).toBeNull();
      expect(switchedToIndividual.registrationStatus).toBeNull();
      expect(switchedToIndividual.registrationReference).toBeNull();
      expect(switchedToIndividual.privateOperatingAddress).toBeNull();

      const switchedBack = await getService().updateDraft(accountId, {
        sellerType: 'commercial',
      });

      expect(switchedBack.businessTradingName).toBeNull();
      expect(switchedBack.registrationReference).toBeNull();

      const explicitlyCleared = await getService().updateDraft(accountId, {
        proposedStoreName: null,
      });

      expect(explicitlyCleared.proposedStoreName).toBeNull();
      expect(explicitlyCleared.city).toBe('Yaoundé');
      expect(explicitlyCleared.neighborhood).toBe('Melen');
      expect(created.id).toBe(explicitlyCleared.id);

      await expect(readAccountState(accountId)).resolves.toEqual(before);
    });
  });

  it('does not allow an account with seller permission to start an application', async () => {
    await withAccount(async (accountId) => {
      await getPool().query(
        `INSERT INTO user_permissions (user_id, permission)
         VALUES ($1, 'seller')`,
        [accountId],
      );

      await expect(
        getService().createOrGetDraft(accountId, {}),
      ).rejects.toMatchObject({ code: 'CONFLICT' });

      const result = await getPool().query<{ count: number }>(
        'SELECT count(*)::int AS count FROM seller_applications WHERE account_id = $1',
        [accountId],
      );

      expect(result.rows[0]?.count).toBe(0);
    });
  });
});
