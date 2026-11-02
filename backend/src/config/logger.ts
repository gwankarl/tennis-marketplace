import type { FastifyLoggerOptions } from 'fastify';

export interface LoggerStream {
  write(message: string): void;
}

interface SafeLoggerOptions extends FastifyLoggerOptions {
  redact: {
    paths: string[];
    censor: string;
  };
}

export function createLoggerOptions(
  loggerStream?: LoggerStream,
): SafeLoggerOptions {
  return {
    level: 'info',
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      req: (request) => ({
        method: request.method,
        requestId: request.id,
      }),
    },
    ...(loggerStream ? { stream: loggerStream } : {}),
  };
}

const SOURCE_FILENAMES = new Set([
  'accounts.schema.ts',
  'app.ts',
  'application-error.ts',
  'check-connection.ts',
  'client.ts',
  'env.ts',
  'error-handler.ts',
  'logger.ts',
  'server.ts',
]);

const HTTP_METHODS = new Set([
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
]);

interface UnexpectedFailureContext {
  requestId: string;
  method: string;
  routeTemplate?: string;
}

function safeStackLocations(error: unknown): string[] {
  try {
    if (!(error instanceof Error)) {
      return [];
    }

    const stack = error.stack;
    // Oversized or malformed stacks are omitted rather than partially trusted.
    if (typeof stack !== 'string' || stack.length > 16_384) {
      return [];
    }

    const locations: string[] = [];

    for (const line of stack.split(/\r?\n/).slice(1, 33)) {
      const frame = /^\s*at (?:.*?\()?(.+?):(\d{1,6}):(\d{1,6})\)?$/.exec(line);
      if (!frame) {
        continue;
      }

      const source = /(?:^|[\\/])backend[\\/](?:src|dist)[\\/]([^\\/]+)$/.exec(
        frame[1],
      );
      const filename = source?.[1];

      if (!filename || !SOURCE_FILENAMES.has(filename)) {
        continue;
      }

      locations.push(`${filename}:${frame[2]}:${frame[3]}`);
      if (locations.length === 5) {
        break;
      }
    }

    return locations;
  } catch {
    // A custom Error or stack accessor can itself throw.
    return [];
  }
}

function safeErrorCategory(error: unknown): string {
  try {
    if (!(error instanceof Error)) {
      return 'non_error';
    }
    if (error instanceof TypeError) {
      return 'type_error';
    }
    if (error instanceof RangeError) {
      return 'range_error';
    }
    if (error instanceof SyntaxError) {
      return 'syntax_error';
    }
    return 'error';
  } catch {
    return 'non_error';
  }
}

function safeRouteTemplate(routeTemplate: string | undefined): string {
  if (
    typeof routeTemplate === 'string' &&
    routeTemplate.length <= 160 &&
    /^\/[A-Za-z0-9_:/{}.-]*$/.test(routeTemplate)
  ) {
    return routeTemplate;
  }

  return 'unknown';
}

export function serializeUnexpectedFailure(
  error: unknown,
  context: UnexpectedFailureContext,
) {
  return {
    requestId: context.requestId,
    method: HTTP_METHODS.has(context.method) ? context.method : 'UNKNOWN',
    routeTemplate: safeRouteTemplate(context.routeTemplate),
    errorCategory: safeErrorCategory(error),
    failure: 'unexpected_request_failure',
    stackLocations: safeStackLocations(error),
  };
}
