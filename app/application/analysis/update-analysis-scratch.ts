import {
  appendAnalysisMove,
  clearAnalysisNote,
  currentAnalysisMoves,
  moveAnalysisCursor,
  prepareAnalysisNote,
  startAnalysisScratch,
  type AnalysisScratch,
} from '../../domain/analysis/index.ts';
import type { WorkScope } from '../../domain/workspace/index.ts';
import type { WorkingContextId } from '../../domain/identity/index.ts';
import type { ChessRulesPort } from '../chess_graph/index.ts';
import { ApplicationProblem } from '../problems/application-problem.ts';
import type { StoreStatusReader } from '../system/index.ts';
import { workingContextNotFound } from '../workspace/index.ts';
import type {
  AnalysisRecordView,
  UpdateAnalysisScratchAction,
  UpdateAnalysisScratchRequest,
  UpdateAnalysisScratchResult,
} from './analysis-models.ts';
import type {
  AnalysisClock,
  AnalysisScratchChangedPublisher,
  ContextAnalysisReader,
  ContextAnalysisWriter,
} from './analysis-ports.ts';
import {
  analysisScratchNotFound,
  analysisScratchRevisionConflict,
  chessRulesProblem,
  invalidAnalysisUpdate,
} from './analysis-problems.ts';
import type { FreeAnalysisSession } from './free-analysis-session.ts';

export interface UpdateAnalysisScratchUseCase {
  execute(
    request: UpdateAnalysisScratchRequest,
  ): Promise<UpdateAnalysisScratchResult>;
}

export class UpdateAnalysisScratch implements UpdateAnalysisScratchUseCase {
  readonly #reader: ContextAnalysisReader;
  readonly #writer: ContextAnalysisWriter;
  readonly #freeSession: FreeAnalysisSession;
  readonly #rules: ChessRulesPort;
  readonly #clock: AnalysisClock;
  readonly #events: AnalysisScratchChangedPublisher;
  readonly #storeStatus: StoreStatusReader;
  readonly #scratchId: () => string;

  constructor(dependencies: {
    readonly reader: ContextAnalysisReader;
    readonly writer: ContextAnalysisWriter;
    readonly freeSession: FreeAnalysisSession;
    readonly rules: ChessRulesPort;
    readonly clock: AnalysisClock;
    readonly events: AnalysisScratchChangedPublisher;
    readonly storeStatus: StoreStatusReader;
    readonly scratchId: () => string;
  }) {
    this.#reader = dependencies.reader;
    this.#writer = dependencies.writer;
    this.#freeSession = dependencies.freeSession;
    this.#rules = dependencies.rules;
    this.#clock = dependencies.clock;
    this.#events = dependencies.events;
    this.#storeStatus = dependencies.storeStatus;
    this.#scratchId = dependencies.scratchId;
  }

  execute(
    request: UpdateAnalysisScratchRequest,
  ): Promise<UpdateAnalysisScratchResult> {
    validateExpectedScratch(
      request.expectedScratchId,
      request.expectedScratchRevision,
    );
    if (request.scope.kind === 'free') return this.#updateFree(request);
    return this.#updateContext(request, request.scope.contextId);
  }

