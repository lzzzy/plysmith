import type Database from 'better-sqlite3';
import type {
  AnalysisScratch,
  AnalysisScratchIntent,
  AnalysisScratchOrigin,
} from '../../../../domain/analysis/index.ts';
import type {
  HistoryKnowledge,
  PromotionPiece,
} from '../../../../domain/chess_graph/index.ts';
import {
  localId,
  type WorkingContextId,
} from '../../../../domain/identity/index.ts';
import {
  invalidAnalysisUpdate,
  analysisScratchHasChanges,
} from '../../../../application/analysis/index.ts';
import { readChessState } from './sqlite-chess-state.ts';
import { readInventoryRevisionLine } from './sqlite-analysis-line.ts';

interface ScratchRow {
  readonly scratchId: number;
  readonly scratchKey: string;
  readonly originMode: AnalysisScratchOrigin['kind'];
  readonly originItemId: number | null;
  readonly originRevisionId: number | null;
  readonly originAnchorId: number | null;
  readonly rootPositionId: number;
  readonly rootHalfmoveClock: number;
  readonly rootFullmoveNumber: number;
  readonly rootHistoryKnowledge: HistoryKnowledge;
  readonly cursor: number;
  readonly scratchRevision: number;
  readonly noteBody: string | null;
  readonly scratchMode: AnalysisScratchIntent['kind'];
  readonly editMode:
    | 'extend'
    | 'truncate_after'
    | 'replace_move'
    | 'metadata'
    | 'add_variation'
    | null;
  readonly editItemId: number | null;
  readonly baseRevisionId: number | null;
  readonly cutAnchorId: number | null;
  readonly returnAnchorId: number | null;
  readonly candidateDisplayName: string | null;
  readonly candidateSummary: string | null;
}

interface ScratchStepRow {
  readonly stepIndex: number;
  readonly beforePositionId: number;
  readonly beforeHalfmoveClock: number;
  readonly beforeFullmoveNumber: number;
  readonly afterPositionId: number;
  readonly afterHalfmoveClock: number;
  readonly afterFullmoveNumber: number;
  readonly from: string;
  readonly to: string;
  readonly promotion: PromotionPiece | null;
  readonly san: string;
}

