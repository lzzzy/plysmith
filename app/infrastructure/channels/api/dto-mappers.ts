import type {
  AnalysisNoteMutationResult,
  AnalysisRecordView,
  AnalysisWorkspace,
  CreateAnalysisRecordResult,
  CreateAnalysisNoteResult,
  UpdateAnalysisScratchAction,
  UpdateAnalysisScratchResult,
} from '../../../application/analysis/index.ts';
import type {
  InventorySearchItem,
  SearchInventoryResult,
} from '../../../application/inventory/index.ts';
import type {
  AddContextReferenceResult,
  AnalysisResume,
  ContextReferenceSummary,
  CreateWorkingContextResult,
  ManagementResume,
  SetWorkScopeResumeRequest,
  SetWorkScopeResumeResult,
  WorkingContextSummary,
  WorkingContextWorkspace,
} from '../../../application/workspace/index.ts';
import type { AnalysisScratch } from '../../../domain/analysis/index.ts';
import type {
  CanonicalMove,
  ChessState,
} from '../../../domain/chess_graph/index.ts';
import { localId, type LocalIdKind } from '../../../domain/identity/index.ts';
import {
  contextWorkScope,
  freeWorkScope,
  type WorkScope,
} from '../../../domain/workspace/index.ts';
import { ApiProblem } from './problems.ts';

interface WireScope {
  readonly kind: 'free' | 'context';
  readonly contextId?: string;
}

interface AnalysisWorkspaceQuery {
  readonly scopeKind: 'free' | 'context';
  readonly contextId?: string;
  readonly itemId?: string;
  readonly revisionId?: string;
  readonly anchorId?: string;
}

export function parseAnalysisWorkspaceQuery(query: AnalysisWorkspaceQuery) {
  const scope = parseWorkScope({
    kind: query.scopeKind,
    ...(query.contextId === undefined ? {} : { contextId: query.contextId }),
  });
  const previewCount = [query.itemId, query.revisionId, query.anchorId].filter(
    (value) => value !== undefined,
  ).length;
  if (previewCount !== 0 && previewCount !== 3) invalidRequest();
  return {
    scope,
    ...(previewCount === 0
      ? {}
      : {
          preview: {
            itemId: parseLocalId('inventory-item', query.itemId!),
            revisionId: parseLocalId('item-revision', query.revisionId!),
            anchorId: parseLocalId('anchor', query.anchorId!),
          },
        }),
  };
}

export function parseWorkScope(scope: WireScope): WorkScope {
  if (scope.kind === 'free') {
    if (scope.contextId !== undefined) invalidRequest();
    return freeWorkScope();
  }
  if (scope.contextId === undefined) invalidRequest();
  return contextWorkScope(parseLocalId('working-context', scope.contextId));
}

export function parseLocalId<Kind extends LocalIdKind>(
  kind: Kind,
  value: string,
) {
  const numeric = Number(value);
  try {
    return localId(kind, numeric);
  } catch {
    throw new ApiProblem('request.invalid');
  }
}

