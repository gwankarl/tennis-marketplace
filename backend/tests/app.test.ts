import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApplicationError } from '../src/http/application-error.js';
import { buildApp } from '../src/app.js';

const applicationErrorCases = [
  ['unauthenticated', 'UNAUTHENTICATED', 401],
  ['forbidden', 'FORBIDDEN', 403],
  ['missing-resource', 'NOT_FOUND', 404],
  ['conflict', 'CONFLICT', 409],
  ['rate-limited', 'RATE_LIMITED', 429],
  ['dependency-unavailable', 'SERVICE_UNAVAILABLE', 503],
] as const;

class LogCapture extends Writable {
  readonly chunks: string[] = [];

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString('utf8'));
    callback();
  }
}

function createTestApp(loggerStream?: LogCapture) {
  const app = buildApp({ loggerStream });

  app.post('/__test/body', async () => ({ data: { ok: true } }));

  app.post(
    '/__test/validation',
    {
      schema: {
        body: z
          .object({
            email: z.string(),
          })
          .strict(),
      },
    },
    async () => ({ data: { ok: true } }),
  );

  for (const [path, code] of applicationErrorCases) {
    app.get(`/__test/${path}`, async (_request, reply) => {
      if (code === 'RATE_LIMITED') {
        reply.header('retry-after', '30');
      }

      throw new ApplicationError(code, 'A safe test message.');
    });
  }

  app.post('/__test/unexpected/:resourceId', async () => {
    const error = new Error('password-in-error-message-marker', {
      cause: new Error(
        'postgresql://db-user:db-password-marker@database.internal/private',
      ),
    });

    Object.assign(error, {
      accessToken: 'custom-token-marker',
      sql: 'SELECT * FROM private_table sql-marker',
      statusCode: 409,
      code: 'CONFLICT',
    });

    error.stack = [
      'Error: fake-stack-message-marker',
      '    at routeHandler (C:\\repo\\tennis-xpress\\backend\\src\\app.ts:12:4)',
      '    at malformed token-in-stack-marker',
      'not a recognized frame password-in-stack-marker',
    ].join('\n');

    throw error;
  });

  app.get('/__test/non-error', async () => {
    throw 'non-error-secret-marker';
  });

  app.get('/__test/missing-stack', async () => {
    const error = new Error('missing-stack-secret-marker');
    error.stack = undefined;
    throw error;
  });

  app.get('/__test/unrecognized-stack', async () => {
    const error = new Error('unrecognized-stack-secret-marker');
    error.stack = [
      'Error: fake-stack-header-marker',
      '    at malformed token-in-unrecognized-stack-marker',
      'not a recognized frame sql-in-unrecognized-stack-marker',
    ].join('\n');
    throw error;
  });

  return app;
}

async function withTestApp<T>(
  run: (app: ReturnType<typeof buildApp>) => Promise<T>,
  loggerStream?: LogCapture,
): Promise<T> {
  const app = createTestApp(loggerStream);

  try {
    return await run(app);
  } finally {
    await app.close();
  }
}

function capturedLogRecords(logCapture: LogCapture): Record<string, unknown>[] {
  return logCapture.chunks
    .join('')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function failureLogRecords(logCapture: LogCapture): Record<string, unknown>[] {
  return capturedLogRecords(logCapture).filter(
    (record) => record.msg === 'Unhandled request failure',
  );
}

describe('GET /api/v1/health', () => {
  it('preserves the process-health response body', async () => {
    await withTestApp(async (app) => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        data: { status: 'ok' },
      });
    });
  });
});

