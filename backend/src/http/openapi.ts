import swagger from '@fastify/swagger';
import type { FastifyInstance } from 'fastify';
import { jsonSchemaTransform } from '@fastify/type-provider-zod';

export function registerOpenApi(app: FastifyInstance): void {
  app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Tennis Xpress API',
        version: '0.1.0',
      },
    },
    transform: jsonSchemaTransform,
  });
}
