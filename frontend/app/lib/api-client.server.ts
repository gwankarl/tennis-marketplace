export interface RuntimeSchema<T> {
  parse(value: unknown): T;
}

export interface ApiFieldError {
  field: string;
  code: string;
}

export type ApiClientFailure =
  | {
      kind: 'backend';
      status: number;
      code: string;
      requestId: string;
      details?: ApiFieldError[];
    }
  | { kind: 'network' }
  | { kind: 'timeout' }
  | {
      kind: 'invalid_response';
      reason:
        'malformed_json' | 'invalid_error_envelope' | 'invalid_success_payload';
    };

export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; error: ApiClientFailure };

export interface ApiRequestOptions {
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
  method?: 'GET' | 'POST' | 'PATCH';
  jsonBody?: unknown;
  /** Server-only credential forwarded to Fastify in Authorization. */
  sessionCredential?: string;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 10_000;
const MAX_ERROR_DETAILS = 50;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAFE_FIELD = /^[A-Za-z][A-Za-z0-9_.]{0,99}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= maxLength
  );
}

function parseBackendError(
  value: unknown,
  status: number,
): ApiClientFailure | undefined {
  if (!isRecord(value) || !isRecord(value.error) || !isRecord(value.meta)) {
    return undefined;
  }

  const { code, message, details } = value.error;
  const requestId = value.meta.requestId;

  if (
    typeof code !== 'string' ||
    !SAFE_CODE.test(code) ||
    !validText(message, 500) ||
    !validText(requestId, 128)
  ) {
    return undefined;
  }

  let safeDetails: ApiFieldError[] | undefined;

  if (details !== undefined) {
    if (!Array.isArray(details) || details.length > MAX_ERROR_DETAILS) {
      return undefined;
    }

    safeDetails = [];

    for (const detail of details) {
      if (
        !isRecord(detail) ||
        typeof detail.field !== 'string' ||
        !SAFE_FIELD.test(detail.field) ||
        typeof detail.code !== 'string' ||
        !SAFE_CODE.test(detail.code) ||
        !validText(detail.message, 500)
      ) {
        return undefined;
      }

      // Backend messages are validated but deliberately not exposed to callers.
      safeDetails.push({ field: detail.field, code: detail.code });
    }
  }

  return {
    kind: 'backend',
    status,
    code,
    requestId,
    ...(safeDetails?.length ? { details: safeDetails } : {}),
  };
}

function boundedTimeout(timeoutMs: number | undefined): number {
  if (
    typeof timeoutMs !== 'number' ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    return DEFAULT_TIMEOUT_MS;
  }

  return Math.min(Math.ceil(timeoutMs), MAX_TIMEOUT_MS);
}

/**
 * Sends a server-side JSON request. Only validated payloads or sanitized
 * failure categories leave this module; response bodies are never retained.
 */
export async function requestApi<T>(
  apiBaseUrl: string,
  path: string,
  schema: RuntimeSchema<T>,
  options: ApiRequestOptions = {},
): Promise<ApiResult<T>> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const controller = new AbortController();
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, boundedTimeout(options.timeoutMs));

  const method = options.method ?? 'GET';

  try {
    let response: Response;

    try {
      const baseUrl = new URL(apiBaseUrl);
      const requestUrl = new URL(path, baseUrl);

      if (
        !path.startsWith('/') ||
        path.startsWith('//') ||
        requestUrl.origin !== baseUrl.origin
      ) {
        return {
          ok: false,
          error: {
            kind: 'invalid_response',
            reason: 'invalid_error_envelope',
          },
        };
      }

      response = await fetchImplementation(requestUrl, {
        method,
        headers: {
          accept: 'application/json',
          ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}),
          ...(options.sessionCredential
            ? { authorization: `Bearer ${options.sessionCredential}` }
            : {}),
        },
        ...(method !== 'GET' ? { body: JSON.stringify(options.jsonBody) } : {}),
        signal: controller.signal,
      });
    } catch {
      return {
        ok: false,
        error: timedOut ? { kind: 'timeout' } : { kind: 'network' },
      };
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch (error) {
      if (timedOut) {
        return { ok: false, error: { kind: 'timeout' } };
      }

      if (error instanceof SyntaxError) {
        return {
          ok: false,
          error: {
            kind: 'invalid_response',
            reason: 'malformed_json',
          },
        };
      }

      return { ok: false, error: { kind: 'network' } };
    }

    if (!response.ok) {
      const backendError = parseBackendError(payload, response.status);

      return backendError
        ? { ok: false, error: backendError }
        : {
            ok: false,
            error: {
              kind: 'invalid_response',
              reason: 'invalid_error_envelope',
            },
          };
    }

    try {
      return { ok: true, data: schema.parse(payload) };
    } catch {
      return {
        ok: false,
        error: {
          kind: 'invalid_response',
          reason: 'invalid_success_payload',
        },
      };
    }
  } finally {
    clearTimeout(timeout);
  }
}
