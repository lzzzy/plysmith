import {
  PositionAnalysisProviderError,
  type AnalysisWdl,
  type PositionAnalysisFailureCode,
} from '../../../application/analysis/index.ts';
import { LineProcessProblem } from '../process/index.ts';
import { UciProtocolProblem } from './uci/index.ts';

export function mapPositionAnalysisRuntimeError(error: unknown): never {
  if (error instanceof PositionAnalysisProviderError) throw error;
  if (error instanceof UciProtocolProblem) {
    throw new PositionAnalysisProviderError(
      error.code === 'capability_missing'
        ? 'capability_missing'
        : 'provider_protocol_error',
      error,
    );
  }
  if (error instanceof LineProcessProblem) {
    const codes: Record<string, PositionAnalysisFailureCode> = {
      process_busy: 'provider_resource_exhausted',
      process_timeout: 'provider_timeout',
      process_output_limit: 'provider_resource_exhausted',
      process_interrupted: 'interrupted',
      process_start_failed: 'provider_unavailable',
      process_failed: 'provider_protocol_error',
    };
    throw new PositionAnalysisProviderError(
      codes[error.code] ?? 'provider_protocol_error',
      error,
    );
  }
  throw new PositionAnalysisProviderError('provider_protocol_error', error);
}

export function analysisWdl(
  values: readonly [number, number, number],
  input: Pick<AnalysisWdl, 'perspective' | 'semantics'>,
): AnalysisWdl {
  if (
    values.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    values[0] + values[1] + values[2] !== 1_000
  ) {
    throw new PositionAnalysisProviderError('provider_protocol_error');
  }
  return Object.freeze({
    wins: values[0],
    draws: values[1],
    losses: values[2],
    ...input,
  });
}
