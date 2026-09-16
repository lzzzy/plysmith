import type { AnalysisScratch } from '../../domain/analysis/index.ts';
import type { WorkScope } from '../../domain/workspace/index.ts';
import {
  analysisScratchNotFound,
  analysisScratchRevisionConflict,
} from '../analysis/analysis-problems.ts';
import type { ContextAnalysisReader } from '../analysis/analysis-ports.ts';
import type { FreeAnalysisSession } from '../analysis/free-analysis-session.ts';

export async function readRevisionScratch(input: {
  readonly scope: WorkScope;
  readonly expectedScratchId: string;
  readonly expectedScratchRevision: number;
  readonly contextReader: ContextAnalysisReader;
  readonly freeSession: FreeAnalysisSession;
}): Promise<AnalysisScratch> {
  const scratch =
    input.scope.kind === 'free'
      ? input.freeSession.read()
      : (
          await input.contextReader.readContextAnalysisWorkspace(
            input.scope.contextId,
          )
        )?.scratch;
  assertRevisionScratch(
    scratch,
    input.expectedScratchId,
    input.expectedScratchRevision,
  );
  return scratch;
}

export function assertRevisionScratch(
  scratch: AnalysisScratch | undefined,
  expectedScratchId: string,
  expectedScratchRevision: number,
): asserts scratch is AnalysisScratch {
  if (scratch === undefined) throw analysisScratchNotFound();
  if (
    scratch.scratchId !== expectedScratchId ||
    scratch.scratchRevision !== expectedScratchRevision
  ) {
    throw analysisScratchRevisionConflict(
      expectedScratchRevision,
      scratch.scratchRevision,
    );
  }
  if (scratch.intent.kind !== 'inventory_revision') {
    throw analysisScratchNotFound();
  }
}