export function parseAnalysisScratchAction(action: {
  readonly kind:
    | 'start'
    | 'apply_move'
    | 'move_cursor'
    | 'prepare_note'
    | 'clear_note'
    | 'discard';
  readonly origin?:
    | { readonly kind: 'initial_position' }
    | { readonly kind: 'fen'; readonly fen: string }
    | {
        readonly kind: 'inventory_anchor';
        readonly itemId: string;
        readonly revisionId: string;
        readonly anchorId: string;
      };
  readonly move?:
    | { readonly kind: 'coordinates'; readonly value: string }
    | {
        readonly kind: 'notation';
        readonly value: string;
        readonly locale: 'de-DE' | 'en-GB';
      };
  readonly cursor?: number;
  readonly body?: string;
}): UpdateAnalysisScratchAction {
  switch (action.kind) {
    case 'start': {
      const origin = action.origin;
      if (origin === undefined) invalidRequest();
      if (origin.kind !== 'inventory_anchor') {
        return { kind: 'start', origin };
      }
      return {
        kind: 'start',
        origin: {
          kind: origin.kind,
          itemId: parseLocalId('inventory-item', origin.itemId),
          revisionId: parseLocalId('item-revision', origin.revisionId),
          anchorId: parseLocalId('anchor', origin.anchorId),
        },
      };
    }
    case 'apply_move':
      if (action.move === undefined) invalidRequest();
      return { kind: action.kind, move: action.move };
    case 'move_cursor':
      if (action.cursor === undefined) invalidRequest();
      return { kind: action.kind, cursor: action.cursor };
    case 'prepare_note':
      if (action.body === undefined) invalidRequest();
      return { kind: action.kind, body: action.body };
    case 'clear_note':
    case 'discard':
      return { kind: action.kind };
  }
}

export function parseResumeRequest(
  contextId: string,
  body:
    | {
        readonly area: 'manage';
        readonly expectedResumeVersion: number | null;
        readonly presentation: 'list' | 'atlas';
        readonly selectedItemId?: string;
        readonly selectedAnchorId?: string;
      }
    | {
        readonly area: 'analyze';
        readonly expectedResumeVersion: number | null;
        readonly mode: 'analyze' | 'edit_inventory' | 'edit_overlay';
        readonly itemId?: string;
        readonly revisionId?: string;
        readonly anchorId?: string;
      },
): SetWorkScopeResumeRequest {
  const parsedContextId = parseLocalId('working-context', contextId);
  if (body.area === 'manage') {
    return {
      contextId: parsedContextId,
      area: body.area,
      expectedResumeVersion: body.expectedResumeVersion,
      presentation: body.presentation,
      ...(body.selectedItemId === undefined
        ? {}
        : {
            selectedItemId: parseLocalId('inventory-item', body.selectedItemId),
          }),
      ...(body.selectedAnchorId === undefined
        ? {}
        : { selectedAnchorId: parseLocalId('anchor', body.selectedAnchorId) }),
    };
  }
  return {
    contextId: parsedContextId,
    area: body.area,
    expectedResumeVersion: body.expectedResumeVersion,
    mode: body.mode,
    ...(body.itemId === undefined
      ? {}
      : { itemId: parseLocalId('inventory-item', body.itemId) }),
    ...(body.revisionId === undefined
      ? {}
      : { revisionId: parseLocalId('item-revision', body.revisionId) }),
    ...(body.anchorId === undefined
      ? {}
      : { anchorId: parseLocalId('anchor', body.anchorId) }),
  };
}

export function analysisWorkspaceDto(model: AnalysisWorkspace) {
  return {
    scope: workScopeDto(model.scope),
    dataRevision: model.dataRevision,
    ...(model.contextName === undefined
      ? {}
      : { contextName: model.contextName }),
    ...(model.resumeVersion === undefined
      ? {}
      : { resumeVersion: model.resumeVersion }),
    ...(model.scratch === undefined
      ? {}
      : { scratch: analysisScratchDto(model.scratch) }),
    ...(model.record === undefined
      ? {}
      : { record: analysisRecordDto(model.record) }),
    currentState: chessStateDto(model.currentState),
    legalMoves: model.legalMoves.map(canonicalMoveDto),
    allowedActions: [...model.allowedActions],
  };
}

export function updateAnalysisScratchResultDto(
  model: UpdateAnalysisScratchResult,
) {
  return {
    ...(model.scratch === undefined
      ? {}
      : { scratch: analysisScratchDto(model.scratch) }),
    discarded: model.discarded,
    dataRevision: model.dataRevision,
    ...(model.resumeVersion === undefined
      ? {}
      : { resumeVersion: model.resumeVersion }),
  };
}

