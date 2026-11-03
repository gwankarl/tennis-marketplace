import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { apiErrorEnvelopeSchema } from '../../../http/error.schema.js';
import { PasswordResetRateLimitError } from '../../../http/rate-limit-error.js';
import type { PasswordResetRequestService } from './password-reset-request.service.js';
import type { PasswordResetService } from './password-reset.service.js';
import {
  passwordResetAcknowledgementSchema,
  passwordResetRequestSchema,
} from './password-reset-request.schema.js';
import {
  passwordResetCompleteResponseSchema,
  passwordResetConfirmRequestSchema,
} from './password-reset-confirm.schema.js';

export interface PasswordResetRoutesOptions {
  requests: PasswordResetRequestService;
  reset: PasswordResetService;
  ipRateLimitMax: number;
  ipRateLimitWindowMs: number;
}

export const passwordResetRoutes: FastifyPluginAsync<
  PasswordResetRoutesOptions
> = async (app, options) => {
  // Reset requests and confirmation bodies may contain sensitive data.
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('pragma', 'no-cache');
  });

  await app.register(rateLimit, {
    global: false,
    hook: 'onRequest',
    // buildApp disables proxy trust; use only the socket peer address.
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (_request, context) =>
      new PasswordResetRateLimitError(
        Math.max(1, Math.ceil(context.ttl / 1000)),
      ),
  });

  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.post(
    '/api/v1/auth/request-password-reset',
    {
      config: {
        // onRequest counts invalid submissions before body validation.
        rateLimit: {
          max: options.ipRateLimitMax,
          timeWindow: options.ipRateLimitWindowMs,
        },
      },
      schema: {
        tags: ['identity'],
        summary: 'Request a password reset email',
        body: passwordResetRequestSchema,
        response: {
          200: passwordResetAcknowledgementSchema,
          400: apiErrorEnvelopeSchema,
          413: apiErrorEnvelopeSchema,
          422: apiErrorEnvelopeSchema,
          429: apiErrorEnvelopeSchema,
          500: apiErrorEnvelopeSchema,
          503: apiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const acknowledgement = await options.requests.requestReset(
        request.body,
      );
      return reply.code(200).send(acknowledgement);
    },
  );

  routes.post(
    '/api/v1/auth/confirm-password-reset',
    {
      schema: {
        tags: ['identity'],
        summary: 'Set a new password using a reset token',
        body: passwordResetConfirmRequestSchema,
        response: {
          200: passwordResetCompleteResponseSchema,
          400: apiErrorEnvelopeSchema,
          404: apiErrorEnvelopeSchema,
          413: apiErrorEnvelopeSchema,
          422: apiErrorEnvelopeSchema,
          500: apiErrorEnvelopeSchema,
          503: apiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      await options.reset.reset(request.body);

      return reply.code(200).send({
        data: { message: 'Password reset complete.' },
      });
    },
  );
};
