import { serverEnv } from '../../../config/server-env.server';
import {
  requestApi,
  type ApiClientFailure,
  type RuntimeSchema,
} from '../../../lib/api-client.server';
import { isTrustedSessionRequest } from '../../../lib/security/csrf.server';
import {
  clearSessionCookie,
  readSessionCredential,
} from '../../../lib/security/session-cookie.server';
import type {
  ProfileActionResult,
  ProfileLoaderResult,
  UserProfile,
} from '../profile.types';

interface ProfileResponse {
  data: { profile: UserProfile };
}

const profileResponseSchema: RuntimeSchema<ProfileResponse> = {
  parse(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('data' in value) ||
      typeof value.data !== 'object' ||
      value.data === null ||
      !('profile' in value.data) ||
      typeof value.data.profile !== 'object' ||
      value.data.profile === null
    ) {
      throw new Error('Invalid profile response.');
    }

    const profile = value.data.profile;

    if (
      Object.keys(value).length !== 1 ||
      Object.keys(value.data).length !== 1 ||
      Object.keys(profile).length !== 5 ||
      !('firstName' in profile) ||
      typeof profile.firstName !== 'string' ||
      !('lastName' in profile) ||
      typeof profile.lastName !== 'string' ||
      !('email' in profile) ||
      typeof profile.email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email) ||
      !('emailVerified' in profile) ||
      typeof profile.emailVerified !== 'boolean' ||
      !('createdAt' in profile) ||
      typeof profile.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(profile.createdAt))
    ) {
      throw new Error('Invalid profile response.');
    }

    return {
      data: {
        profile: {
          firstName: profile.firstName,
          lastName: profile.lastName,
          email: profile.email,
          emailVerified: profile.emailVerified,
          createdAt: profile.createdAt,
        },
      },
    };
  },
};

function privateHeaders(): Headers {
  return new Headers({
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
  });
}

function loginRedirect(): string {
  return '/login?returnTo=/profile';
}

function isUnauthenticated(failure: ApiClientFailure): boolean {
  return (
    failure.kind === 'backend' &&
    failure.status === 401 &&
    failure.code === 'UNAUTHENTICATED'
  );
}

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function retainName(value: string): string {
  return Array.from(value).length <= 100 ? value.trim() : '';
}

function nameError(value: string): string | undefined {
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  const characters = /^[\p{L}\p{M} '\u2019\u2010-\u2015-]+$/u;

  if (length < 1 || length > 100) {
    return 'Enter a name between 1 and 100 characters.';
  }

  if (!characters.test(normalized) || !/\p{L}/u.test(normalized)) {
    return 'Enter a valid name.';
  }

  return undefined;
}

function mapValidationErrors(
  failure: ApiClientFailure,
): Pick<ProfileActionResult['data'], 'firstNameError' | 'lastNameError'> {
  const errors: Pick<
    ProfileActionResult['data'],
    'firstNameError' | 'lastNameError'
  > = {};

  if (failure.kind !== 'backend' || failure.code !== 'VALIDATION_ERROR') {
    return errors;
  }

  for (const detail of failure.details ?? []) {
    if (detail.code !== 'FIELD_INVALID' && detail.code !== 'FIELD_REQUIRED') {
      continue;
    }

    if (detail.field === 'firstName') {
      errors.firstNameError = 'Enter a valid first name.';
    } else if (detail.field === 'lastName') {
      errors.lastNameError = 'Enter a valid last name.';
    }
  }

  return errors;
}

/** Loads a profile server-side without returning the session credential. */
export async function loadUserProfile(
  request: Request,
): Promise<ProfileLoaderResult> {
  const headers = privateHeaders();
  const credential = readSessionCredential(request.headers.get('cookie'));

  if (!credential) {
    return { headers, redirectTo: loginRedirect() };
  }

  const result = await requestApi(
    serverEnv.API_BASE_URL,
    '/api/v1/users/me',
    profileResponseSchema,
    { method: 'GET', sessionCredential: credential },
  );

  if (result.ok) {
    return {
      data: {
        state: 'ready',
        profile: result.data.data.profile,
        csrfToken: createSessionCsrfTokenForProfile(credential),
      },
      headers,
    };
  }

  if (isUnauthenticated(result.error)) {
    headers.append('Set-Cookie', clearSessionCookie());
    return { headers, redirectTo: loginRedirect() };
  }

  return {
    data: {
      state: 'unavailable',
      message:
        'Your profile is temporarily unavailable. Please try again shortly.',
    },
    headers,
  };
}

function createSessionCsrfTokenForProfile(credential: string): string {
  return createSessionCsrfToken(credential);
}

import { createSessionCsrfToken } from '../../../lib/security/csrf.server';

/** Validates the session-bound form and updates only the supplied profile names. */
export async function runProfileAction(
  request: Request,
): Promise<ProfileActionResult> {
  const headers = privateHeaders();
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return {
      data: { formError: 'Reload the page and try again.' },
      headers,
    };
  }

  const credential = readSessionCredential(request.headers.get('cookie'));

  if (!credential) {
    headers.append('Set-Cookie', clearSessionCookie());
    return { data: {}, headers, redirectTo: loginRedirect() };
  }

  const firstNameInput = textField(formData, 'firstName');
  const lastNameInput = textField(formData, 'lastName');
  const firstName = retainName(firstNameInput);
  const lastName = retainName(lastNameInput);
  const csrfToken = textField(formData, '_csrfToken');

  if (
    !isTrustedSessionRequest(
      request.headers.get('origin'),
      csrfToken,
      credential,
    )
  ) {
    return {
      data: {
        firstName,
        lastName,
        formError: 'Your form expired. Reload the page and try again.',
      },
      headers,
    };
  }

  const firstNameError = nameError(firstNameInput);
  const lastNameError = nameError(lastNameInput);

  if (firstNameError || lastNameError) {
    return {
      data: {
        firstName,
        lastName,
        ...(firstNameError ? { firstNameError } : {}),
        ...(lastNameError ? { lastNameError } : {}),
      },
      headers,
    };
  }

  const result = await requestApi(
    serverEnv.API_BASE_URL,
    '/api/v1/users/me',
    profileResponseSchema,
    {
      method: 'PATCH',
      jsonBody: { firstName, lastName },
      sessionCredential: credential,
    },
  );

  if (result.ok) {
    return {
      data: {
        firstName: result.data.data.profile.firstName,
        lastName: result.data.data.profile.lastName,
        success: true,
      },
      headers,
    };
  }

  if (isUnauthenticated(result.error)) {
    headers.append('Set-Cookie', clearSessionCookie());
    return { data: {}, headers, redirectTo: loginRedirect() };
  }

  const fieldErrors = mapValidationErrors(result.error);

  if (fieldErrors.firstNameError || fieldErrors.lastNameError) {
    return {
      data: { firstName, lastName, ...fieldErrors },
      headers,
    };
  }

  return {
    data: {
      firstName,
      lastName,
      formError: 'We could not update your profile. Please try again later.',
    },
    headers,
  };
}
