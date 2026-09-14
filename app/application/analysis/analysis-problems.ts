import type { ChessRulesFailure } from '../chess_graph/index.ts';
import { ApplicationProblem } from '../problems/application-problem.ts';

export function invalidAnalysisUpdate(): ApplicationProblem {
  return new ApplicationProblem(
    'analysis.invalid_update',
    'The analysis scratch update is invalid.',
  );
}

export function analysisScratchNotFound(): ApplicationProblem {
  return new ApplicationProblem(
    'analysis.scratch_not_found',
    'The analysis scratch does not exist.',
  );
}

export function analysisScratchRevisionConflict(
  expectedRevision: number | null,
  currentRevision: number | null,
): ApplicationProblem {
  return new ApplicationProblem(
    'analysis.scratch_revision_conflict',
    'The analysis scratch has changed. Read the workspace first.',
    {
      expectedRevision: expectedRevision ?? 0,
      currentRevision: currentRevision ?? 0,
    },
  );
}

export function invalidAnalysisRecord(): ApplicationProblem {
  return new ApplicationProblem(
    'analysis.invalid_record',
    'The analysis record input or note draft is invalid.',
  );
}

export function invalidAnalysisNote(): ApplicationProblem {
  return new ApplicationProblem(
    'analysis.invalid_note',
    'The analysis note, source anchor or visibility is invalid.',
  );
}

export function analysisNoteRevisionConflict(
  expectedRevision: number,
  currentRevision: number,
): ApplicationProblem {
  return new ApplicationProblem(
    'analysis.note_revision_conflict',
    'The analysis note has changed. Read the workspace first.',
    { expectedRevision, currentRevision },
  );
}

export function chessRulesProblem(
  reason: ChessRulesFailure,
): ApplicationProblem {
  return new ApplicationProblem(
    `chess.${reason}`,
    'The chess position, line or move is invalid.',
  );
}
