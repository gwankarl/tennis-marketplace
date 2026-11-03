import { serverEnv } from '../../../config/server-env.server';
import {
  requestApi,
  type ApiClientFailure,
  type RuntimeSchema,
} from '../../../lib/api-client.server';
import {
  createCsrfToken,
  isTrustedRegistrationRequest,
} from '../../../lib/security/csrf.server';
import { clearSessionCookie } from '../../../lib/security/session-cookie.server';
import type {
  PasswordResetActionData,
  PasswordResetLoaderData,
  PasswordResetPageState,
} from '../password-reset.types';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const STAGED_TOKEN_COOKIE = 'tx_password_reset_stage';
const STAGED_TOKEN_MAX_AGE_SECONDS = 30 * 60;

export interface PasswordResetFlowResult<T> {
  data: T;
  headers: Headers;
  redirectTo?: string;
}

interface PasswordResetAcknowledgement {
  data: { message: 'Password reset complete.' };
}

const acknowledgementSchema: RuntimeSchema<PasswordResetAcknowledgement> = {
  parse(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('data' in value) ||
      typeof value.data !== 'object' ||
      value.data === null ||
      !('message' in value.data) ||
      value.data.message !== 'Password reset complete.' ||
      Object.keys(value).length !== 1 ||
      Object.keys(value.data).length !== 1
    ) {
      throw new Error('Invalid password reset acknowledgement.');
    }

    return { data: { message: 'Password reset complete.' } };
  },
};

function securityHeaders(): Headers {
  return new Headers({
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
  });
}

function secureCookieAttribute(): string {
  return process.env.NODE_ENV === 'production' ? '; Secure' : '';
}

function stageTokenCookie(token: string): string {
  return (
    `${STAGED_TOKEN_COOKIE}=${token}` +
    '; Path=/reset-password' +
    `; Max-Age=${STAGED_TOKEN_MAX_AGE_SECONDS}` +
    '; HttpOnly; SameSite=Lax' +
    secureCookieAttribute()
  );
}

function clearTokenCookie(): string {
  return (
    `${STAGED_TOKEN_COOKIE}=` +
    '; Path=/reset-password; Max-Age=0' +
    '; Expires=Thu, 01 Jan 1970 00:00:00 GMT' +
    '; HttpOnly; SameSite=Lax' +
    secureCookieAttribute()
  );
}

function readStagedToken(cookieHeader: string | null): {
  present: boolean;
  token: string | null;
} {
  if (!cookieHeader) {
    return { present: false, token: null };
  }

  const prefix = `${STAGED_TOKEN_COOKIE}=`;
  const matches = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(prefix));

  if (matches.length === 0) {
    return { present: false, token: null };
  }

  if (matches.length !== 1) {
    return { present: true, token: null };
  }

  const token = matches[0]!.slice(prefix.length);

  return {
    present: true,
    token: TOKEN_PATTERN.test(token) ? token : null,
  };
}

/** Counts at most 129 code points, preserving the submitted password exactly. */
function isValidPassword(value: string): boolean {
  if (value.length > 256) {
    return false;
  }

  const codePointCount = Array.from(value).length;
  return codePointCount >= 15 && codePointCount <= 128;
}

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function safeFailure(failure: ApiClientFailure): {
  data: PasswordResetActionData;
  clearStagedToken: boolean;
} {
  if (failure.kind === 'backend' && failure.code === 'NOT_FOUND') {
    return {
      data: { state: 'invalid' },
      clearStagedToken: true,
    };
  }

  if (failure.kind === 'backend' && failure.code === 'VALIDATION_ERROR') {
    const details = failure.details ?? [];
    const invalidToken = details.some(
      (detail) =>
        detail.field === 'token' &&
        (detail.code === 'FIELD_REQUIRED' || detail.code === 'FIELD_INVALID'),
    );

    if (invalidToken) {
      return {
        data: { state: 'invalid' },
        clearStagedToken: true,
      };
    }

    const compromisedPassword = details.some(
      (detail) =>
        detail.field === 'password' && detail.code === 'PASSWORD_COMPROMISED',
    );

    if (compromisedPassword) {
      return {
        data: {
          state: 'validation-error',
          passwordError: 'Choose a different password.',
        },
        clearStagedToken: false,
      };
    }

    const invalidPassword = details.some(
      (detail) =>
        detail.field === 'password' &&
        (detail.code === 'FIELD_REQUIRED' || detail.code === 'FIELD_INVALID'),
    );

    if (invalidPassword) {
      return {
        data: {
          state: 'validation-error',
          passwordError: 'Use a password between 15 and 128 characters.',
        },
        clearStagedToken: false,
      };
    }

    return {
      data: {
        state: 'validation-error',
        formError: 'Please review your password and try again.',
      },
      clearStagedToken: false,
    };
  }

  if (failure.kind === 'backend' && failure.code === 'RATE_LIMITED') {
    return {
      data: {
        state: 'rate-limited',
        formError: 'Too many attempts. Please wait and try again later.',
      },
      clearStagedToken: false,
    };
  }

  return {
    data: {
      state: 'temporary-failure',
      formError: 'We could not reset your password. Please try again later.',
    },
    clearStagedToken: false,
  };
}

