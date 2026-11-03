import rateLimit from '@fastify/rate-limit';
import { type FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import {
  registrationAcknowledgementSchema,
  registrationRequestSchema,
} from './registration.schema.js';
import type { RegistrationService } from './registration.service.js';
import { apiErrorEnvelopeSchema } from '../../../http/error.schema.js';
import { RegistrationRateLimitError } from '../../../http/rate-limit-error.js';

export interface RegistrationRoutesOptions {
  service: RegistrationService;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

/**
 * Adds the registration endpoint and a route-local, in-memory limiter.
 * The limiter runs onRequest, before body validation, screening, or hashing.
 */
export const registrationRoutes: FastifyPluginAsync<
  RegistrationRoutesOptions
> = async (app, options) => {
  await app.register(rateLimit, {
    global: false,
    hook: 'onRequest',
    errorResponseBuilder: (_request, context) =>
      new RegistrationRateLimitError(
        Math.max(1, Math.ceil(context.ttl / 1000)),
      ),
  });

  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.post(
    '/api/v1/auth/register',
    {
      config: {
        rateLimit: {
          max: options.rateLimitMax,
          timeWindow: options.rateLimitWindowMs,
        },
      },
      schema: {
        tags: ['identity'],
        summary: 'Submit a registration request',
        body: registrationRequestSchema,
        response: {
          200: registrationAcknowledgementSchema,
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
      const acknowledgement = await options.service.register(request.body);
      return reply.code(200).send(acknowledgement);
    },
  );
};
