import { describe, expect, it, vi } from 'vitest';
import { ApplicationError } from '../../../src/http/application-error.js';
import type {
  SellerApplicationDraftRecord,
  SellerApplicationRepository,
} from '../../../src/modules/seller-onboarding/seller-application.repository.js';
import { createSellerApplicationService } from '../../../src/modules/seller-onboarding/seller-application.service.js';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-06-01T12:00:00.000Z');

const DRAFT: SellerApplicationDraftRecord = {
  id: '00000000-0000-4000-8000-000000000002',
  status: 'draft',
  sellerType: null,
  applicantRelationship: null,
  proposedStoreName: null,
  privateContactPhone: null,
  city: 'Yaoundé',
  neighborhood: null,
  sellerDescription: null,
  inventoryCondition: null,
  fulfillmentOption: null,
  businessTradingName: null,
  businessContactName: null,
  registrationStatus: null,
  registrationReference: null,
  privateOperatingAddress: null,
  createdAt: new Date('2026-05-01T12:00:00.000Z'),
  updatedAt: new Date('2026-05-01T12:00:00.000Z'),
};

function makeRepository() {
  return {
    getDraft: vi.fn(async () => ({ kind: 'ok' as const, value: DRAFT })),
    createOrGetDraft: vi.fn(async () => ({
      kind: 'ok' as const,
      value: DRAFT,
    })),
    updateDraft: vi.fn(async () => ({ kind: 'ok' as const, value: DRAFT })),
  } satisfies SellerApplicationRepository;
}

function failureRepository(reason: string): SellerApplicationRepository {
  const failed = async () => ({
    kind: 'failure' as const,
    reason,
  });

  return {
    getDraft: failed,
    createOrGetDraft: failed,
    updateDraft: failed,
  } as unknown as SellerApplicationRepository;
}

describe('seller application service', () => {
  it('delegates draft reads and creation to the repository', async () => {
    const repository = makeRepository();
    const service = createSellerApplicationService({ repository });

    await expect(service.getDraft(ACCOUNT_ID)).resolves.toEqual(DRAFT);
    await expect(
      service.createOrGetDraft(ACCOUNT_ID, {
        proposedStoreName: 'Racquets',
      }),
    ).resolves.toEqual(DRAFT);

    expect(repository.getDraft).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(repository.createOrGetDraft).toHaveBeenCalledWith(ACCOUNT_ID, {
      proposedStoreName: 'Racquets',
    });
  });

  it('passes the injected clock to draft updates', async () => {
    const repository = makeRepository();
    const service = createSellerApplicationService({
      repository,
      now: () => NOW,
    });

    await service.updateDraft(ACCOUNT_ID, { city: 'Douala' });

    expect(repository.updateDraft).toHaveBeenCalledWith(
      ACCOUNT_ID,
      { city: 'Douala' },
      NOW,
    );
  });

  it.each([
    ['account_ineligible', 'FORBIDDEN'],
    ['seller_exists', 'CONFLICT'],
    ['application_closed', 'CONFLICT'],
    ['application_not_editable', 'CONFLICT'],
    ['draft_not_found', 'NOT_FOUND'],
  ])(
    'maps repository failure %s to the established application error',
    async (reason, expectedCode) => {
      const service = createSellerApplicationService({
        repository: failureRepository(reason),
      });

      await expect(service.getDraft(ACCOUNT_ID)).rejects.toMatchObject({
        code: expectedCode,
      });
    },
  );

  it('does not expose database details when mapping expected failures', async () => {
    const service = createSellerApplicationService({
      repository: failureRepository('account_ineligible'),
    });

    await expect(service.getDraft(ACCOUNT_ID)).rejects.toBeInstanceOf(
      ApplicationError,
    );
  });
});