/**
 * A token-bearing GET only stages the token in a short-lived HttpOnly cookie
 * and redirects to a clean URL. It never contacts the API or consumes the token.
 */
export function loadPasswordResetPage(
  request: Request,
): PasswordResetFlowResult<PasswordResetLoaderData> {
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
        redirectTo: '/reset-password',
      };
    }

    headers.set('Set-Cookie', clearTokenCookie());

    return {
      data: { state: 'invalid', csrfToken: '' },
      headers,
      redirectTo: '/reset-password?state=invalid',
    };
  }

  const staged = readStagedToken(request.headers.get('cookie'));

  if (staged.present && !staged.token) {
    headers.set('Set-Cookie', clearTokenCookie());

    return {
      data: { state: 'invalid', csrfToken: createCsrfToken() },
      headers,
    };
  }

  const state: PasswordResetPageState = staged.token
    ? 'ready'
    : requestUrl.searchParams.get('state') === 'invalid'
      ? 'invalid'
      : 'missing';

  return {
    data: { state, csrfToken: createCsrfToken() },
    headers,
  };
}

/** Confirms a reset only through a same-origin, CSRF-protected POST. */
export async function submitPasswordReset(
  request: Request,
): Promise<PasswordResetFlowResult<PasswordResetActionData>> {
  const headers = securityHeaders();

  if (request.method !== 'POST') {
    return {
      data: {
        state: 'csrf-failure',
        formError: 'Submit the reset form to continue.',
      },
      headers,
    };
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return {
      data: {
        state: 'validation-error',
        formError: 'Please reload the page and try again.',
      },
      headers,
    };
  }

  const submittedCsrfToken = textField(formData, '_csrfToken');

  if (
    !isTrustedRegistrationRequest(
      request.headers.get('origin'),
      submittedCsrfToken,
    )
  ) {
    return {
      data: {
        state: 'csrf-failure',
        formError: 'Your form expired. Reload the page and try again.',
      },
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

  const password = textField(formData, 'password');
  const confirmPassword = textField(formData, 'confirmPassword');

  if (!isValidPassword(password)) {
    return {
      data: {
        state: 'validation-error',
        passwordError: 'Use a password between 15 and 128 characters.',
      },
      headers,
    };
  }

  if (password !== confirmPassword) {
    return {
      data: {
        state: 'validation-error',
        confirmPasswordError: 'Passwords do not match.',
      },
      headers,
    };
  }

  const result = await requestApi(
    serverEnv.API_BASE_URL,
    '/api/v1/auth/confirm-password-reset',
    acknowledgementSchema,
    {
      method: 'POST',
      jsonBody: { token: staged.token, password },
    },
  );

  if (result.ok) {
    // The backend has revoked all sessions; clearing this cookie also
    // invalidates CSRF tokens bound to the old authenticated session.
    headers.append('Set-Cookie', clearTokenCookie());
    headers.append('Set-Cookie', clearSessionCookie());

    return { data: { state: 'success' }, headers };
  }

  const failure = safeFailure(result.error);

  if (failure.clearStagedToken) {
    headers.set('Set-Cookie', clearTokenCookie());
  }

  return {
    data: failure.data,
    headers,
  };
}
