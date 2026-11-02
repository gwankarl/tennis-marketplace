import { afterEach, describe, expect, it, vi } from 'vitest';
import { getApiConnectionStatus } from '../app/lib/api-health.server';

describe('getApiConnectionStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns available for a successful health response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { status: 'ok' } }),
      }),
    );

    await expect(getApiConnectionStatus()).resolves.toBe('available');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('returns unavailable for a valid backend error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Safe backend message.',
          },
          meta: { requestId: 'server-request-id' },
        }),
      }),
    );

    await expect(getApiConnectionStatus()).resolves.toBe('unavailable');
  });

  it('returns unavailable for an invalid health payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { status: 'degraded' } }),
      }),
    );

    await expect(getApiConnectionStatus()).resolves.toBe('unavailable');
  });

  it.each([
    ['connection failure', new TypeError('connection failed')],
    ['timeout', new DOMException('request timed out', 'TimeoutError')],
  ])('returns unavailable after a %s', async (_caseName, error) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));

    await expect(getApiConnectionStatus()).resolves.toBe('unavailable');
  });
});
