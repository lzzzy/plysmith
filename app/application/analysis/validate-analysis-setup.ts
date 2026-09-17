import {
  analysisSetupFromState,
  type AnalysisSetupValidation,
} from '../../domain/chess_graph/index.ts';
import type { ChessRulesPort } from '../chess_graph/index.ts';
import type { ValidateAnalysisSetupRequest } from './analysis-models.ts';

export interface ValidateAnalysisSetupUseCase {
  execute(
    request: ValidateAnalysisSetupRequest,
  ): Promise<AnalysisSetupValidation>;
}

export class ValidateAnalysisSetup implements ValidateAnalysisSetupUseCase {
  readonly #rules: ChessRulesPort;

  constructor(dependencies: { readonly rules: ChessRulesPort }) {
    this.#rules = dependencies.rules;
  }

  async execute(
    request: ValidateAnalysisSetupRequest,
  ): Promise<AnalysisSetupValidation> {
    if (request.input.kind === 'position_setup') {
      return this.#rules.validateSetup(request.input.setup);
    }
    const parsed = this.#rules.parseFen(request.input.fen);
    if (!parsed.ok) {
      return Object.freeze({
        valid: false,
        issues: Object.freeze([
          Object.freeze({ code: 'invalid_fen', field: 'fen' }),
        ]),
      });
    }
    return Object.freeze({
      valid: true,
      setup: analysisSetupFromState(parsed.value),
      state: parsed.value,
    });
  }
}