describe('API errors', () => {
  it('returns a 404 envelope and ignores a client-supplied request ID', async () => {
    await withTestApp(async (app) => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/unknown',
        headers: { 'x-request-id': 'client-controlled-id' },
      });

      const requestId = response.headers['x-request-id'];

      expect(response.statusCode).toBe(404);
      expect(requestId).not.toBe('client-controlled-id');
      expect(response.json()).toEqual({
        error: {
          code: 'NOT_FOUND',
          message: 'The requested resource was not found.',
        },
        meta: { requestId },
      });
    });
  });

  it('maps malformed JSON to 400 BAD_REQUEST', async () => {
    await withTestApp(async (app) => {
      const response = await app.inject({
        method: 'POST',
        url: '/__test/body',
        headers: { 'content-type': 'application/json' },
        payload: '{"broken":',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('BAD_REQUEST');
      expect(response.json().error.message).not.toContain('broken');
    });
  });

  it('maps an oversized body to 413 PAYLOAD_TOO_LARGE', async () => {
    await withTestApp(async (app) => {
      const payload = JSON.stringify({
        value: 'x'.repeat(1_048_576),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/__test/body',
        headers: { 'content-type': 'application/json' },
        payload,
      });

      expect(response.statusCode).toBe(413);
      expect(response.json().error.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  it('maps Zod validation to safe field details', async () => {
    await withTestApp(async (app) => {
      const response = await app.inject({
        method: 'POST',
        url: '/__test/validation',
        payload: {},
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'The request contains invalid fields.',
        details: [
          {
            field: 'email',
            code: 'FIELD_INVALID',
            message: 'This field is invalid.',
          },
        ],
      });
    });
  });

  it.each(applicationErrorCases)(
    'maps application error %s to HTTP %i',
    async (path, code, statusCode) => {
      await withTestApp(async (app) => {
        const response = await app.inject({
          method: 'GET',
          url: `/__test/${path}`,
        });

        expect(response.statusCode).toBe(statusCode);
        expect(response.json().error.code).toBe(code);

        if (code === 'RATE_LIMITED') {
          expect(response.headers['retry-after']).toBe('30');
        }
      });
    },
  );
});

describe('unexpected failure diagnostics', () => {
  it('logs one sanitized entry with request context and recognized source locations', async () => {
    const logCapture = new LogCapture();

    await withTestApp(async (app) => {
      const response = await app.inject({
        method: 'POST',
        url: '/__test/unexpected/resource-id-secret-marker?token=query-secret-marker',
        headers: {
          authorization: 'Bearer auth-secret-marker',
          cookie: 'session=cookie-secret-marker',
        },
        payload: { password: 'body-secret-marker' },
      });

      const requestId = response.headers['x-request-id'];

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred.',
        },
        meta: { requestId },
      });

      for (const secret of [
        'password-in-error-message-marker',
        'db-password-marker',
        'custom-token-marker',
        'sql-marker',
        'resource-id-secret-marker',
        'query-secret-marker',
      ]) {
        expect(response.body).not.toContain(secret);
      }
    }, logCapture);

    const failureLogs = failureLogRecords(logCapture);

    expect(failureLogs).toHaveLength(1);
    expect(failureLogs[0]).toMatchObject({
      reqId: expect.any(String),
      requestId: expect.any(String),
      method: 'POST',
      routeTemplate: '/__test/unexpected/:resourceId',
      errorCategory: 'error',
      failure: 'unexpected_request_failure',
      stackLocations: ['app.ts:12:4'],
    });
    expect(failureLogs[0].reqId).toBe(failureLogs[0].requestId);

    const logText = logCapture.chunks.join('');
    for (const secret of [
      'password-in-error-message-marker',
      'db-user',
      'db-password-marker',
      'database.internal',
      'private',
      'custom-token-marker',
      'sql-marker',
      'SELECT *',
      'auth-secret-marker',
      'cookie-secret-marker',
      'body-secret-marker',
      'resource-id-secret-marker',
      'query-secret-marker',
      'token-in-stack-marker',
      'password-in-stack-marker',
      'C:\\repo\\tennis-xpress',
    ]) {
      expect(logText).not.toContain(secret);
    }
  });

  it.each([
    ['non-error', 'non-error-secret-marker'],
    ['missing-stack', 'missing-stack-secret-marker'],
    ['unrecognized-stack', 'unrecognized-stack-secret-marker'],
  ])('safely handles %s failures', async (path, secretMarker) => {
    const logCapture = new LogCapture();

    await withTestApp(async (app) => {
      const response = await app.inject({
        method: 'GET',
        url: `/__test/${path}`,
      });
      const requestId = response.headers['x-request-id'];

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred.',
        },
        meta: { requestId },
      });
      expect(response.body).not.toContain(secretMarker);
    }, logCapture);

    const failureLogs = failureLogRecords(logCapture);

    expect(failureLogs).toHaveLength(1);
    expect(failureLogs[0]).toMatchObject({
      failure: 'unexpected_request_failure',
      stackLocations: [],
    });
    expect(logCapture.chunks.join('')).not.toContain(secretMarker);
  });
});
