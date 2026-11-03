import { serverEnv } from '../../config/server-env.server';
import { isTrustedRegistrationRequest } from '../../lib/csrf.server';
import { createSessionCookie } from '../../lib/session-cookie.server';
import { safeReturnTo } from '../../lib/return-to.server';
import {
  requestApi,
  type ApiClientFailure,
  type RuntimeSchema,
} from '../../lib/api-client.server';
import type { LoginActionData } from './login.types';

interface LoginResponse {
  data: {
    credential: string;
    absoluteExpiresAt: string;
    user: {
      id: string;
      firstName: string;
      lastName: string;
      isAdministrator: boolean;
    };
  };
}

export interface LoginActionResult {
  data: LoginActionData;
  headers: Headers;
  redirectTo?: string;
}

const loginResponseSchema: RuntimeSchema<LoginResponse> = {
  parse(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('data' in value) ||
      typeof value.data !== 'object' ||
      value.data === null
    ) {
      throw new Error('Invalid login response.');
    }

    const data = value.data;

    if (
      Object.keys(value).length !== 1 ||
      Object.keys(data).length !== 3 ||
      !('credential' in data) ||
      typeof data.credential !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(data.credential) ||
      !('absoluteExpiresAt' in data) ||
      typeof data.absoluteExpiresAt !== 'string' ||
      !Number.isFinite(Date.parse(data.absoluteExpiresAt)) ||
      !('user' in data) ||
      typeof data.user !== 'object' ||
      data.user === null
    ) {
      throw new Error('Invalid login response.');
    }

    const user = data.user;

    if (
      Object.keys(user).length !== 4 ||
      !('id' in user) ||
      typeof user.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        user.id,
      ) ||
      !('firstName' in user) ||
      typeof user.firstName !== 'string' ||
      !('lastName' in user) ||
      typeof user.lastName !== 'string' ||
      !('isAdministrator' in user) ||
      typeof user.isAdministrator !== 'boolean'
    ) {
      throw new Error('Invalid login response.');
    }

    return {
      data: {
        credential: data.credential,
        absoluteExpiresAt: data.absoluteExpiresAt,
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          isAdministrator: user.isAdministrator,
        },
      },
    };
  },
};

function safeEmail(value: string): string {
  return value.trim().slice(0, 254);
}

function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function noStoreHeaders(): Headers {
  return new Headers({
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
  });
}

function mapApiFailure(failure: ApiClientFailure): LoginActionData {
  if (failure.kind === 'backend') {
    if (failure.code === 'UNAUTHENTICATED') {
      return { email: '', formError: 'Email or password is incorrect.' };
    }

    if (failure.code === 'EMAIL_VERIFICATION_REQUIRED') {
      return {
        email: '',
        formError: 'Verify your email address before signing in.',
        needsVerification: true,
      };
    }

    if (failure.code === 'ACCOUNT_RESTRICTED') {
      return {
        email: '',
        formError: 'This account cannot sign in. Contact support for help.',
      };
    }

    if (failure.code === 'RATE_LIMITED') {
      return {
        email: '',
        formError: 'Too many attempts. Please wait and try again.',
      };
    }
  }

  return {
    email: '',
    formError: 'Sign-in is temporarily unavailable. Please try again later.',
  };
}

/**
 * Posts login credentials only from the server, then converts a valid backend
 * session credential into an HttpOnly cookie. Passwords and credentials are
 * never included in action data.
 */
export async function runLoginAction(
  request: Request,
): Promise<LoginActionResult> {
  const headers = noStoreHeaders();
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return {
      data: {
        email: '',
        formError: 'Please reload the page and try again.',
      },
      headers,
    };
  }

  const email = safeEmail(
    typeof formData.get('email') === 'string'
      ? (formData.get('email') as string)
      : '',
  );
  const passwordValue = formData.get('password');
  const password = typeof passwordValue === 'string' ? passwordValue : '';
  const csrfValue = formData.get('_csrfToken');
  const csrfToken = typeof csrfValue === 'string' ? csrfValue : '';
  const returnToValue = formData.get('_returnTo');

  if (!isTrustedRegistrationRequest(request.headers.get('origin'), csrfToken)) {
    return {
      data: {
        email,
        formError: 'Your form expired. Reload the page and try again.',
      },
      headers,
    };
  }

  const errors: Pick<LoginActionData, 'emailError' | 'passwordError'> = {};

  if (!validEmail(email)) {
    errors.emailError = 'Enter a valid email address.';
  }

  if (Array.from(password).length > 1024) {
    errors.passwordError = 'Password is too long.';
  }

  if (Object.keys(errors).length > 0) {
    return { data: { email, ...errors }, headers };
  }

  const result = await requestApi(
    serverEnv.API_BASE_URL,
    '/api/v1/auth/login',
    loginResponseSchema,
    {
      method: 'POST',
      jsonBody: { email: email.toLowerCase(), password },
    },
  );

  if (!result.ok) {
    const failure = mapApiFailure(result.error);
    return {
      data: {
        ...failure,
        email,
      },
      headers,
    };
  }

  const cookie = createSessionCookie(
    result.data.data.credential,
    result.data.data.absoluteExpiresAt,
  );

  if (!cookie) {
    return {
      data: {
        email,
        formError:
          'Sign-in is temporarily unavailable. Please try again later.',
      },
      headers,
    };
  }

  headers.append('Set-Cookie', cookie);

  return {
    data: { email: '' },
    headers,
    redirectTo: safeReturnTo(returnToValue),
  };
}
