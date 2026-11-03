import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverEnv } from '../../../app/config/server-env.server';
import { runSellerApplicationAction } from '../../../app/features/seller-onboarding/server/seller-application.server';
import { createSessionCsrfToken } from '../../../app/lib/security/csrf.server';
import {
  SELLER_APPLICATION_DRAFT,
  SELLER_APPLICATION_FORM_VALUES,
  sellerApplicationResponse,
} from '../../support/seller-application-fixtures';

const { loadWorkspaceAccessMock } = vi.hoisted(() => ({
  loadWorkspaceAccessMock: vi.fn(),
}));

vi.mock(
  '../../../app/features/identity/server/workspace-access.server',
  () => ({ loadWorkspaceAccess: loadWorkspaceAccessMock }),
);

const credential = Buffer.alloc(32, 7).toString('base64url');
const cookie = `tx_session=${credential}`;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockReadyWorkspaceAccess() {
  loadWorkspaceAccessMock.mockResolvedValue({
    state: 'ready',
    user: {
      id: '00000000-0000-4000-8000-000000000002',
      email: 'player@example.test',
      firstName: 'Test',
      lastName: 'Player',
      isAdministrator: false,
      workspaces: ['buyer'],
    },
    csrfToken: 'session-bound-csrf-token',
    headers: new Headers({
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
    }),
  });
}

function actionRequest(
  overrides: Record<string, string> = {},
  origin = serverEnv.APP_ORIGIN,
): Request {
  const body = new URLSearchParams({
    ...SELLER_APPLICATION_FORM_VALUES,
    _csrfToken: createSessionCsrfToken(credential),
    ...overrides,
  });

  return new Request(`${serverEnv.APP_ORIGIN}/seller-application`, {
    method: 'POST',
    headers: {
      cookie,
      origin,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  loadWorkspaceAccessMock.mockReset();
  mockReadyWorkspaceAccess();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('seller application draft action', () => {
  it('creates an empty draft when needed, then saves only the allowlisted form fields', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(sellerApplicationResponse(null)))
      .mockResolvedValueOnce(jsonResponse(sellerApplicationResponse()))
      .mockResolvedValueOnce(jsonResponse(sellerApplicationResponse()));

    const result = await runSellerApplicationAction(actionRequest());

    expect(result.data?.success).toBe(true);
    expect(result.data?.application).toEqual(SELLER_APPLICATION_DRAFT);
    expect(result.headers?.get('cache-control')).toContain('no-store');
    expect(JSON.stringify(result)).not.toContain(credential);

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls.map(([, init]) => init?.method)).toEqual([
      'GET',
      'POST',
      'PATCH',
    ]);
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toEqual({});
    expect(JSON.parse(String(calls[2]?.[1]?.body))).toEqual({
      sellerType: 'individual',
      applicantRelationship: 'owner',
      proposedStoreName: 'Racquets Yaoundé',
      privateContactPhone: '+237 6 12 34 56 78',
      city: 'Yaoundé',
      neighborhood: 'Bastos',
      sellerDescription: 'Independent tennis equipment seller.',
      inventoryCondition: 'both',
      fulfillmentOption: 'pickup',
      businessTradingName: '',
      businessContactName: '',
      registrationStatus: null,
      registrationReference: '',
      privateOperatingAddress: '',
    });

    for (const [, init] of calls) {
      expect(new Headers(init?.headers).get('authorization')).toBe(
        `Bearer ${credential}`,
      );
      expect(String(init?.body)).not.toContain('_csrfToken');
    }
  });

  it('patches an existing draft and maps backend field errors to safe messages', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse(sellerApplicationResponse(SELLER_APPLICATION_DRAFT)),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Private backend message.',
              details: [
                {
                  field: 'privateContactPhone',
                  code: 'FIELD_INVALID',
                  message: 'Private validation detail.',
                },
              ],
            },
            meta: { requestId: 'private-request-id' },
          },
          422,
        ),
      );

    const result = await runSellerApplicationAction(
      actionRequest({ city: 'Douala' }),
    );

    expect(result.data?.values?.city).toBe('Douala');
    expect(result.data?.fieldErrors?.privateContactPhone).toMatch(
      /valid contact phone/i,
    );
    expect(result.data?.formError).toMatch(/highlighted fields/i);
    expect(JSON.stringify(result)).not.toMatch(
      /Private backend message|Private validation detail|private-request-id/,
    );
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[1]?.[1]?.method).toBe('PATCH');
  });

  it('rejects an untrusted origin before contacting the backend', async () => {
    const result = await runSellerApplicationAction(
      actionRequest({}, 'https://attacker.invalid'),
    );

    expect(result.data?.formError).toMatch(/form expired/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the session cookie and submitted values after a network failure', async () => {
    vi.mocked(fetch).mockRejectedValue(
      new Error('private database URL and credentials'),
    );

    const result = await runSellerApplicationAction(
      actionRequest({ city: 'Douala' }),
    );

    expect(result.data?.values?.city).toBe('Douala');
    expect(result.data?.formError).toMatch(/could not save the draft/i);
    expect(result.headers?.has('set-cookie')).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(
      /private database URL|credentials|credential/,
    );
  });
});
