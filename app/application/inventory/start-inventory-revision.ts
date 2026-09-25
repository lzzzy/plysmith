import {
  appendAnalysisMove,
  startAnalysisScratch,
  type AnalysisScratch,
} from '../../domain/analysis/index.ts';
import { planInventoryRevision } from '../../domain/inventory/index.ts';
import type { WorkingContextId } from '../../domain/identity/index.ts';
import type {
  AnalysisClock,
  AnalysisScratchChangedPublisher,
  ContextAnalysisReader,
  ContextAnalysisWriter,
} from '../analysis/analysis-ports.ts';
import {
  analysisScratchRevisionConflict,
  chessRulesProblem,
} from '../analysis/analysis-problems.ts';
import type { FreeAnalysisSession } from '../analysis/free-analysis-session.ts';
import type { ChessRulesPort } from '../chess_graph/index.ts';
import type { StoreStatusReader } from '../system/index.ts';
import type {
  StartInventoryRevisionRequest,
  StartInventoryRevisionResult,
} from './inventory-models.ts';
import type { InventoryRevisionReader } from './inventory-ports.ts';
import { invalidInventoryRevision } from './inventory-problems.ts';

export interface StartInventoryRevisionUseCase {
  execute(
    request: StartInventoryRevisionRequest,
  ): Promise<StartInventoryRevisionResult>;
}

export class StartInventoryRevision implements StartInventoryRevisionUseCase {
  readonly #inventory: InventoryRevisionReader;
  readonly #contextReader: ContextAnalysisReader;
  readonly #contextWriter: ContextAnalysisWriter;
  readonly #freeSession: FreeAnalysisSession;
  readonly #rules: ChessRulesPort;
  readonly #clock: AnalysisClock;
  readonly #events: AnalysisScratchChangedPublisher;
  readonly #storeStatus: StoreStatusReader;
  readonly #scratchId: () => string;

  constructor(dependencies: {
    readonly inventory: InventoryRevisionReader;
    readonly contextReader: ContextAnalysisReader;
    readonly contextWriter: ContextAnalysisWriter;
    readonly freeSession: FreeAnalysisSession;
    readonly rules: ChessRulesPort;
    readonly clock: AnalysisClock;
    readonly events: AnalysisScratchChangedPublisher;
    readonly storeStatus: StoreStatusReader;
    readonly scratchId: () => string;
  }) {
    this.#inventory = dependencies.inventory;
    this.#contextReader = dependencies.contextReader;
    this.#contextWriter = dependencies.contextWriter;
    this.#freeSession = dependencies.freeSession;
    this.#rules = dependencies.rules;
    this.#clock = dependencies.clock;
    this.#events = dependencies.events;
    this.#storeStatus = dependencies.storeStatus;
    this.#scratchId = dependencies.scratchId;
  }

  async execute(
    request: StartInventoryRevisionRequest,
  ): Promise<StartInventoryRevisionResult> {
    validateExpected(
      request.expectedScratchId,
      request.expectedScratchRevision,
    );
    if (request.mode === 'metadata' && request.firstMove !== undefined) {
      throw invalidInventoryRevision();
    }
    const record = await this.#inventory.readAnalysisRevision({
      itemId: request.itemId,
      revisionId: request.baseRevisionId,
      scope: request.scope,
      anchorId: request.anchorId,
    });
    if (
      record === undefined ||
      (record.itemType === 'game' && request.mode !== 'metadata') ||
      record.historical ||
      record.readOnlyPreview ||
      record.currentRevisionId.value !== request.baseRevisionId.value
    ) {
      throw invalidInventoryRevision();
    }
    let plan;
    try {
      plan = planInventoryRevision({
        line: {
          itemId: record.itemId,
          revisionId: record.revisionId,
          rootAnchorId: record.rootAnchorId,
          root: record.root,
          steps: record.steps,
          displayName: record.displayName,
          ...(record.summary === undefined ? {} : { summary: record.summary }),
        },
        mode: request.mode,
        anchorId: request.anchorId,
        ...(request.displayName === undefined
          ? {}
          : { displayName: request.displayName }),
        ...(request.summary === undefined ? {} : { summary: request.summary }),
      });
    } catch {
      throw invalidInventoryRevision();
    }
    let scratch = startAnalysisScratch(
      this.#scratchId(),
      plan.scratchRoot,
      {
        kind: 'inventory_anchor',
        itemId: record.itemId,
        revisionId: record.revisionId,
        anchorId: plan.cutAnchorId,
      },
      plan.intent,
    );
    if (request.firstMove !== undefined) {
      const applied = this.#rules.applyMove(
        scratch.root,
        [],
        request.firstMove,
      );
      if (!applied.ok) throw chessRulesProblem(applied.reason);
      scratch = appendAnalysisMove(scratch, applied.value);
    }
    return request.scope.kind === 'free'
      ? this.#startFree(request, scratch)
      : this.#startContext(request, request.scope.contextId, scratch);
  }

  async #startFree(
    request: StartInventoryRevisionRequest,
    scratch: AnalysisScratch,
  ): Promise<StartInventoryRevisionResult> {
    const result = await this.#freeSession.run((current) => {
      assertCurrent(
        current,
        request.expectedScratchId,
        request.expectedScratchRevision,
      );
      return { scratch, result: scratch };
    });
    const status = await this.#storeStatus.readStoreStatus();
    const response = Object.freeze({
      scratch: result,
      dataRevision: status.dataRevision,
    });
    this.#publish(request, response);
    return response;
  }

  async #startContext(
    request: StartInventoryRevisionRequest,
    contextId: WorkingContextId,
    scratch: AnalysisScratch,
  ): Promise<StartInventoryRevisionResult> {
    const workspace =
      await this.#contextReader.readContextAnalysisWorkspace(contextId);
    assertCurrent(
      workspace?.scratch,
      request.expectedScratchId,
      request.expectedScratchRevision,
    );
    const occurredAt = this.#clock.now();
    const persisted = await this.#contextWriter.replaceContextAnalysisScratch({
      contextId,
      expectedScratchId: request.expectedScratchId,
      expectedScratchRevision: request.expectedScratchRevision,
      scratch,
      occurredAt,
    });
    const response = Object.freeze({
      scratch: persisted.scratch,
      dataRevision: persisted.dataRevision,
      resumeVersion: persisted.resumeVersion,
    });
    this.#publish(request, response, occurredAt);
    return response;
  }

  #publish(
    request: StartInventoryRevisionRequest,
    result: StartInventoryRevisionResult,
    occurredAt = this.#clock.now(),
  ): void {
    this.#events.publish({
      kind: 'analysis.scratch-changed',
      occurredAt,
      dataRevision: result.dataRevision,
      scope: request.scope,
      scratchId: result.scratch.scratchId,
      scratchRevision: result.scratch.scratchRevision,
    });
  }
}

function validateExpected(id: string | null, revision: number | null): void {
  if (
    (id === null) !== (revision === null) ||
    (id !== null && id.trim().length === 0) ||
    (revision !== null && (!Number.isSafeInteger(revision) || revision < 1))
  ) {
    throw invalidInventoryRevision();
  }
}

function assertCurrent(
  current: AnalysisScratch | undefined,
  expectedId: string | null,
  expectedRevision: number | null,
): void {
  if (
    (current?.scratchId ?? null) !== expectedId ||
    (current?.scratchRevision ?? null) !== expectedRevision
  ) {
    throw analysisScratchRevisionConflict(
      expectedRevision,
      current?.scratchRevision ?? null,
    );
  }
}
