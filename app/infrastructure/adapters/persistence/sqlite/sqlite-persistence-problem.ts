import { ApplicationProblem } from '../../../../application/problems/application-problem.ts';

export class SqlitePersistenceProblem extends ApplicationProblem {
  constructor(
    problemCode:
      | 'persistence.incompatible_store'
      | 'persistence.unsupported_runtime'
      | 'persistence.startup_failed'
      | 'persistence.unavailable'
      | 'persistence.closed',
  ) {
    super(problemCode, 'The local persistence store is unavailable.');
    this.name = 'SqlitePersistenceProblem';
  }
}
