import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('GET /api/v1/health', () => {
  it('returns the process health response without listening on a port', async () => {
    const app = buildApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        data: { status: 'ok' },
      });
    } finally {
      await app.close();
    }
  });
});
