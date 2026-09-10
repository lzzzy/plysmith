import type { components } from '../../../../contracts/host/index.ts';

export type SafeHostProblem = components['schemas']['ProblemDetails'];

export class HostClientProblem extends Error {
  readonly problem: SafeHostProblem;

  constructor(problem: SafeHostProblem) {
    super(problem.code);
    this.name = 'HostClientProblem';
    this.problem = Object.freeze({
      ...problem,
      parameters: Object.freeze({ ...problem.parameters }),
    });
  }
}

export function localHostProblem(
  code: 'host.contract_mismatch' | 'host.unavailable',
): HostClientProblem {
  const correlationId = globalThis.crypto.randomUUID();
  const unavailable = code === 'host.unavailable';
  return new HostClientProblem({
    type: `https://github.com/lzzzy/plysmith/blob/main/docs/problems/${code}.md`,
    title: unavailable ? 'Host unavailable' : 'Host contract mismatch',
    status: unavailable ? 503 : 409,
    detail: unavailable
      ? 'The local Plysmith Application Host is not available.'
      : 'The local Plysmith components do not use the same contract.',
    instance: `urn:plysmith:problem:${correlationId}`,
    code,
    correlationId,
    retryable: unavailable,
    parameters: {},
  });
}
