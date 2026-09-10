import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import { fastifySSE } from '@fastify/sse';
import type { HostDependencies } from './host-dependencies.ts';
import { registerEventsRoute } from './events-route.ts';
import { installProblemHandling } from './problems.ts';
import { registerUseCaseRoutes } from './routes.ts';
import { apiSchemas, EventHeadersSchema } from './schemas.ts';
import { installSecurity, registerPreflight } from './security.ts';

export async function buildHost(dependencies: HostDependencies) {
  const host = Fastify({
    logger: false,
    exposeHeadRoutes: false,
    trustProxy: false,
    bodyLimit: 16 * 1024,
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false,
        useDefaults: false,
      },
    },
  });
  installProblemHandling(host, dependencies.correlationIdFactory);
  installSecurity(host, dependencies.security.hostToken);

  await host.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Plysmith Application Host',
        version: dependencies.productRelease,
      },
      components: {
        securitySchemes: { hostBearer: { type: 'http', scheme: 'bearer' } },
      },
      security: [{ hostBearer: [] }],
    },
    refResolver: {
      buildLocalReference: (schema, _baseUri, _fragment, index) =>
        typeof schema.$id === 'string' ? schema.$id : `Schema${index}`,
    },
    // Only the selected cursor header is schema-validated in the handler.
    // Normal protocol headers must not become forbidden extra properties.
    transform: ({ schema, url }) => ({
      url,
      schema:
        url === '/events' ? { ...schema, headers: EventHeadersSchema } : schema,
    }),
  });
  await host.register(fastifySSE);
  for (const schema of apiSchemas) host.addSchema(schema);
  registerPreflight(host);
  registerUseCaseRoutes(host, dependencies);
  registerEventsRoute(host, dependencies.events);
  await host.ready();
  return host;
}
