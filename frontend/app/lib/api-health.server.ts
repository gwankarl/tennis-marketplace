import { serverEnv } from '../config/server-env.server';

export type ApiConnectionStatus = 'available' | 'unavailable';

const API_REQUEST_TIMEOUT_MS = 3_000;

/**
 * Checks API process health for server-rendered UI. Failures return a safe
 * status and never expose internal URLs or response details to the browser.
 */
export async function getApiConnectionStatus(): Promise<ApiConnectionStatus> {
  const baseUrl = serverEnv.API_BASE_URL.replace(/\/$/, '');
  const healthUrl = `${baseUrl}/api/v1/health`;

  try {
    const response = await fetch(healthUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      return 'unavailable';
    }

    const payload: unknown = await response.json();

    if (
      typeof payload === 'object' &&
      payload !== null &&
      'data' in payload &&
      typeof payload.data === 'object' &&
      payload.data !== null &&
      'status' in payload.data &&
      payload.data.status === 'ok'
    ) {
      return 'available';
    }
  } catch {
    // Connection, timeout, and invalid JSON errors are safe unavailable states.
  }

  return 'unavailable';
}