export function createAnalysisRecordResultDto(
  model: CreateAnalysisRecordResult,
) {
  return {
    itemId: idDto(model.itemId),
    revisionId: idDto(model.revisionId),
    rootAnchorId: idDto(model.rootAnchorId),
    ...(model.contributionId === undefined
      ? {}
      : { contributionId: idDto(model.contributionId) }),
    ...(model.contextReferenceId === undefined
      ? {}
      : { contextReferenceId: idDto(model.contextReferenceId) }),
    resumeUpdates: model.resumeUpdates.map((resume) => ({
      contextId: idDto(resume.contextId),
      resumeVersion: resume.resumeVersion,
    })),
    dataRevision: model.dataRevision,
  };
}

export function createAnalysisNoteResultDto(model: CreateAnalysisNoteResult) {
  return {
    contributionId: idDto(model.contributionId),
    itemId: idDto(model.itemId),
    revisionId: idDto(model.revisionId),
    anchorId: idDto(model.anchorId),
    scopeKind: model.scopeKind,
    ...(model.contextId === undefined
      ? {}
      : { contextId: idDto(model.contextId) }),
    ...(model.resumeUpdate === undefined
      ? {}
      : {
          resumeUpdate: {
            contextId: idDto(model.resumeUpdate.contextId),
            resumeVersion: model.resumeUpdate.resumeVersion,
          },
        }),
    dataRevision: model.dataRevision,
  };
}

export function analysisNoteMutationResultDto(
  model: AnalysisNoteMutationResult,
) {
  return {
    contributionId: idDto(model.contributionId),
    itemId: idDto(model.itemId),
    anchorId: idDto(model.anchorId),
    contributionVersion: model.contributionVersion,
    dataRevision: model.dataRevision,
  };
}

export function searchInventoryResultDto(model: SearchInventoryResult) {
  return {
    items: model.items.map(inventorySearchItemDto),
    ...(model.nextCursor === undefined ? {} : { nextCursor: model.nextCursor }),
    dataRevision: model.dataRevision,
  };
}

export function listWorkingContextsResultDto(model: {
  readonly contexts: readonly WorkingContextSummary[];
  readonly nextCursor?: string;
  readonly dataRevision: number;
}) {
  return {
    contexts: model.contexts.map(workingContextSummaryDto),
    ...(model.nextCursor === undefined ? {} : { nextCursor: model.nextCursor }),
    dataRevision: model.dataRevision,
  };
}

export function workingContextWorkspaceDto(model: WorkingContextWorkspace) {
  return {
    context: workingContextSummaryDto(model.context),
    references: model.references.map(contextReferenceDto),
    ...(model.managementResume === undefined
      ? {}
      : { managementResume: managementResumeDto(model.managementResume) }),
    ...(model.analysisResume === undefined
      ? {}
      : { analysisResume: analysisResumeDto(model.analysisResume) }),
    dataRevision: model.dataRevision,
  };
}

export function createWorkingContextResultDto(
  model: CreateWorkingContextResult,
) {
  return {
    context: workingContextSummaryDto(model.context),
    dataRevision: model.dataRevision,
  };
}

export function addContextReferenceResultDto(model: AddContextReferenceResult) {
  return {
    reference: contextReferenceDto(model.reference),
    dataRevision: model.dataRevision,
  };
}

export function setWorkScopeResumeResultDto(model: SetWorkScopeResumeResult) {
  return model.area === 'manage'
    ? {
        area: model.area,
        resume: managementResumeDto(model.resume),
        dataRevision: model.dataRevision,
      }
    : {
        area: model.area,
        resume: analysisResumeDto(model.resume),
        dataRevision: model.dataRevision,
      };
}

