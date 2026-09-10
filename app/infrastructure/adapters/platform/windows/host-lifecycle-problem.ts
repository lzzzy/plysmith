export type HostLifecycleProblemCode =
  | 'host.already_running'
  | 'host.discovery_invalid'
  | 'host.discovery_missing'
  | 'host.lease_unavailable';

export class HostLifecycleProblem extends Error {
  readonly code: HostLifecycleProblemCode;

  constructor(code: HostLifecycleProblemCode) {
    super(code);
    this.name = 'HostLifecycleProblem';
    this.code = code;
  }
}