export function readContextScratch(
  database: Database.Database,
  contextId: WorkingContextId | null,
): AnalysisScratch | undefined {
  const row = database
    .prepare(
      `SELECT scratch_draft_id AS scratchId,
              scratch_key AS scratchKey,
              origin_mode AS originMode,
              origin_item_id AS originItemId,
              origin_revision_id AS originRevisionId,
              origin_anchor_id AS originAnchorId,
              root_position_id AS rootPositionId,
              root_halfmove_clock AS rootHalfmoveClock,
              root_fullmove_number AS rootFullmoveNumber,
              root_history_knowledge AS rootHistoryKnowledge,
              cursor_index AS cursor,
              scratch_revision AS scratchRevision,
              note_body AS noteBody,
              scratch_mode AS scratchMode, edit_mode AS editMode,
              edit_item_id AS editItemId, base_revision_id AS baseRevisionId,
              cut_anchor_id AS cutAnchorId, return_anchor_id AS returnAnchorId,
              candidate_display_name AS candidateDisplayName,
              candidate_summary_text AS candidateSummary
         FROM analysis_scratch_draft WHERE context_id IS ?`,
    )
    .get(contextId?.value ?? null) as ScratchRow | undefined;
  if (row === undefined) return undefined;
  const stepRows = database
    .prepare(
      `SELECT step_index AS stepIndex,
              before_position_id AS beforePositionId,
              before_halfmove_clock AS beforeHalfmoveClock,
              before_fullmove_number AS beforeFullmoveNumber,
              after_position_id AS afterPositionId,
              after_halfmove_clock AS afterHalfmoveClock,
              after_fullmove_number AS afterFullmoveNumber,
              from_square AS 'from', to_square AS 'to', promotion, san
         FROM analysis_scratch_step
        WHERE scratch_draft_id = ? ORDER BY step_index`,
    )
    .all(row.scratchId) as ScratchStepRow[];
  if (
    row.cursor > stepRows.length ||
    stepRows.some((step, index) => step.stepIndex !== index)
  ) {
    throw invalidAnalysisUpdate();
  }
  const root = readChessState(
    database,
    localId('position', row.rootPositionId),
    {
      halfmoveClock: row.rootHalfmoveClock,
      fullmoveNumber: row.rootFullmoveNumber,
      historyKnowledge: row.rootHistoryKnowledge,
    },
  );
  const steps = Object.freeze(
    stepRows.map((step, index) => {
      const beforeHistory =
        index === 0
          ? row.rootHistoryKnowledge
          : continuedHistory(row.rootHistoryKnowledge);
      const afterHistory = continuedHistory(row.rootHistoryKnowledge);
      return Object.freeze({
        before: readChessState(
          database,
          localId('position', step.beforePositionId),
          {
            halfmoveClock: step.beforeHalfmoveClock,
            fullmoveNumber: step.beforeFullmoveNumber,
            historyKnowledge: beforeHistory,
          },
        ),
        move: Object.freeze({
          from: step.from,
          to: step.to,
          ...(step.promotion === null ? {} : { promotion: step.promotion }),
          san: step.san,
        }),
        after: readChessState(
          database,
          localId('position', step.afterPositionId),
          {
            halfmoveClock: step.afterHalfmoveClock,
            fullmoveNumber: step.afterFullmoveNumber,
            historyKnowledge: afterHistory,
          },
        ),
      });
    }),
  );
  const origin = mapOrigin(row);
  const intent = mapIntent(row);
  const scratch: AnalysisScratch = {
    scratchId: row.scratchKey,
    scratchRevision: row.scratchRevision,
    origin,
    intent,
    root,
    steps,
    cursor: row.cursor,
    ...(row.noteBody === null
      ? {}
      : {
          noteDraft: Object.freeze({
            moves: Object.freeze(
              steps.slice(0, row.cursor).map((step) => step.move),
            ),
            body: row.noteBody,
          }),
        }),
  };
  return Object.freeze(scratch);
}

export function readScratchHasChanges(
  database: Database.Database,
  scratch: AnalysisScratch | undefined,
): boolean {
  const base =
    scratch?.intent.kind === 'inventory_revision'
      ? readInventoryRevisionLine(
          database,
          scratch.intent.itemId,
          scratch.intent.baseRevisionId,
        )
      : undefined;
  return analysisScratchHasChanges(scratch, base);
}

function mapOrigin(row: ScratchRow): AnalysisScratchOrigin {
  if (row.originMode !== 'inventory_anchor') {
    return Object.freeze({ kind: row.originMode });
  }
  if (
    row.originItemId === null ||
    row.originRevisionId === null ||
    row.originAnchorId === null
  ) {
    throw invalidAnalysisUpdate();
  }
  return Object.freeze({
    kind: 'inventory_anchor',
    itemId: localId('inventory-item', row.originItemId),
    revisionId: localId('item-revision', row.originRevisionId),
    anchorId: localId('anchor', row.originAnchorId),
  });
}

function mapIntent(row: ScratchRow): AnalysisScratchIntent {
  if (row.scratchMode === 'exploration') {
    return Object.freeze({ kind: 'exploration' });
  }
  if (
    row.editMode === null ||
    row.editItemId === null ||
    row.baseRevisionId === null ||
    row.cutAnchorId === null ||
    row.returnAnchorId === null ||
    row.candidateDisplayName === null
  ) {
    throw invalidAnalysisUpdate();
  }
  return Object.freeze({
    kind: 'inventory_revision',
    mode: row.editMode,
    itemId: localId('inventory-item', row.editItemId),
    baseRevisionId: localId('item-revision', row.baseRevisionId),
    cutAnchorId: localId('anchor', row.cutAnchorId),
    returnAnchorId: localId('anchor', row.returnAnchorId),
    displayName: row.candidateDisplayName,
    ...(row.candidateSummary === null ? {} : { summary: row.candidateSummary }),
  });
}

function continuedHistory(root: HistoryKnowledge): HistoryKnowledge {
  return root === 'complete' ? 'complete' : 'partial';
}