function analysisScratchDto(model: AnalysisScratch) {
  return {
    scratchId: model.scratchId,
    scratchRevision: model.scratchRevision,
    origin:
      model.origin.kind === 'inventory_anchor'
        ? {
            kind: model.origin.kind,
            itemId: idDto(model.origin.itemId),
            revisionId: idDto(model.origin.revisionId),
            anchorId: idDto(model.origin.anchorId),
          }
        : { kind: model.origin.kind },
    root: chessStateDto(model.root),
    steps: model.steps.map((step) => ({
      before: chessStateDto(step.before),
      move: canonicalMoveDto(step.move),
      after: chessStateDto(step.after),
    })),
    cursor: model.cursor,
    ...(model.noteDraft === undefined
      ? {}
      : {
          noteDraft: {
            moves: model.noteDraft.moves.map(canonicalMoveDto),
            body: model.noteDraft.body,
          },
        }),
  };
}

function analysisRecordDto(model: AnalysisRecordView) {
  return {
    itemId: idDto(model.itemId),
    revisionId: idDto(model.revisionId),
    rootAnchorId: idDto(model.rootAnchorId),
    currentAnchorId: idDto(model.currentAnchorId),
    displayName: model.displayName,
    languageTag: model.languageTag,
    origin:
      model.origin.kind === 'inventory_anchor'
        ? {
            kind: model.origin.kind,
            itemId: idDto(model.origin.itemId),
            revisionId: idDto(model.origin.revisionId),
            anchorId: idDto(model.origin.anchorId),
          }
        : { kind: model.origin.kind },
    ...(model.sourceLine === undefined
      ? {}
      : {
          sourceLine: {
            sourceItemId: idDto(model.sourceLine.sourceItemId),
            sourceRevisionId: idDto(model.sourceLine.sourceRevisionId),
            sourceAnchorId: idDto(model.sourceLine.sourceAnchorId),
            sourceDisplayName: model.sourceLine.sourceDisplayName,
            root: chessStateDto(model.sourceLine.root),
            rootTarget: {
              itemId: idDto(model.sourceLine.rootTarget.itemId),
              revisionId: idDto(model.sourceLine.rootTarget.revisionId),
              anchorId: idDto(model.sourceLine.rootTarget.anchorId),
            },
            steps: model.sourceLine.steps.map((step) => ({
              before: chessStateDto(step.before),
              move: canonicalMoveDto(step.move),
              after: chessStateDto(step.after),
              anchorId: idDto(step.anchorId),
              itemId: idDto(step.itemId),
              revisionId: idDto(step.revisionId),
            })),
            contributions: model.sourceLine.contributions.map(
              analysisContributionDto,
            ),
          },
        }),
    root: chessStateDto(model.root),
    steps: model.steps.map((step) => ({
      before: chessStateDto(step.before),
      move: canonicalMoveDto(step.move),
      after: chessStateDto(step.after),
      anchorId: idDto(step.anchorId),
    })),
    cursor: model.cursor,
    contributions: model.contributions.map(analysisContributionDto),
    contextMember: model.contextMember,
    readOnlyPreview: model.readOnlyPreview,
  };
}

function analysisContributionDto(
  contribution: AnalysisRecordView['contributions'][number],
) {
  return {
    contributionId: idDto(contribution.contributionId),
    anchorId: idDto(contribution.anchorId),
    body: contribution.body,
    moves: contribution.moves.map(canonicalMoveDto),
    languageTag: contribution.languageTag,
    scopeKind: contribution.scopeKind,
    ...(contribution.contextId === undefined
      ? {}
      : { contextId: idDto(contribution.contextId) }),
    contributionVersion: contribution.contributionVersion,
    createdAt: contribution.createdAt,
    updatedAt: contribution.updatedAt,
  };
}

