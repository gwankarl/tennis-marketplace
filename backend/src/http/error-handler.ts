import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifySchemaValidationError,
} from 'fastify';
import {
  ApplicationError,
  type ApplicationErrorCode,
  type ApplicationErrorDetail,
} from './application-error.js';
import { serializeUnexpectedFailure } from '../config/logger.js';
import { hasZodFastifySchemaValidationErrors } from '@fastify/type-provider-zod';
import {
  RegistrationRateLimitError,
  ResendVerificationRateLimitError,
  LoginRateLimitError,
  PasswordResetRateLimitError,
} from './rate-limit-error.js';

const APPLICATION_ERROR_STATUS: Record<ApplicationErrorCode, number> = {
  EMAIL_VERIFICATION_REQUIRED: 403,
  ACCOUNT_RESTRICTED: 403,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  VALIDATION_ERROR: 422,
};

function safeFieldSegment(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(value);
}

function validationDetails(
  issues: FastifySchemaValidationError[] | undefined,
): ApplicationErrorDetail[] | undefined {
  if (!issues?.length) {
    return undefined;
  }

  const details = issues.map((issue) => {
    const pathSegments = (issue.instancePath ?? '')
      .split('/')
      .slice(1)
      .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
      .filter(safeFieldSegment);

    const missingProperty = issue.params?.missingProperty;
    const requiredProperty =
      issue.keyword === 'required' &&
      typeof missingProperty === 'string' &&
      safeFieldSegment(missingProperty)
        ? missingProperty
        : undefined;

    if (requiredProperty) {
      pathSegments.push(requiredProperty);
    }

    const isRequired = issue.keyword === 'required';

    return {
      field: pathSegments.join('.') || 'body',
      code: isRequired ? 'FIELD_REQUIRED' : 'FIELD_INVALID',
      message: isRequired
        ? 'This field is required.'
        : 'This field is invalid.',
    };
  });

  return details.length ? details : undefined;
}

function isFastifyValidationError(error: FastifyError): boolean {
  return (
    error instanceof Error &&
    error.code === 'FST_ERR_VALIDATION' &&
    Array.isArray(error.validation) &&
    typeof error.validationContext === 'string' &&
    ['body', 'querystring', 'params', 'headers'].includes(
      error.validationContext,
    )
  );
}

function sendError(
  reply: FastifyReply,
  requestId: string,
  statusCode: number,
  code: string,
  message: string,
  details?: readonly ApplicationErrorDetail[],
) {
  return reply
    .header('x-request-id', requestId)
    .code(statusCode)
    .send({
      error: {
        code,
        message,
        ...(details?.length ? { details } : {}),
      },
      meta: { requestId },
    });
}

function sendUnexpectedError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  request.log.error(
    serializeUnexpectedFailure(error, {
      requestId: request.id,
      method: request.method,
      routeTemplate: request.routeOptions.url,
    }),
    'Unhandled request failure',
  );

  return sendError(
    reply,
    request.id,
    500,
    'INTERNAL_ERROR',
    'An unexpected error occurred.',
  );
}

export function registerErrorHandlers(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ApplicationError) {
      return sendError(
        reply,
        request.id,
        APPLICATION_ERROR_STATUS[error.code],
        error.code,
        error.message,
        error.details,
      );
    }

    if (
      error instanceof Fastify.errorCodes.FST_ERR_CTP_INVALID_JSON_BODY ||
      error instanceof Fastify.errorCodes.FST_ERR_CTP_EMPTY_JSON_BODY
    ) {
      return sendError(
        reply,
        request.id,
        400,
        'BAD_REQUEST',
        'The request body is not valid JSON.',
      );
    }

    if (error instanceof Fastify.errorCodes.FST_ERR_CTP_BODY_TOO_LARGE) {
      return sendError(
        reply,
        request.id,
        413,
        'PAYLOAD_TOO_LARGE',
        'The request body is too large.',
      );
    }

    if (
      hasZodFastifySchemaValidationErrors(error) &&
      typeof error.validationContext === 'string' &&
      ['body', 'querystring', 'params', 'headers'].includes(
        error.validationContext,
      )
    ) {
      return sendError(
        reply,
        request.id,
        422,
        'VALIDATION_ERROR',
        'The request contains invalid fields.',
        validationDetails(error.validation),
      );
    }

    if (isFastifyValidationError(error)) {
      return sendError(
        reply,
        request.id,
        422,
        'VALIDATION_ERROR',
        'The request contains invalid fields.',
        validationDetails(error.validation),
      );
    }

    if (error instanceof LoginRateLimitError) {
      reply.header('retry-after', String(error.retryAfterSeconds));

      return sendError(
        reply,
        request.id,
        429,
        'RATE_LIMITED',
        'Too many login attempts. Try again later.',
      );
    }

    if (
      error instanceof RegistrationRateLimitError ||
      error instanceof ResendVerificationRateLimitError
    ) {
      reply.header('retry-after', String(error.retryAfterSeconds));

      return sendError(
        reply,
        request.id,
        429,
        'RATE_LIMITED',
        error instanceof RegistrationRateLimitError
          ? 'Too many registration attempts. Try again later.'
          : 'Too many resend requests. Try again later.',
      );
    }

    if (error instanceof PasswordResetRateLimitError) {
      reply.header('retry-after', String(error.retryAfterSeconds));

      return sendError(
        reply,
        request.id,
        429,
        'RATE_LIMITED',
        'Too many password reset requests. Try again later.',
      );
    }

    return sendUnexpectedError(error, request, reply);
  });

  app.setNotFoundHandler((request, reply) =>
    sendError(
      reply,
      request.id,
      404,
      'NOT_FOUND',
      'The requested resource was not found.',
    ),
  );
}
