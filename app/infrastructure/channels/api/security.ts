import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiProblem } from './problems.ts';
import { problemResponses } from './schemas.ts';

export const uiOrigin = 'app://plysmith';
const allowedHeaders = [
  'authorization',
  'content-type',
  'last-event-id',
  'x-plysmith-correlation-id',
];
const methodsByPath: Readonly<Record<string, readonly string[]>> = {
  '/status': ['GET'],
  '/preferences': ['GET'],
  '/preferences/ui-language': ['PUT'],
  '/diagnostics/settings': ['GET'],
  '/diagnostics/settings/log-level': ['PUT'],
  '/diagnostics/report-manifest': ['GET'],
  '/diagnostics/reports': ['POST'],
  '/events': ['GET'],
  '/analysis/providers': ['GET'],
  '/analysis/position': ['POST'],
  '/analysis/workspace': ['GET'],
  '/analysis/setup-validation': ['POST'],
  '/analysis/scratch': ['PUT'],
  '/analysis/notes': ['POST'],
  '/analysis/position-notes': ['POST'],
  '/engine-providers/configurations': ['GET'],
  '/engine-providers/configuration-preview': ['POST'],
  '/inventory': ['GET'],
  '/inventory/analysis-records': ['POST'],
  '/inventory/revision-edits/preview': ['POST'],
  '/inventory/revision-edits/save': ['POST'],
  '/playout/providers': ['GET'],
  '/playout': ['GET', 'POST', 'DELETE'],
  '/playout/moves': ['POST'],
  '/playout/retry': ['POST'],
  '/playout/pause': ['POST'],
  '/playout/resume': ['POST'],
  '/playout/stop': ['POST'],
  '/playout/cancel-completion': ['POST'],
  '/playout/complete': ['POST'],
  '/working-contexts': ['GET', 'POST'],
  '/workspace/scope': ['GET'],
  '/workspace/startup': ['GET', 'PUT'],
  '/workspace/resume': ['PUT'],
};

function allowedMethodsFor(requestUrl: string): readonly string[] | undefined {
  let pathname: string;
  try {
    pathname = new URL(requestUrl, 'http://127.0.0.1').pathname;
  } catch {
    return undefined;
  }
  const staticMethods = methodsByPath[pathname];
  if (staticMethods !== undefined) return staticMethods;
  if (/^\/analysis\/notes\/[^/]+$/.test(pathname)) return ['PATCH', 'DELETE'];
  if (/^\/engine-providers\/configurations\/[^/]+$/.test(pathname))
    return ['PUT', 'DELETE'];
  if (/^\/inventory\/items\/[^/]+\/revision-edits$/.test(pathname))
    return ['POST'];
  if (
    /^\/inventory\/items\/[^/]+\/revision-edits\/promote-analysis$/.test(
      pathname,
    )
  )
    return ['POST'];
  if (/^\/inventory\/items\/[^/]+\/revisions$/.test(pathname)) return ['GET'];
  if (/^\/inventory\/items\/[^/]+\/revisions\/[^/]+$/.test(pathname))
    return ['GET'];
  if (/^\/workspace\/revision-impacts\/[^/]+$/.test(pathname)) return ['GET'];
  if (/^\/workspace\/revision-impacts\/[^/]+\/resolution$/.test(pathname))
    return ['POST'];
  if (/^\/inventory\/items\/[^/]+$/.test(pathname)) return ['DELETE'];
  if (/^\/inventory\/items\/[^/]+\/deletion-preview$/.test(pathname))
    return ['GET'];
  if (/^\/working-contexts\/[^/]+$/.test(pathname)) return ['GET', 'DELETE'];
  if (/^\/working-contexts\/[^/]+\/deletion-preview$/.test(pathname))
    return ['GET'];
  if (
    /^\/working-contexts\/[^/]+\/items\/[^/]+\/removal-preview$/.test(pathname)
  )
    return ['GET'];
  if (/^\/working-contexts\/[^/]+\/metadata$/.test(pathname)) return ['PUT'];
  if (/^\/working-contexts\/[^/]+\/items\/[^/]+$/.test(pathname))
    return ['DELETE'];
  if (/^\/working-contexts\/[^/]+\/references$/.test(pathname)) return ['POST'];
  return undefined;
}

function isLocalHost(request: FastifyRequest): boolean {
  const authority = request.headers.host;
  if (typeof authority !== 'string') return false;
  const match = /^127\.0\.0\.1(?::([1-9]\d{0,4}))?$/.exec(authority);
  if (!match) return false;
  const port = match[1] === undefined ? 80 : Number(match[1]);
  if (port > 65535) return false;
  // inject has no socket port. Real connections must target this exact host.
  return !request.raw.socket.localPort || port === request.raw.socket.localPort;
}

function hasDuplicateSecurityHeader(request: FastifyRequest): boolean {
  const seen = new Set<string>();
  for (let index = 0; index < request.raw.rawHeaders.length; index += 2) {
    const name = request.raw.rawHeaders[index]?.toLowerCase();
    if (name !== 'host' && name !== 'origin' && name !== 'authorization')
      continue;
    if (seen.has(name)) return true;
    seen.add(name);
  }
  return false;
}

export function installSecurity(host: FastifyInstance, hostToken: string) {
  if (!/^[A-Za-z0-9._~+/-]+=*$/.test(hostToken)) {
    throw new Error('A non-empty bearer token is required to build the host.');
  }
  const expectedToken = Buffer.from(hostToken);
  host.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('vary', 'Origin');
    if (!isLocalHost(request) || hasDuplicateSecurityHeader(request)) {
      throw new ApiProblem('host.invalid_host');
    }
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== uiOrigin) {
      throw new ApiProblem('host.invalid_origin');
    }
    if (origin === uiOrigin)
      reply.header('access-control-allow-origin', uiOrigin);

    if (request.method === 'OPTIONS') {
      const method = request.headers['access-control-request-method'];
      const headers = request.headers['access-control-request-headers'];
      const allowedMethods = allowedMethodsFor(request.url);
      if (
        origin !== uiOrigin ||
        typeof method !== 'string' ||
        !allowedMethods?.includes(method) ||
        (headers !== undefined &&
          (typeof headers !== 'string' ||
            headers
              .split(',')
              .some(
                (header) =>
                  !allowedHeaders.includes(header.trim().toLowerCase()),
              )))
      ) {
        throw new ApiProblem('host.invalid_preflight');
      }
      reply.header(
        'vary',
        'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
      );
      reply.header('access-control-allow-methods', allowedMethods.join(', '));
      reply.header('access-control-allow-headers', allowedHeaders.join(', '));
      return reply.code(204).send();
    }

    const authorization = request.headers.authorization;
    const match =
      typeof authorization === 'string'
        ? /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(authorization)
        : null;
    const suppliedToken = Buffer.from(match?.[1] ?? '');
    if (
      suppliedToken.length !== expectedToken.length ||
      !timingSafeEqual(suppliedToken, expectedToken)
    ) {
      throw new ApiProblem('host.unauthorized');
    }
  });
}

export function registerPreflight(host: FastifyInstance) {
  host.options(
    '/*',
    {
      schema: {
        hide: true,
        response: { 204: { type: 'null' }, ...problemResponses },
      },
    },
    async (_request, reply) => reply.code(204).send(),
  );
}
