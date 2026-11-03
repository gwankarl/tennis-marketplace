import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../../src/app.js';
import type { SessionService } from '../../../src/modules/identity/sessions/session.service.js';
import type { SellerApplicationDraftRecord } from '../../../src/modules/seller-onboarding/seller-application.repository.js';
import type { SellerApplicationService } from '../../../src/modules/seller-onboarding/seller-application.service.js';

const CREDENTIAL = 'A'.repeat(43);
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';

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

function makeApp(accountId: string | null = ACCOUNT_ID) {
  const service: SellerApplicationService = {
    getDraft: vi.fn(async () => DRAFT),
    createOrGetDraft: vi.fn(async () => DRAFT),
    updateDraft: vi.fn(async () => DRAFT),
  };

  const sessions = {
    current: vi.fn(async () =>
      accountId
        ? {
            sessionId: '00000000-0000-4000-8000-000000000003',
            userId: accountId,
            email: 'player@example.test',
            firstName: 'Test',
            lastName: 'Player',
            isAdministrator: false,
          }
        : null,
    ),
  } as unknown as Pick<SessionService, 'current'>;

  return {
    app: buildApp({ sellerApplication: { service, sessions } }),
    service,
    sessions,
  };
}

describe('seller application draft routes', () => {
  it('returns the current owner draft with private no-store headers', async () => {
    const { app, service } = makeApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/seller-applications/me',
        headers: { authorization: `Bearer ${CREDENTIAL}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.pragma).toBe('no-cache');
      expect(response.json().data.application).toMatchObject({
        id: DRAFT.id,
        status: 'draft',
        city: 'Yaoundé',
      });
      expect(response.json().data.application).not.toHaveProperty('accountId');
      expect(service.getDraft).toHaveBeenCalledWith(ACCOUNT_ID);
    } finally {
      await app.close();
    }
  });

  it('returns a null application when no draft exists', async () => {
    const { app, service } = makeApp();
    vi.mocked(service.getDraft).mockResolvedValueOnce(null);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/seller-applications/me',
        headers: { authorization: `Bearer ${CREDENTIAL}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        data: { application: null },
      });
    } finally {
      await app.close();
    }
  });

  it('derives the owner from the session and accepts an empty create request', async () => {
    const { app, service } = makeApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/seller-applications/me',
        headers: { authorization: `Bearer ${CREDENTIAL}` },
      });

      expect(response.statusCode).toBe(200);
      expect(service.createOrGetDraft).toHaveBeenCalledWith(ACCOUNT_ID, {});
    } finally {
      await app.close();
    }
  });

  it('passes only validated draft fields to PATCH for the session owner', async () => {
    const { app, service } = makeApp();

    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/seller-applications/me',
        headers: { authorization: `Bearer ${CREDENTIAL}` },
        payload: { city: '  Douala  ' },
      });

      expect(response.statusCode).toBe(200);
      expect(service.updateDraft).toHaveBeenCalledWith(ACCOUNT_ID, {
        city: 'Douala',
      });
    } finally {
      await app.close();
    }
  });

  it.each(['accountId', 'permissions', 'status', 'email'])(
    'rejects protected or unknown field %s',
    async (field) => {
      const { app, service } = makeApp();
      const payload = {
        proposedStoreName: 'Racquets',
        [field]: 'attacker-value',
      };

      try {
        const response = await app.inject({
          method: 'PATCH',
          url: '/api/v1/seller-applications/me',
          headers: { authorization: `Bearer ${CREDENTIAL}` },
          payload,
        });

        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe('VALIDATION_ERROR');
        expect(service.updateDraft).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    },
  );

  it('rejects an empty PATCH and an unauthenticated request', async () => {
    const authenticated = makeApp();

    try {
      const emptyPatch = await authenticated.app.inject({
        method: 'PATCH',
        url: '/api/v1/seller-applications/me',
        headers: { authorization: `Bearer ${CREDENTIAL}` },
        payload: {},
      });

      expect(emptyPatch.statusCode).toBe(422);
      expect(authenticated.service.updateDraft).not.toHaveBeenCalled();
    } finally {
      await authenticated.app.close();
    }

    const anonymous = makeApp(null);

    try {
      const response = await anonymous.app.inject({
        method: 'POST',
        url: '/api/v1/seller-applications/me',
        headers: { authorization: `Bearer ${CREDENTIAL}` },
        payload: { proposedStoreName: 'Racquets' },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('UNAUTHENTICATED');
      expect(anonymous.service.createOrGetDraft).not.toHaveBeenCalled();
    } finally {
      await anonymous.app.close();
    }
  });
});
