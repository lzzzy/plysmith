export type ProductionHostStartupCode =
  | 'already_running'
  | 'incompatible_data'
  | 'invalid_configuration'
  | 'startup_failed';

export type ProductionHostStartupMessage =
  | { readonly type: 'ready' }
  | {
      readonly type: 'startup_blocked';
      readonly code: ProductionHostStartupCode;
    };

export class ProductionHostStartupProblem extends Error {
  readonly code: ProductionHostStartupCode | 'timeout';

  constructor(code: ProductionHostStartupCode | 'timeout') {
    super(`The Plysmith Host could not start: ${code}`);
    this.name = 'ProductionHostStartupProblem';
    this.code = code;
  }
}
