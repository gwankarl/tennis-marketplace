import { serverEnv } from '../../config/server-env.server';
import { requestApi, type RuntimeSchema } from '../api-client.server';
import { readSessionCredential } from './session-cookie.server';

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isAdministrator: boolean;
}

interface SessionResponse {
  data: { user: SessionUser };
}

export type SessionLookup =
  | { kind: 'anonymous' }
  | { kind: 'unauthenticated' }
  | { kind: 'unavailable' }
  | { kind: 'authenticated'; user: SessionUser };

const sessionResponseSchema: RuntimeSchema<SessionResponse> = {
  parse(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('data' in value) ||
      typeof value.data !== 'object' ||
      value.data === null ||
      !('user' in value.data) ||
      typeof value.data.user !== 'object' ||
      value.data.user === null
    ) {
      throw new Error('Invalid session response.');
    }

    const user = value.data.user;

    if (
      Object.keys(value).length !== 1 ||
      Object.keys(value.data).length !== 1 ||
      Object.keys(user).length !== 5 ||
      !('id' in user) ||
      typeof user.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        user.id,
      ) ||
      !('email' in user) ||
      typeof user.email !== 'string' ||
      !('firstName' in user) ||
      typeof user.firstName !== 'string' ||
      !('lastName' in user) ||
      typeof user.lastName !== 'string' ||
      !('isAdministrator' in user) ||
      typeof user.isAdministrator !== 'boolean'
    ) {
      throw new Error('Invalid session response.');
    }

    return {
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          isAdministrator: user.isAdministrator,
        },
      },
    };
  },
};

/**
 * Resolves the current identity server-side. The session credential is read
 * from the HttpOnly cookie and is never included in the returned result.
 */
export async function loadCurrentSession(
  cookieHeader: string | null,
): Promise<SessionLookup> {
  const credential = readSessionCredential(cookieHeader);

  if (!credential) {
    return { kind: 'anonymous' };
  }

  const result = await requestApi(
    serverEnv.API_BASE_URL,
    '/api/v1/auth/session',
    sessionResponseSchema,
    {
      method: 'GET',
      sessionCredential: credential,
    },
  );

  if (result.ok) {
    return {
      kind: 'authenticated',
      user: result.data.data.user,
    };
  }

  if (
    result.error.kind === 'backend' &&
    result.error.status === 401 &&
    result.error.code === 'UNAUTHENTICATED'
  ) {
    return { kind: 'unauthenticated' };
  }

  // Network, timeout, backend, and invalid-contract failures do not prove
  // that the browser's session credential is invalid. Keep its cookie.
  return { kind: 'unavailable' };
}
