export type ProblemParameter = string | number | boolean;

export class ApplicationProblem extends Error {
  readonly problemCode: string;
  readonly retryable: boolean;
  readonly parameters: Readonly<Record<string, ProblemParameter>>;

  constructor(
    problemCode: string,
    message: string,
    parameters: Readonly<Record<string, ProblemParameter>> = {},
  ) {
    super(message);
    this.name = 'ApplicationProblem';
    this.problemCode = problemCode;
    this.retryable = false;
    this.parameters = Object.freeze({ ...parameters });
  }
}
