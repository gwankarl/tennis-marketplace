import { serverEnv } from '../config/server-env.server';
import { requestApi, type RuntimeSchema } from './api-client.server';

export type ApiConnectionStatus = 'available' | 'unavailable';

interface HealthResponse {
  data: { status: 'ok' };
}

const healthResponseSchema: RuntimeSchema<HealthResponse> = {
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
      throw new Error('Invalid health response.');
    }

    return { data: { status: 'ok' } };
  },
};

/**
 * Checks API process health for server-rendered UI. Failures return a safe
 * status and never expose internal URLs or response details to the browser.
 */
export async function getApiConnectionStatus(): Promise<ApiConnectionStatus> {
  const result = await requestApi(
    serverEnv.API_BASE_URL,
    '/api/v1/health',
    healthResponseSchema,
    { timeoutMs: 3_000 },
  );

  return result.ok ? 'available' : 'unavailable';
}
