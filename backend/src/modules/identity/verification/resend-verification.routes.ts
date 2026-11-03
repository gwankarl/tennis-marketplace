import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { apiErrorEnvelopeSchema } from '../../../http/error.schema.js';
import { ResendVerificationRateLimitError } from '../../../http/rate-limit-error.js';
import type { ResendVerificationService } from './resend-verification.service.js';
import {
  resendVerificationAcknowledgementSchema,
  resendVerificationRequestSchema,
} from './resend-verification.schema.js';

export interface ResendVerificationRoutesOptions {
  service: ResendVerificationService;
  ipRateLimitMax: number;
  ipRateLimitWindowMs: number;
}

export const resendVerificationRoutes: FastifyPluginAsync<
  ResendVerificationRoutesOptions
> = async (app, options) => {
  await app.register(rateLimit, {
    global: false,
    hook: 'onRequest',
    // buildApp keeps trustProxy disabled; use only the socket peer address.
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (_request, context) =>
      new ResendVerificationRateLimitError(
        Math.max(1, Math.ceil(context.ttl / 1000)),
      ),
  });

  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.post(
    '/api/v1/auth/resend-verification',
    {
      config: {
        rateLimit: {
          max: options.ipRateLimitMax,
          timeWindow: options.ipRateLimitWindowMs,
        },
      },
      schema: {
        tags: ['identity'],
        summary: 'Request another email verification message',
        body: resendVerificationRequestSchema,
        response: {
          200: resendVerificationAcknowledgementSchema,
          400: apiErrorEnvelopeSchema,
          413: apiErrorEnvelopeSchema,
          422: apiErrorEnvelopeSchema,
          429: apiErrorEnvelopeSchema,
          500: apiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const acknowledgement = await options.service.resend(request.body);
      return reply.code(200).send(acknowledgement);
    },
  );
};
