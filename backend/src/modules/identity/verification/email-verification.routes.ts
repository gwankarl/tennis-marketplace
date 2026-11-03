import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import type { FastifyPluginAsync } from 'fastify';
import { apiErrorEnvelopeSchema } from '../../../http/error.schema.js';
import type { EmailVerificationService } from './email-verification.service.js';
import {
  verifyEmailAcknowledgementSchema,
  verifyEmailRequestSchema,
} from './verify-email.schema.js';

export interface EmailVerificationRoutesOptions {
  service: Pick<EmailVerificationService, 'consume'>;
}

/**
 * Consumes a verification token without creating a session or exposing account
 * details. Tokens are accepted only in the POST body.
 */
export const emailVerificationRoutes: FastifyPluginAsync<
  EmailVerificationRoutesOptions
> = async (app, options) => {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.post(
    '/api/v1/auth/verify-email',
    {
      schema: {
        tags: ['identity'],
        summary: 'Verify an email address',
        body: verifyEmailRequestSchema,
        response: {
          200: verifyEmailAcknowledgementSchema,
          400: apiErrorEnvelopeSchema,
          404: apiErrorEnvelopeSchema,
          413: apiErrorEnvelopeSchema,
          422: apiErrorEnvelopeSchema,
          500: apiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      await options.service.consume(request.body.token);

      return reply.code(200).send({
        data: { message: 'Email address verified.' },
      });
    },
  );
};
