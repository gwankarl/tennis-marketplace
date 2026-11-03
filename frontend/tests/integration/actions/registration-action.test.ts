import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serverEnv } from '../../../app/config/server-env.server';
import { createCsrfToken } from '../../../app/lib/security/csrf.server';
import { runRegistrationAction } from '../../../app/features/identity/server/registration-action.server';

function makeRequest(
  overrides: Record<string, string> = {},
  origin = serverEnv.APP_ORIGIN,
): Request {
  const body = new URLSearchParams({
    _csrfToken: createCsrfToken(),
    firstName: ' Ada ',
    lastName: 'Lovelace',
    email: ' ADA@EXAMPLE.TEST ',
    password: '  long password exactly  ',
    confirmPassword: '  long password exactly  ',
    termsAccepted: 'on',
    ...overrides,
  });

  return new Request(`${serverEnv.APP_ORIGIN}/register`, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const acknowledgement = {
  data: { message: 'Registration request received.' },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('registration action', () => {
  it('rejects mismatched passwords without calling the backend or returning either password', async () => {
    const result = await runRegistrationAction(
      makeRequest({ confirmPassword: 'a different password' }),
    );

    expect(result.errors?.confirmPassword).toBe('Passwords do not match.');
    expect(JSON.stringify(result)).not.toContain('long password exactly');
    expect(JSON.stringify(result)).not.toContain('a different password');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends only the backend contract and returns the generic acknowledgement', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(acknowledgement));

    const result = await runRegistrationAction(makeRequest());

    expect(result.success).toBe(true);
    expect(JSON.stringify(result)).not.toContain('long password exactly');

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain('/api/v1/auth/register');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.test',
      password: '  long password exactly  ',
      termsAccepted: true,
    });
    expect(String(init?.body)).not.toContain('confirmPassword');
  });

  it('maps a recognized compromised-password field error without exposing backend text', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Do not display this backend message.',
            details: [
              {
                field: 'password',
                code: 'PASSWORD_COMPROMISED',
                message: 'Untrusted detail.',
              },
            ],
          },
          meta: { requestId: 'request-123' },
        },
        422,
      ),
    );

    const result = await runRegistrationAction(makeRequest());

    expect(result.errors?.password).toBe('Choose a different password.');
    expect(JSON.stringify(result)).not.toMatch(
      /long password exactly|Untrusted detail|Do not display/,
    );
  });

  it('shows a safe message for backend outages and network failures', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Internal dependency detail.',
          },
          meta: { requestId: 'request-456' },
        },
        503,
      ),
    );

    const outage = await runRegistrationAction(makeRequest());
    expect(outage.formError).toMatch(/temporarily unavailable/i);
    expect(JSON.stringify(outage)).not.toContain('Internal dependency detail');

    vi.mocked(fetch).mockRejectedValue(
      new Error('postgresql://user:secret@internal.invalid'),
    );

    const networkFailure = await runRegistrationAction(makeRequest());
    expect(networkFailure.formError).toMatch(/try again later/i);
    expect(JSON.stringify(networkFailure)).not.toMatch(
      /postgresql|secret|internal\.invalid/,
    );
  });

  it('rejects a cross-origin submission before contacting the backend', async () => {
    const result = await runRegistrationAction(
      makeRequest({}, 'https://attacker.invalid'),
    );

    expect(result.formError).toMatch(/form expired/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});
