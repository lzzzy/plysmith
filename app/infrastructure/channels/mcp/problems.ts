import { randomUUID } from 'node:crypto';

import type { HostProblem } from './host-client.ts';

export function hostProblem(error: unknown): HostProblem {
  try {
    if (isRecord(error) && isRecord(error.problem)) {
      const problem = error.problem;
      if (
        typeof problem.type === 'string' &&
        typeof problem.title === 'string' &&
        typeof problem.detail === 'string' &&
        typeof problem.instance === 'string' &&
        typeof problem.code === 'string' &&
        typeof problem.correlationId === 'string' &&
        typeof problem.retryable === 'boolean' &&
        typeof problem.status === 'number' &&
        Number.isInteger(problem.status) &&
        problem.status >= 400 &&
        problem.status <= 599 &&
        isRecord(problem.parameters)
      ) {
        const parameters: {
          expectedRevision?: number;
          currentRevision?: number;
        } = {};
        for (const key of ['expectedRevision', 'currentRevision'] as const) {
          const value = problem.parameters[key];
          if (value !== undefined) {
            if (
              typeof value !== 'number' ||
              !Number.isSafeInteger(value) ||
              value < 1
            ) {
              return localProblem('host.failure');
            }
            parameters[key] = value;
          }
        }
        // Only fields from the shared contract may cross the MCP boundary.
        return {
          type: problem.type,
          title: problem.title,
          status: problem.status,
          detail: problem.detail,
          instance: problem.instance,
          code: problem.code,
          correlationId: problem.correlationId,
          retryable: problem.retryable,
          parameters,
        };
      }
    }
  } catch {
    return localProblem('host.failure');
  }
  return localProblem('host.failure');
}

export function localProblem(
  code: 'request.invalid' | 'host.failure',
): HostProblem {
  const correlationId = randomUUID();
  const invalid = code === 'request.invalid';
  return {
    type: `https://github.com/lzzzy/plysmith/blob/main/docs/problems/${code}.md`,
    title: invalid ? 'Invalid request' : 'Host failure',
    status: invalid ? 400 : 500,
    detail: invalid
      ? 'The request does not match the MCP tool contract.'
      : 'The host could not complete the operation.',
    instance: `urn:plysmith:problem:${correlationId}`,
    code,
    correlationId,
    retryable: false,
    parameters: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
