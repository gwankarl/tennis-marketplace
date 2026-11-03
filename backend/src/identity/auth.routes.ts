import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { ApplicationError } from '../http/application-error.js';
import { apiErrorEnvelopeSchema } from '../http/error.schema.js';
import { LoginRateLimitError } from '../http/rate-limit-error.js';
import type { LoginService } from './login.service.js';
import type { SessionService } from './session.service.js';
import {
  currentSessionResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  logoutResponseSchema,
} from './auth.schema.js';

export interface AuthenticationRoutesOptions {
  login: LoginService;
  sessions: SessionService;
}

function bearerCredential(authorization: string | undefined): string | null {
  if (!authorization) {
    return null;
  }

  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
  return match?.[1] ?? null;
}

export const authenticationRoutes: FastifyPluginAsync<
  AuthenticationRoutesOptions
> = async (app, options) => {
  // These responses can contain or relate to credentials; do not cache them.
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('pragma', 'no-cache');
  });

  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.post(
    '/api/v1/auth/login',
    {
      schema: {
        tags: ['identity'],
        summary: 'Create an authenticated session',
        body: loginRequestSchema,
        response: {
          200: loginResponseSchema,
          400: apiErrorEnvelopeSchema,
          401: apiErrorEnvelopeSchema,
          403: apiErrorEnvelopeSchema,
          413: apiErrorEnvelopeSchema,
          422: apiErrorEnvelopeSchema,
          429: apiErrorEnvelopeSchema,
          500: apiErrorEnvelopeSchema,
          503: apiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const outcome = await options.login.login(request.body, request.ip);

      if (outcome.kind === 'rate_limited') {
        throw new LoginRateLimitError(outcome.retryAfterSeconds);
      }

      if (outcome.kind === 'invalid_credentials') {
        throw new ApplicationError(
          'UNAUTHENTICATED',
          'Email or password is incorrect.',
        );
      }

      if (outcome.kind === 'email_verification_required') {
        throw new ApplicationError(
          'EMAIL_VERIFICATION_REQUIRED',
          'Verify your email address before signing in.',
        );
      }

      if (outcome.kind === 'account_restricted') {
        throw new ApplicationError(
          'ACCOUNT_RESTRICTED',
          'This account cannot sign in. Contact support for help.',
        );
      }

      return reply.code(200).send({
        data: {
          credential: outcome.credential,
          absoluteExpiresAt: outcome.absoluteExpiresAt.toISOString(),
          user: outcome.user,
        },
      });
    },
  );

  routes.get(
    '/api/v1/auth/session',
    {
      schema: {
        tags: ['identity'],
        summary: 'Get the current session identity',
        security: [{ bearerAuth: [] }],
        response: {
          200: currentSessionResponseSchema,
          401: apiErrorEnvelopeSchema,
          500: apiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const credential = bearerCredential(request.headers.authorization);
      const session = credential
        ? await options.sessions.current(credential)
        : null;

      if (!session) {
        throw new ApplicationError(
          'UNAUTHENTICATED',
          'Authentication is required.',
        );
      }

      return reply.code(200).send({
        data: {
          user: {
            id: session.userId,
            email: session.email,
            firstName: session.firstName,
            lastName: session.lastName,
            isAdministrator: session.isAdministrator,
          },
        },
      });
    },
  );

  routes.post(
    '/api/v1/auth/logout',
    {
      schema: {
        tags: ['identity'],
        summary: 'Revoke the current session',
        security: [{ bearerAuth: [] }],
        response: {
          200: logoutResponseSchema,
          500: apiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const credential = bearerCredential(request.headers.authorization);

      // Logout is idempotent: absent, malformed, expired, or already-revoked
      // credentials receive the same acknowledgement.
      if (credential) {
        await options.sessions.logout(credential);
      }

      return reply.code(200).send({
        data: { message: 'Logged out.' },
      });
    },
  );
};
