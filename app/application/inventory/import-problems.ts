import { ApplicationProblem } from '../problems/application-problem.ts';

export function importProblem(reason: string): ApplicationProblem {
  return new ApplicationProblem(`import.${reason}`, `Import: ${reason}.`);
}
