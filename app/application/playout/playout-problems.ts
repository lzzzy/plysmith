import { ApplicationProblem } from '../problems/application-problem.ts';
import type { MovePolicyFailureCode } from './playout-ports.ts';

export function invalidPlayout(): ApplicationProblem {
  return new ApplicationProblem(
    'playout.invalid',
    'The playout request is invalid.',
  );
}

export function playoutNotFound(): ApplicationProblem {
  return new ApplicationProblem(
    'playout.not_found',
    'The playout draft does not exist.',
  );
}

export function playoutConflict(
  expectedRevision: number,
  currentRevision: number,
): ApplicationProblem {
  return new ApplicationProblem(
    'playout.revision_conflict',
    'The playout draft has changed. Read it before continuing.',
    { expectedRevision, currentRevision },
  );
}

export function movePolicyUnavailable(): ApplicationProblem {
  return new ApplicationProblem(
    'playout.move_policy_unavailable',
    'The selected move policy is unavailable.',
  );
}

export function movePolicyFailed(
  code: MovePolicyFailureCode = 'provider_protocol_error',
): ApplicationProblem {
  return new ApplicationProblem(
    `playout.${code}`,
    'The move policy could not produce a legal move.',
  );
}
