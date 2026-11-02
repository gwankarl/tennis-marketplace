import { describe, expect, it, vi } from 'vitest';
import { requestApi, type RuntimeSchema } from '../app/lib/api-client.server';

interface HealthResponse {
  data: { status: 'ok' };
}

const healthSchema: RuntimeSchema<HealthResponse> = {
  parse(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('data' in value) ||
      typeof value.data !== 'object' ||
      value.data === null ||
      !('status' in value.data) ||
      value.data.status !== 'ok'
    ) {
      throw new Error('Invalid health payload');
    }

    return value as HealthResponse;
  },
};

const validErrorEnvelope = {
  error: {
    code: 'VALIDATION_ERROR',
    message: 'Backend message must not be displayed.',
    details: [
      {
        field: 'email',
        code: 'FIELD_INVALID',
        message: 'Untrusted field message.',
      },
    ],
  },
  meta: { requestId: 'server-request-id' },
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('requestApi', () => {
  it('validates and returns a successful payload', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: { status: 'ok' } }));

    const result = await requestApi(
      'http://backend.internal',
      '/api/v1/health',
      healthSchema,
      { fetchImplementation },
    );

    expect(result).toEqual({
      ok: true,
      data: { data: { status: 'ok' } },
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('returns a validated backend error and safe field codes', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(validErrorEnvelope, 422));

    const result = await requestApi(
      'http://backend.internal',
      '/api/v1/example',
      healthSchema,
      { fetchImplementation },
    );

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'backend',
        status: 422,
        code: 'VALIDATION_ERROR',
        requestId: 'server-request-id',
        details: [{ field: 'email', code: 'FIELD_INVALID' }],
      },
    });
    expect(JSON.stringify(result)).not.toContain('Untrusted field message.');
    expect(JSON.stringify(result)).not.toContain('Backend message');
  });

  it('accepts a valid backend error without field details', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: { code: 'CONFLICT', message: 'Safe backend message.' },
          meta: { requestId: 'server-request-id' },
        },
        409,
      ),
    );

    const result = await requestApi(
      'http://backend.internal',
      '/api/v1/example',
      healthSchema,
      { fetchImplementation },
    );

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'backend',
        status: 409,
        code: 'CONFLICT',
        requestId: 'server-request-id',
      },
    });
  });

  it('rejects malformed JSON and invalid error envelopes without retaining bodies', async () => {
    const malformedJsonFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('{ malformed-password-marker', { status: 500 }),
      );

    const malformedJsonResult = await requestApi(
      'http://backend.internal',
      '/api/v1/example',
      healthSchema,
      { fetchImplementation: malformedJsonFetch },
    );

    expect(malformedJsonResult).toEqual({
      ok: false,
      error: { kind: 'invalid_response', reason: 'malformed_json' },
    });
    expect(JSON.stringify(malformedJsonResult)).not.toContain(
      'password-marker',
    );

    const invalidEnvelopeFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'CONFLICT',
            message: 'message-marker',
            details: [{ field: 'email', code: 'FIELD_INVALID' }],
          },
          meta: { requestId: 'request-id' },
          databaseUrl: 'postgresql://user:password-marker@host/private',
        },
        409,
      ),
    );

    const invalidEnvelopeResult = await requestApi(
      'http://backend.internal',
      '/api/v1/example',
      healthSchema,
      { fetchImplementation: invalidEnvelopeFetch },
    );

    expect(invalidEnvelopeResult).toEqual({
      ok: false,
      error: {
        kind: 'invalid_response',
        reason: 'invalid_error_envelope',
      },
    });
    expect(JSON.stringify(invalidEnvelopeResult)).not.toContain(
      'password-marker',
    );
    expect(JSON.stringify(invalidEnvelopeResult)).not.toContain(
      'message-marker',
    );
  });

  it('rejects a success payload that fails the supplied schema', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: { status: 'password-marker' } }));

    const result = await requestApi(
      'http://backend.internal',
      '/api/v1/health',
      healthSchema,
      { fetchImplementation },
    );

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'invalid_response',
        reason: 'invalid_success_payload',
      },
    });
    expect(JSON.stringify(result)).not.toContain('password-marker');
  });

  it('reports a connection failure without exposing its message or URL', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new Error(
          'https://user:token-marker@internal.invalid/private?sql=secret',
        ),
      );

    const result = await requestApi(
      'http://backend.internal',
      '/api/v1/health',
      healthSchema,
      { fetchImplementation },
    );

    expect(result).toEqual({
      ok: false,
      error: { kind: 'network' },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /token-marker|internal\.invalid|sql=secret/,
    );
  });

  it('times out while waiting for the response', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () =>
              reject(new DOMException('private timeout detail', 'AbortError')),
            { once: true },
          );
        }),
    );

    const result = await requestApi(
      'http://backend.internal',
      '/api/v1/health',
      healthSchema,
      { fetchImplementation, timeoutMs: 10 },
    );

    expect(result).toEqual({
      ok: false,
      error: { kind: 'timeout' },
    });
  });

  it('keeps the timeout active while reading a stalled response body', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      async (_input, init) =>
        ({
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener(
                'abort',
                () =>
                  reject(new DOMException('private body detail', 'AbortError')),
                { once: true },
              );
            }),
        }) as Response,
    );

    const result = await requestApi(
      'http://backend.internal',
      '/api/v1/health',
      healthSchema,
      { fetchImplementation, timeoutMs: 10 },
    );

    expect(result).toEqual({
      ok: false,
      error: { kind: 'timeout' },
    });
  });
});
