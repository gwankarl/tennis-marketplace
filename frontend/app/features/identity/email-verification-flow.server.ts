import { serverEnv } from '../../config/server-env.server';
import {
  createCsrfToken,
  isTrustedRegistrationRequest,
} from '../../lib/csrf.server';
import { requestApi, type RuntimeSchema } from '../../lib/api-client.server';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const STAGED_TOKEN_COOKIE = 'tx_email_verification_stage';
const STAGED_TOKEN_MAX_AGE_SECONDS = 15 * 60;

export type VerificationPageState = 'ready' | 'missing' | 'invalid';

export type VerificationActionState =
  'success' | 'invalid' | 'missing' | 'csrf-failure' | 'temporary-failure';

export interface VerificationLoaderData {
  state: VerificationPageState;
  csrfToken: string;
}

export interface VerificationActionData {
  state: VerificationActionState;
}

export interface VerificationFlowResult<T> {
  data: T;
  headers: Headers;
  redirectTo?: string;
}

interface VerificationAcknowledgement {
  data: { message: 'Email address verified.' };
}

const acknowledgementSchema: RuntimeSchema<VerificationAcknowledgement> = {
  parse(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('data' in value) ||
      typeof value.data !== 'object' ||
      value.data === null ||
      !('message' in value.data) ||
      value.data.message !== 'Email address verified.' ||
      Object.keys(value).length !== 1 ||
      Object.keys(value.data).length !== 1
    ) {
      throw new Error('Invalid email verification acknowledgement.');
    }

    return { data: { message: 'Email address verified.' } };
  },
};

function securityHeaders(): Headers {
  return new Headers({
    'Cache-Control': 'no-store, max-age=0',
    'Referrer-Policy': 'strict-origin',
  });
}

function secureCookieAttribute(): string {
  return process.env.NODE_ENV === 'production' ? '; Secure' : '';
}

function stageTokenCookie(token: string): string {
  return (
    `${STAGED_TOKEN_COOKIE}=${token}` +
    `; Path=/verify-email` +
    `; Max-Age=${STAGED_TOKEN_MAX_AGE_SECONDS}` +
    '; HttpOnly; SameSite=Lax' +
    secureCookieAttribute()
  );
}

function clearTokenCookie(): string {
  return (
    `${STAGED_TOKEN_COOKIE}=` +
    '; Path=/verify-email; Max-Age=0' +
    '; Expires=Thu, 01 Jan 1970 00:00:00 GMT' +
    '; HttpOnly; SameSite=Lax' +
    secureCookieAttribute()
  );
}

function readStagedToken(cookieHeader: string | null): {
  present: boolean;
  token: string | null;
} {
  const prefix = `${STAGED_TOKEN_COOKIE}=`;
  const entry = cookieHeader
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  if (!entry) {
    return { present: false, token: null };
  }

  const token = entry.slice(prefix.length);
  return {
    present: true,
    token: TOKEN_PATTERN.test(token) ? token : null,
  };
}

/**
 * A token-bearing GET only stages the token in an HttpOnly cookie and redirects
 * to a clean URL. It never calls the backend or changes account state.
 */
export function loadEmailVerificationPage(
  request: Request,
): VerificationFlowResult<VerificationLoaderData> {
  const headers = securityHeaders();
  const requestUrl = new URL(request.url);

  if (requestUrl.searchParams.has('token')) {
    const suppliedTokens = requestUrl.searchParams.getAll('token');
    const token = suppliedTokens.length === 1 ? suppliedTokens[0] : undefined;

    if (token && TOKEN_PATTERN.test(token)) {
      headers.set('Set-Cookie', stageTokenCookie(token));
      return {
        data: { state: 'ready', csrfToken: '' },
        headers,
        redirectTo: '/verify-email',
      };
    }

    headers.set('Set-Cookie', clearTokenCookie());
    return {
      data: { state: 'invalid', csrfToken: '' },
      headers,
      redirectTo: '/verify-email?state=invalid',
    };
  }

  const staged = readStagedToken(request.headers.get('cookie'));

  if (staged.present && !staged.token) {
    headers.set('Set-Cookie', clearTokenCookie());
    return {
      data: { state: 'invalid', csrfToken: '' },
      headers,
    };
  }

  const state: VerificationPageState = staged.token
    ? 'ready'
    : requestUrl.searchParams.get('state') === 'invalid'
      ? 'invalid'
      : 'missing';

  return {
    data: { state, csrfToken: createCsrfToken() },
    headers,
  };
}

/** Completes verification only after a same-origin, CSRF-protected POST. */
export async function submitEmailVerification(
  request: Request,
  csrfToken: string,
): Promise<VerificationFlowResult<VerificationActionData>> {
  const headers = securityHeaders();
  const formData = await request.formData();
  const submittedCsrfToken = formData.get('_csrfToken');

  if (
    typeof submittedCsrfToken !== 'string' ||
    !isTrustedRegistrationRequest(
      request.headers.get('origin'),
      submittedCsrfToken,
    )
  ) {
    return {
      data: { state: 'csrf-failure' },
      headers,
    };
  }

  const staged = readStagedToken(request.headers.get('cookie'));

  if (!staged.token) {
    if (staged.present) {
      headers.set('Set-Cookie', clearTokenCookie());
      return { data: { state: 'invalid' }, headers };
    }

    return { data: { state: 'missing' }, headers };
  }

  // The browser sends only the staging cookie. The token is forwarded in the
  // server-to-server POST body and is never returned in route data.
  const result = await requestApi(
    serverEnv.API_BASE_URL,
    '/api/v1/auth/verify-email',
    acknowledgementSchema,
    {
      method: 'POST',
      jsonBody: { token: staged.token },
    },
  );

  if (result.ok) {
    headers.set('Set-Cookie', clearTokenCookie());
    return { data: { state: 'success' }, headers };
  }

  if (
    result.error.kind === 'backend' &&
    (result.error.code === 'NOT_FOUND' ||
      result.error.code === 'VALIDATION_ERROR')
  ) {
    headers.set('Set-Cookie', clearTokenCookie());
    return { data: { state: 'invalid' }, headers };
  }

  // Retain the staging cookie for a retry after temporary/network failures.
  return { data: { state: 'temporary-failure' }, headers };
}
