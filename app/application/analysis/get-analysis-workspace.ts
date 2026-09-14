import {
  currentAnalysisMoves,
  currentAnalysisState,
} from '../../domain/analysis/index.ts';
import type { AnalysisScratchStep } from '../../domain/analysis/index.ts';
import type { ChessState } from '../../domain/chess_graph/index.ts';
import type { ChessRulesPort } from '../chess_graph/index.ts';
import type { StoreStatusReader } from '../system/index.ts';
import { workingContextNotFound } from '../workspace/index.ts';
import { inventoryItemNotFound } from '../inventory/index.ts';
import type {
  AnalysisRecordView,
  AnalysisWorkspace,
  GetAnalysisWorkspaceRequest,
  StoredContextAnalysisWorkspace,
} from './analysis-models.ts';
import type { ContextAnalysisReader } from './analysis-ports.ts';
import { chessRulesProblem } from './analysis-problems.ts';
import type { FreeAnalysisSession } from './free-analysis-session.ts';

export interface GetAnalysisWorkspaceUseCase {
  execute(request: GetAnalysisWorkspaceRequest): Promise<AnalysisWorkspace>;
}

export class GetAnalysisWorkspace implements GetAnalysisWorkspaceUseCase {
  readonly #reader: ContextAnalysisReader;
  readonly #freeSession: FreeAnalysisSession;
  readonly #rules: ChessRulesPort;
  readonly #storeStatus: StoreStatusReader;

  constructor(dependencies: {
    readonly reader: ContextAnalysisReader;
    readonly freeSession: FreeAnalysisSession;
    readonly rules: ChessRulesPort;
    readonly storeStatus: StoreStatusReader;
  }) {
    this.#reader = dependencies.reader;
    this.#freeSession = dependencies.freeSession;
    this.#rules = dependencies.rules;
    this.#storeStatus = dependencies.storeStatus;
  }

  async execute(
    request: GetAnalysisWorkspaceRequest,
  ): Promise<AnalysisWorkspace> {
    if (request.scope.kind === 'free') {
      const status = await this.#storeStatus.readStoreStatus();
      const scratch = this.#freeSession.read();
      if (scratch !== undefined) {
        const record =
          scratch.origin.kind === 'inventory_anchor'
            ? await this.#reader.readAnalysisRecord({
                itemId: scratch.origin.itemId,
                revisionId: scratch.origin.revisionId,
                anchorId: scratch.origin.anchorId,
                readOnlyPreview: false,
              })
            : undefined;
        if (
          scratch.origin.kind === 'inventory_anchor' &&
          record === undefined
        ) {
          throw inventoryItemNotFound();
        }
        return this.#build(
          {
            dataRevision: status.dataRevision,
            scratch,
            ...(record === undefined ? {} : { record }),
          },
          request,
        );
      }
      if (request.preview !== undefined) {
        const record = await this.#reader.readAnalysisRecord({
          ...request.preview,
          readOnlyPreview: false,
        });
        if (record === undefined) throw inventoryItemNotFound();
        return this.#build(
          { dataRevision: status.dataRevision, record },
          request,
        );
      }
      return this.#build({ dataRevision: status.dataRevision }, request);
    }
    const stored = await this.#reader.readContextAnalysisWorkspace(
      request.scope.contextId,
    );
    if (stored === undefined) throw workingContextNotFound();
    if (request.preview !== undefined) {
      const record = await this.#reader.readAnalysisRecord({
        ...request.preview,
        contextId: request.scope.contextId,
        readOnlyPreview: true,
      });
      if (record === undefined) throw inventoryItemNotFound();
      return this.#build(
        {
          dataRevision: stored.dataRevision,
          contextName: stored.contextName,
          ...(stored.resumeVersion === undefined
            ? {}
            : { resumeVersion: stored.resumeVersion }),
          record,
        },
        request,
      );
    }
    return this.#build(stored, request);
  }

  #build(
    stored: {
      readonly dataRevision: number;
      readonly scratch?: StoredContextAnalysisWorkspace['scratch'];
      readonly record?: StoredContextAnalysisWorkspace['record'];
      readonly contextName?: string;
      readonly resumeVersion?: number;
    },
    request: GetAnalysisWorkspaceRequest,
  ): AnalysisWorkspace {
    const fallback = this.#rules.initialState();
    const currentState = resolveCurrentState(
      stored.scratch,
      stored.record,
      fallback,
    );
    const line = resolveCurrentLine(stored.scratch, stored.record, fallback);
    const legalMoves = this.#rules.legalMoves(line.root, line.moves);
    if (!legalMoves.ok) throw chessRulesProblem(legalMoves.reason);
    return Object.freeze({
      scope: request.scope,
      dataRevision: stored.dataRevision,
      ...(stored.contextName === undefined
        ? {}
        : { contextName: stored.contextName }),
      ...(stored.resumeVersion === undefined
        ? {}
        : { resumeVersion: stored.resumeVersion }),
      ...(stored.scratch === undefined ? {} : { scratch: stored.scratch }),
      ...(stored.record === undefined ? {} : { record: stored.record }),
      currentState,
      legalMoves: legalMoves.value,
      allowedActions: allowedActions(stored.scratch, stored.record),
    });
  }
}

function resolveCurrentState(
  scratch: StoredContextAnalysisWorkspace['scratch'],
  record: AnalysisRecordView | undefined,
  fallback: ChessState,
): ChessState {
  if (scratch !== undefined) return currentAnalysisState(scratch);
  if (record === undefined) return fallback;
  return stateAt(record.root, record.steps, record.cursor);
}

function resolveCurrentLine(
  scratch: StoredContextAnalysisWorkspace['scratch'],
  record: AnalysisRecordView | undefined,
  fallback: ChessState,
): {
  readonly root: ChessState;
  readonly moves: readonly AnalysisScratchStep['move'][];
} {
  if (scratch !== undefined) {
    return { root: scratch.root, moves: currentAnalysisMoves(scratch) };
  }
  if (record !== undefined) {
    return {
      root: record.root,
      moves: Object.freeze(
        record.steps.slice(0, record.cursor).map((step) => step.move),
      ),
    };
  }
  return { root: fallback, moves: [] };
}

function stateAt(
  root: ChessState,
  steps: readonly AnalysisScratchStep[],
  cursor: number,
): ChessState {
  if (cursor === 0) return root;
  const step = steps[cursor - 1];
  if (step === undefined) throw new Error('Stored analysis cursor is invalid.');
  return step.after;
}

function allowedActions(
  scratch: StoredContextAnalysisWorkspace['scratch'],
  record: AnalysisRecordView | undefined,
): AnalysisWorkspace['allowedActions'] {
  if (record?.readOnlyPreview === true) return Object.freeze([]);
  if (scratch === undefined) {
    return Object.freeze(['start_scratch']);
  }
  const actions: AnalysisWorkspace['allowedActions'][number][] = [
    'apply_move',
    'move_cursor',
    'discard_scratch',
  ];
  if (scratch.cursor > 0) {
    actions.push('prepare_note', 'create_analysis_record');
  }
  if (scratch.noteDraft !== undefined) actions.push('clear_note');
  if (
    scratch.origin.kind === 'inventory_anchor' &&
    scratch.noteDraft?.body.trim()
  ) {
    actions.push('create_analysis_note');
  }
  return Object.freeze(actions);
}
