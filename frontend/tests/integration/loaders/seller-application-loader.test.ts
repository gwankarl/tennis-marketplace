import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverEnv } from '../../../app/config/server-env.server';
import { loadSellerApplicationDraft } from '../../../app/features/seller-onboarding/server/seller-application.server';
import {
  SELLER_APPLICATION_DRAFT,
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
const privateHeaders = () =>
  new Headers({ 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' });

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
    headers: privateHeaders(),
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

describe('seller application draft loader', () => {
  it('loads the owner-scoped draft server-side without returning the session credential', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(sellerApplicationResponse()),
    );

    const result = await loadSellerApplicationDraft(
      new Request(`${serverEnv.APP_ORIGIN}/seller-application`, {
        headers: { cookie },
      }),
    );

    expect(result.data).toMatchObject({
      state: 'ready',
      application: SELLER_APPLICATION_DRAFT,
      csrfToken: 'session-bound-csrf-token',
    });
    expect(result.headers?.get('cache-control')).toContain('no-store');
    expect(JSON.stringify(result)).not.toContain(credential);

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('/api/v1/seller-applications/me');
    expect(init?.method).toBe('GET');
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Bearer ${credential}`,
    );
  });

  it('returns an empty ready state when the account has no draft', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(sellerApplicationResponse(null)),
    );

    const result = await loadSellerApplicationDraft(
      new Request(`${serverEnv.APP_ORIGIN}/seller-application`, {
        headers: { cookie },
      }),
    );

    expect(result.data).toMatchObject({
      state: 'ready',
      application: null,
    });
  });

  it('clears the cookie and redirects only after an explicit backend 401', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'UNAUTHENTICATED',
            message: 'Private backend message.',
          },
          meta: { requestId: 'private-request-id' },
        },
        401,
      ),
    );

    const result = await loadSellerApplicationDraft(
      new Request(`${serverEnv.APP_ORIGIN}/seller-application`, {
        headers: { cookie },
      }),
    );

    expect(result.redirectTo).toBe('/login?returnTo=%2Fseller-application');
    expect(result.headers?.get('set-cookie')).toContain('Max-Age=0');
    expect(JSON.stringify(result)).not.toMatch(
      /Private backend message|private-request-id|credential/,
    );
  });

  it('keeps the session cookie when the backend is temporarily unavailable', async () => {
    vi.mocked(fetch).mockRejectedValue(
      new Error('private database connection detail'),
    );

    const result = await loadSellerApplicationDraft(
      new Request(`${serverEnv.APP_ORIGIN}/seller-application`, {
        headers: { cookie },
      }),
    );

    expect(result.data).toMatchObject({ state: 'unavailable' });
    expect(result.headers?.has('set-cookie')).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(
      /private database connection detail|credential/,
    );
  });
});
