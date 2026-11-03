import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadCurrentSessionMock } = vi.hoisted(() => ({
  loadCurrentSessionMock: vi.fn(),
}));

vi.mock('../../../app/lib/security/auth-session.server', () => ({
  loadCurrentSession: loadCurrentSessionMock,
}));

import { loadWorkspaceAccess } from '../../../app/features/identity/server/workspace-access.server';

const credential = Buffer.alloc(32, 5).toString('base64url');
const cookie = `tx_session=${credential}`;

const authenticatedSession = {
  kind: 'authenticated' as const,
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'player@example.test',
    firstName: 'Test',
    lastName: 'Player',
    isAdministrator: false,
    workspaces: ['buyer', 'seller'] as const,
  },
};

function request(withCookie = true): Request {
  return new Request('http://localhost:5173/seller', {
    headers: withCookie ? { cookie } : undefined,
  });
}

beforeEach(() => {
  loadCurrentSessionMock.mockReset();
});

describe('workspace access loader helper', () => {
  it('redirects anonymous users with private response headers', async () => {
    loadCurrentSessionMock.mockResolvedValue({ kind: 'anonymous' });

    const result = await loadWorkspaceAccess(
      request(false),
      '/seller',
      'seller',
    );

    expect(result.state).toBe('redirect');
    if (result.state !== 'redirect') return;

    expect(result.response.headers.get('location')).toBe(
      '/login?returnTo=%2Fseller',
    );
    expect(result.response.headers.get('cache-control')).toContain('no-store');
    expect(result.response.headers.has('set-cookie')).toBe(false);
  });

  it('clears the cookie only after the backend rejects the session', async () => {
    loadCurrentSessionMock.mockResolvedValue({ kind: 'unauthenticated' });

    const result = await loadWorkspaceAccess(request(), '/seller', 'seller');

    expect(result.state).toBe('redirect');
    if (result.state !== 'redirect') return;

    expect(result.response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(result.response.headers.get('cache-control')).toContain('no-store');
  });

  it('does not clear the cookie when the backend is unavailable', async () => {
    loadCurrentSessionMock.mockResolvedValue({ kind: 'unavailable' });

    const result = await loadWorkspaceAccess(request(), '/seller', 'seller');

    expect(result.state).toBe('unavailable');
    if (result.state !== 'unavailable') return;

    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(result.headers.has('set-cookie')).toBe(false);
  });

  it('returns forbidden when the current session lacks the required workspace', async () => {
    loadCurrentSessionMock.mockResolvedValue({
      ...authenticatedSession,
      user: { ...authenticatedSession.user, workspaces: ['buyer'] },
    });

    const result = await loadWorkspaceAccess(request(), '/seller', 'seller');

    expect(result.state).toBe('forbidden');
    if (result.state !== 'forbidden') return;

    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(JSON.stringify(result)).not.toContain(credential);
  });

  it('returns safe identity and a session-bound CSRF token for an allowed workspace', async () => {
    loadCurrentSessionMock.mockResolvedValue(authenticatedSession);

    const result = await loadWorkspaceAccess(request(), '/seller', 'seller');

    expect(result.state).toBe('ready');
    if (result.state !== 'ready') return;

    expect(result.user.workspaces).toEqual(['buyer', 'seller']);
    expect(result.csrfToken).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain(credential);
    expect(result.headers.get('cache-control')).toContain('no-store');
  });
});
