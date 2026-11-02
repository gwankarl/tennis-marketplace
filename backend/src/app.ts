import Fastify from 'fastify';

export function buildApp() {
  const app = Fastify({ logger: true });

  // This is a process-health check; database connectivity is checked separately.
  app.get('/api/v1/health', async () => ({
    data: { status: 'ok' },
  }));

  return app;
}
