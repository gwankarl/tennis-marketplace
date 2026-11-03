import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { ApplicationError } from '../../../http/application-error.js';
import { apiErrorEnvelopeSchema } from '../../../http/error.schema.js';
import type { SessionService } from '../sessions/session.service.js';
import type { UserProfileService } from './profile.service.js';
import {
  updateProfileRequestSchema,
  userProfileResponseSchema,
} from './profile.schema.js';

export interface UserProfileRoutesOptions {
  service: UserProfileService;
  sessions: Pick<SessionService, 'current'>;
}

function bearerCredential(authorization: string | undefined): string | null {
  const match = authorization
    ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization)
    : null;

  return match?.[1] ?? null;
}

function unauthenticatedError(): ApplicationError {
  return new ApplicationError('UNAUTHENTICATED', 'Authentication is required.');
}

export const userProfileRoutes: FastifyPluginAsync<
  UserProfileRoutesOptions
> = async (app, options) => {
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('pragma', 'no-cache');
  });

  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    '/api/v1/users/me',
    {
      schema: {
        tags: ['identity'],
        summary: 'Get the current user profile',
        security: [{ bearerAuth: [] }],
        response: {
          200: userProfileResponseSchema,
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
        throw unauthenticatedError();
      }

      const profile = await options.service.get(session.userId);

      if (!profile) {
        throw unauthenticatedError();
      }

      return reply.code(200).send({
        data: {
          profile: {
            firstName: profile.firstName,
            lastName: profile.lastName,
            email: profile.email,
            emailVerified: profile.emailVerified,
            createdAt: profile.createdAt.toISOString(),
          },
        },
      });
    },
  );

  routes.patch(
    '/api/v1/users/me',
    {
      schema: {
        tags: ['identity'],
        summary: 'Update the current user profile names',
        security: [{ bearerAuth: [] }],
        body: updateProfileRequestSchema,
        response: {
          200: userProfileResponseSchema,
          401: apiErrorEnvelopeSchema,
          422: apiErrorEnvelopeSchema,
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
        throw unauthenticatedError();
      }

      const profile = await options.service.update(
        session.userId,
        request.body,
      );

      if (!profile) {
        throw unauthenticatedError();
      }

      return reply.code(200).send({
        data: {
          profile: {
            firstName: profile.firstName,
            lastName: profile.lastName,
            email: profile.email,
            emailVerified: profile.emailVerified,
            createdAt: profile.createdAt.toISOString(),
          },
        },
      });
    },
  );
};