  async #updateFree(
    request: UpdateAnalysisScratchRequest,
  ): Promise<UpdateAnalysisScratchResult> {
    const occurredAt = this.#clock.now();
    const record = await this.#resolveStartRecord(request);
    const sessionResult = await this.#freeSession.run((current) => {
      assertScratchIdentity(
        current,
        request.expectedScratchId,
        request.expectedScratchRevision,
      );
      const next = this.#applyAction(current, request.action, record);
      return {
        ...(next === undefined ? {} : { scratch: next }),
        result: Object.freeze({
          ...(next === undefined ? {} : { scratch: next }),
          discarded: next === undefined,
        }),
      };
    });
    const status = await this.#storeStatus.readStoreStatus();
    const result: UpdateAnalysisScratchResult = Object.freeze({
      ...sessionResult,
      dataRevision: status.dataRevision,
    });
    this.#publish(request.scope, result, occurredAt);
    return result;
  }

  async #updateContext(
    request: UpdateAnalysisScratchRequest,
    contextId: WorkingContextId,
  ): Promise<UpdateAnalysisScratchResult> {
    const workspace =
      await this.#reader.readContextAnalysisWorkspace(contextId);
    if (workspace === undefined) {
      throw workingContextNotFound();
    }
    assertScratchIdentity(
      workspace.scratch,
      request.expectedScratchId,
      request.expectedScratchRevision,
    );
    const startRecord = await this.#resolveStartRecord(request, contextId);
    const next = this.#applyAction(
      workspace.scratch,
      request.action,
      startRecord ?? workspace.record,
    );
    const occurredAt = this.#clock.now();
    if (next === undefined) {
      if (workspace.scratch === undefined) throw analysisScratchNotFound();
      const discarded = await this.#writer.discardContextAnalysisScratch({
        contextId,
        expectedScratchId: workspace.scratch.scratchId,
        expectedScratchRevision: workspace.scratch.scratchRevision,
        occurredAt,
      });
      const result = Object.freeze({
        discarded: true,
        dataRevision: discarded.dataRevision,
        resumeVersion: discarded.resumeVersion,
      });
      this.#publish(request.scope, result, occurredAt);
      return result;
    }
    const persisted = await this.#writer.replaceContextAnalysisScratch({
      contextId,
      expectedScratchId: request.expectedScratchId,
      expectedScratchRevision: request.expectedScratchRevision,
      scratch: next,
      occurredAt,
    });
    const result = Object.freeze({
      scratch: persisted.scratch,
      discarded: false,
      dataRevision: persisted.dataRevision,
      resumeVersion: persisted.resumeVersion,
    });
    this.#publish(request.scope, result, occurredAt);
    return result;
  }

  async #resolveStartRecord(
    request: UpdateAnalysisScratchRequest,
    contextId?: WorkingContextId,
  ): Promise<AnalysisRecordView | undefined> {
    if (
      request.action.kind !== 'start' ||
      request.action.origin.kind !== 'inventory_anchor'
    ) {
      return undefined;
    }
    return this.#reader.readAnalysisRecord({
      itemId: request.action.origin.itemId,
      revisionId: request.action.origin.revisionId,
      anchorId: request.action.origin.anchorId,
      ...(contextId === undefined ? {} : { contextId }),
      readOnlyPreview: contextId !== undefined,
    });
  }

  #applyAction(
    current: AnalysisScratch | undefined,
    action: UpdateAnalysisScratchAction,
    record?: AnalysisRecordView,
  ): AnalysisScratch | undefined {
    if (action.kind === 'start') {
      let root;
      if (action.origin.kind === 'initial_position') {
        root = this.#rules.initialState();
      } else if (action.origin.kind === 'fen') {
        const parsed = this.#rules.parseFen(action.origin.fen);
        if (!parsed.ok) throw chessRulesProblem(parsed.reason);
        root = parsed.value;
      } else {
        if (
          record === undefined ||
          record.readOnlyPreview ||
          record.itemId.value !== action.origin.itemId.value ||
          record.revisionId.value !== action.origin.revisionId.value ||
          record.currentAnchorId.value !== action.origin.anchorId.value
        ) {
          throw invalidAnalysisUpdate();
        }
        root =
          record.cursor === 0
            ? record.root
            : record.steps[record.cursor - 1]?.after;
        if (root === undefined) throw invalidAnalysisUpdate();
      }
      return startAnalysisScratch(
        this.#scratchId(),
        root,
        action.origin.kind === 'initial_position'
          ? { kind: 'initial_position' }
          : action.origin.kind === 'fen'
            ? { kind: 'fen' }
            : action.origin,
      );
    }
    if (current === undefined) throw analysisScratchNotFound();
    if (action.kind === 'discard') return undefined;
    try {
      if (action.kind === 'move_cursor') {
        return moveAnalysisCursor(current, action.cursor);
      }
      if (action.kind === 'prepare_note') {
        return prepareAnalysisNote(current, action.body);
      }
      if (action.kind === 'clear_note') {
        return clearAnalysisNote(current);
      }
      const applied = this.#rules.applyMove(
        current.root,
        currentAnalysisMoves(current),
        action.move,
      );
      if (!applied.ok) throw chessRulesProblem(applied.reason);
      return appendAnalysisMove(current, applied.value);
    } catch (error) {
      if (error instanceof ApplicationProblem) throw error;
      throw invalidAnalysisUpdate();
    }
  }

  #publish(
    scope: WorkScope,
    result: UpdateAnalysisScratchResult,
    occurredAt: string,
  ): void {
    this.#events.publish(
      Object.freeze({
        kind: 'analysis.scratch-changed',
        occurredAt,
        dataRevision: result.dataRevision,
        scope,
        ...(result.scratch === undefined
          ? {}
          : {
              scratchId: result.scratch.scratchId,
              scratchRevision: result.scratch.scratchRevision,
            }),
      }),
    );
  }
}

function validateExpectedScratch(
  scratchId: string | null,
  revision: number | null,
): void {
  if ((scratchId === null) !== (revision === null)) {
    throw invalidAnalysisUpdate();
  }
  if (
    (scratchId !== null && scratchId.trim().length === 0) ||
    (revision !== null && (!Number.isSafeInteger(revision) || revision < 1))
  ) {
    throw invalidAnalysisUpdate();
  }
}

function assertScratchIdentity(
  current: AnalysisScratch | undefined,
  expectedScratchId: string | null,
  expectedRevision: number | null,
): void {
  const currentRevision = current?.scratchRevision ?? null;
  const currentScratchId = current?.scratchId ?? null;
  if (
    currentScratchId !== expectedScratchId ||
    currentRevision !== expectedRevision
  ) {
    throw analysisScratchRevisionConflict(expectedRevision, currentRevision);
  }
}
