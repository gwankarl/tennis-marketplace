import { serverEnv } from '../../config/server-env.server';
import { isTrustedSessionRequest } from '../../lib/csrf.server';
import { requestApi, type RuntimeSchema } from '../../lib/api-client.server';
import {
  clearSessionCookie,
  readSessionCredential,
} from '../../lib/session-cookie.server';

interface LogoutResponse {
  data: { message: 'Logged out.' };
}

export interface LogoutActionData {
  formError?: string;
}

export interface LogoutActionResult {
  data?: LogoutActionData;
  headers: Headers;
  redirectTo?: string;
}

const logoutResponseSchema: RuntimeSchema<LogoutResponse> = {
  parse(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('data' in value) ||
      typeof value.data !== 'object' ||
      value.data === null ||
      !('message' in value.data) ||
      value.data.message !== 'Logged out.' ||
      Object.keys(value).length !== 1 ||
      Object.keys(value.data).length !== 1
    ) {
      throw new Error('Invalid logout response.');
    }

    return { data: { message: 'Logged out.' } };
  },
};

function responseHeaders(): Headers {
  return new Headers({
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
  });
}

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/**
 * Validates session-bound CSRF before requesting revocation. The browser
 * cookie is cleared after either a confirmed or uncertain backend outcome.
 */
export async function runLogoutAction(
  request: Request,
): Promise<LogoutActionResult> {
  const headers = responseHeaders();
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return {
      data: { formError: 'Reload the page and try signing out again.' },
      headers,
    };
  }

  const credential = readSessionCredential(request.headers.get('cookie'));

  if (
    !credential ||
    !isTrustedSessionRequest(
      request.headers.get('origin'),
      textField(formData, '_csrfToken'),
      credential,
    )
  ) {
    return {
      data: { formError: 'Your sign-out form expired. Reload and try again.' },
      headers,
    };
  }

  const result = await requestApi(
    serverEnv.API_BASE_URL,
    '/api/v1/auth/logout',
    logoutResponseSchema,
    {
      method: 'POST',
      jsonBody: {},
      sessionCredential: credential,
    },
  );

  headers.append('Set-Cookie', clearSessionCookie());

  if (result.ok) {
    return {
      headers,
      redirectTo: '/login?logout=success',
    };
  }

  // The browser session is cleared, but an outage may have prevented the
  // backend from confirming revocation of the server-side session.
  return {
    headers,
    redirectTo: '/login?logout=unconfirmed',
  };
}