function chessStateDto(model: ChessState) {
  return {
    position: {
      ruleSetId: model.position.ruleSetId,
      boardKey: model.position.boardKey,
      sideToMove: model.position.sideToMove,
      castlingRights: {
        whiteKingSide: model.position.castlingRights.whiteKingSide,
        whiteQueenSide: model.position.castlingRights.whiteQueenSide,
        blackKingSide: model.position.castlingRights.blackKingSide,
        blackQueenSide: model.position.castlingRights.blackQueenSide,
      },
      effectiveEnPassantSquare: model.position.effectiveEnPassantSquare,
      positionKey: model.position.positionKey,
    },
    playState: {
      halfmoveClock: model.playState.halfmoveClock,
      fullmoveNumber: model.playState.fullmoveNumber,
      historyKnowledge: model.playState.historyKnowledge,
    },
    fen: model.fen,
  };
}

function canonicalMoveDto(model: CanonicalMove) {
  return {
    from: model.from,
    to: model.to,
    ...(model.promotion === undefined ? {} : { promotion: model.promotion }),
    san: model.san,
  };
}

function inventorySearchItemDto(model: InventorySearchItem) {
  return {
    itemId: idDto(model.itemId),
    currentRevisionId: idDto(model.currentRevisionId),
    rootAnchorId: idDto(model.rootAnchorId),
    itemType: model.itemType,
    originKind: model.originKind,
    displayName: model.displayName,
    ...(model.summary === undefined ? {} : { summary: model.summary }),
    languageTag: model.languageTag,
    contextIds: model.contextIds.map(idDto),
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

function workingContextSummaryDto(model: WorkingContextSummary) {
  return {
    contextId: idDto(model.contextId),
    displayName: model.displayName,
    ...(model.purpose === undefined ? {} : { purpose: model.purpose }),
    ...(model.boundary === undefined ? {} : { boundary: model.boundary }),
    ...(model.nextStep === undefined ? {} : { nextStep: model.nextStep }),
    lifecycle: model.lifecycle,
    ...(model.pinnedOrder === undefined
      ? {}
      : { pinnedOrder: model.pinnedOrder }),
    contextVersion: model.contextVersion,
    referenceCount: model.referenceCount,
    ...(model.managementResumeVersion === undefined
      ? {}
      : { managementResumeVersion: model.managementResumeVersion }),
    ...(model.analysisResumeVersion === undefined
      ? {}
      : { analysisResumeVersion: model.analysisResumeVersion }),
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

function contextReferenceDto(model: ContextReferenceSummary) {
  return {
    referenceId: idDto(model.referenceId),
    itemId: idDto(model.itemId),
    currentRevisionId: idDto(model.currentRevisionId),
    itemType: model.itemType,
    displayName: model.displayName,
    anchorId: idDto(model.anchorId),
    anchorKind: model.anchorKind,
    createdAt: model.createdAt,
  };
}

function managementResumeDto(model: ManagementResume) {
  return {
    resumeVersion: model.resumeVersion,
    presentation: model.presentation,
    ...(model.selectedItemId === undefined
      ? {}
      : { selectedItemId: idDto(model.selectedItemId) }),
    ...(model.selectedAnchorId === undefined
      ? {}
      : { selectedAnchorId: idDto(model.selectedAnchorId) }),
    updatedAt: model.updatedAt,
  };
}

function analysisResumeDto(model: AnalysisResume) {
  return {
    resumeVersion: model.resumeVersion,
    mode: model.mode,
    ...(model.itemId === undefined ? {} : { itemId: idDto(model.itemId) }),
    ...(model.revisionId === undefined
      ? {}
      : { revisionId: idDto(model.revisionId) }),
    ...(model.anchorId === undefined
      ? {}
      : { anchorId: idDto(model.anchorId) }),
    currentPositionId: idDto(model.currentPositionId),
    ...(model.scratchId === undefined ? {} : { scratchId: model.scratchId }),
    updatedAt: model.updatedAt,
  };
}

function workScopeDto(scope: WorkScope) {
  return scope.kind === 'free'
    ? { kind: scope.kind }
    : { kind: scope.kind, contextId: idDto(scope.contextId) };
}

function idDto(id: { readonly value: number }): string {
  return String(id.value);
}

function invalidRequest(): never {
  throw new ApiProblem('request.invalid');
}
