import { redirect } from 'react-router';
import { loadCurrentSession } from '../../../lib/security/auth-session.server';
import type {
  SessionUser,
  WorkspaceKey,
} from '../../../lib/security/auth-session.server';
import { createSessionCsrfToken } from '../../../lib/security/csrf.server';
import {
  clearSessionCookie,
  readSessionCredential,
} from '../../../lib/security/session-cookie.server';

export type WorkspaceAccessResult =
  | {
      state: 'ready';
      user: SessionUser;
      csrfToken: string;
      headers: Headers;
    }
  | { state: 'redirect'; response: Response }
  | { state: 'unavailable'; headers: Headers }
  | { state: 'forbidden'; headers: Headers };

function privateHeaders(): Headers {
  return new Headers({
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
  });
}

/**
 * Resolves workspace access from the backend's current-session response.
 * The session credential is used only server-side and never returned.
 */
export async function loadWorkspaceAccess(
  request: Request,
  returnTo: '/account' | '/seller' | '/admin',
  requiredWorkspace?: WorkspaceKey,
): Promise<WorkspaceAccessResult> {
  const headers = privateHeaders();
  const cookieHeader = request.headers.get('cookie');
  const loginPath = `/login?returnTo=${encodeURIComponent(returnTo)}`;
  const session = await loadCurrentSession(cookieHeader);

  if (session.kind === 'anonymous') {
    return {
      state: 'redirect',
      response: redirect(loginPath, { headers }),
    };
  }

  if (session.kind === 'unauthenticated') {
    headers.append('Set-Cookie', clearSessionCookie());

    return {
      state: 'redirect',
      response: redirect(loginPath, { headers }),
    };
  }

  if (session.kind === 'unavailable') {
    return { state: 'unavailable', headers };
  }

  if (
    requiredWorkspace &&
    !session.user.workspaces.includes(requiredWorkspace)
  ) {
    return { state: 'forbidden', headers };
  }

  const credential = readSessionCredential(cookieHeader);

  if (!credential) {
    headers.append('Set-Cookie', clearSessionCookie());

    return {
      state: 'redirect',
      response: redirect(loginPath, { headers }),
    };
  }

  return {
    state: 'ready',
    user: session.user,
    csrfToken: createSessionCsrfToken(credential),
    headers,
  };
}
