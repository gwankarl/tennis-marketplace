import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { ApplicationError } from '../../http/application-error.js';
import { apiErrorEnvelopeSchema } from '../../http/error.schema.js';
import type { SessionService } from '../identity/sessions/session.service.js';
import {
  sellerApplicationDraftCreateBodySchema,
  sellerApplicationDraftInputSchema,
  sellerApplicationDraftPatchSchema,
  sellerApplicationDraftResponseSchema,
} from './seller-application-api.schema.js';
import type { SellerApplicationService } from './seller-application.service.js';
import type { SellerApplicationDraftRecord } from './seller-application.repository.js';

export interface SellerApplicationRoutesOptions {
  service: SellerApplicationService;
  sessions: Pick<SessionService, 'current'>;
}

function bearerCredential(authorization: string | undefined): string | null {
  const match = authorization
    ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization)
    : null;

  return match?.[1] ?? null;
}

async function authenticatedAccountId(
  authorization: string | undefined,
  sessions: Pick<SessionService, 'current'>,
): Promise<string> {
  const credential = bearerCredential(authorization);
  const session = credential ? await sessions.current(credential) : null;

  if (!session) {
    throw new ApplicationError(
      'UNAUTHENTICATED',
      'Authentication is required.',
    );
  }

  return session.userId;
}

function responseApplication(application: SellerApplicationDraftRecord) {
  return {
    id: application.id,
    status: 'draft' as const,
    sellerType: application.sellerType,
    applicantRelationship: application.applicantRelationship,
    proposedStoreName: application.proposedStoreName,
    privateContactPhone: application.privateContactPhone,
    city: application.city,
    neighborhood: application.neighborhood,
    sellerDescription: application.sellerDescription,
    inventoryCondition: application.inventoryCondition,
    fulfillmentOption: application.fulfillmentOption,
    businessTradingName: application.businessTradingName,
    businessContactName: application.businessContactName,
    registrationStatus: application.registrationStatus,
    registrationReference: application.registrationReference,
    privateOperatingAddress: application.privateOperatingAddress,
    createdAt: application.createdAt.toISOString(),
    updatedAt: application.updatedAt.toISOString(),
  };
}

const draftErrorResponses = {
  401: apiErrorEnvelopeSchema,
  403: apiErrorEnvelopeSchema,
  404: apiErrorEnvelopeSchema,
  409: apiErrorEnvelopeSchema,
  422: apiErrorEnvelopeSchema,
  500: apiErrorEnvelopeSchema,
};

export const sellerApplicationRoutes: FastifyPluginAsync<
  SellerApplicationRoutesOptions
> = async (app, options) => {
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('pragma', 'no-cache');
  });

  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    '/api/v1/seller-applications/me',
    {
      schema: {
        tags: ['seller-onboarding'],
        summary: 'Get the current user seller application draft',
        security: [{ bearerAuth: [] }],
        response: {
          200: sellerApplicationDraftResponseSchema,
          ...draftErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const accountId = await authenticatedAccountId(
        request.headers.authorization,
        options.sessions,
      );
      const application = await options.service.getDraft(accountId);

      return reply.code(200).send({
        data: {
          application: application ? responseApplication(application) : null,
        },
      });
    },
  );

  routes.post(
    '/api/v1/seller-applications/me',
    {
      schema: {
        tags: ['seller-onboarding'],
        summary: 'Create or retrieve the current user seller application draft',
        security: [{ bearerAuth: [] }],
        body: sellerApplicationDraftCreateBodySchema,
        response: {
          200: sellerApplicationDraftResponseSchema,
          ...draftErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const accountId = await authenticatedAccountId(
        request.headers.authorization,
        options.sessions,
      );
      const application = await options.service.createOrGetDraft(
        accountId,
        request.body ?? {},
      );

      return reply.code(200).send({
        data: { application: responseApplication(application) },
      });
    },
  );

  routes.patch(
    '/api/v1/seller-applications/me',
    {
      schema: {
        tags: ['seller-onboarding'],
        summary: 'Update the current user seller application draft',
        security: [{ bearerAuth: [] }],
        body: sellerApplicationDraftPatchSchema,
        response: {
          200: sellerApplicationDraftResponseSchema,
          ...draftErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const accountId = await authenticatedAccountId(
        request.headers.authorization,
        options.sessions,
      );
      const application = await options.service.updateDraft(
        accountId,
        request.body,
      );

      return reply.code(200).send({
        data: { application: responseApplication(application) },
      });
    },
  );
};
