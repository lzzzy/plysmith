import {
  replaceAnalysisScratchIntent,
  type AnalysisScratch,
} from '../../domain/analysis/index.ts';
import type { WorkingContextId } from '../../domain/identity/index.ts';
import {
  planInventoryRevision,
  type InventoryRevisionPlan,
} from '../../domain/inventory/index.ts';
import {
  analysisScratchRevisionConflict,
  type AnalysisClock,
  type AnalysisScratchChangedPublisher,
  type ContextAnalysisReader,
  type ContextAnalysisWriter,
  type FreeAnalysisSession,
} from '../analysis/public.ts';
import type { StoreStatusReader } from '../system/index.ts';
import type {
  PromoteAnalysisToInventoryRevisionRequest,
  PromoteAnalysisToInventoryRevisionResult,
} from './inventory-models.ts';
import type { InventoryRevisionReader } from './inventory-ports.ts';
import { invalidInventoryRevision } from './inventory-problems.ts';

export interface PromoteAnalysisToInventoryRevisionUseCase {
  execute(
    request: PromoteAnalysisToInventoryRevisionRequest,
  ): Promise<PromoteAnalysisToInventoryRevisionResult>;
}

export class PromoteAnalysisToInventoryRevision implements PromoteAnalysisToInventoryRevisionUseCase {
  readonly #inventory: InventoryRevisionReader;
  readonly #contextReader: ContextAnalysisReader;
  readonly #contextWriter: ContextAnalysisWriter;
  readonly #freeSession: FreeAnalysisSession;
  readonly #clock: AnalysisClock;
  readonly #events: AnalysisScratchChangedPublisher;
  readonly #storeStatus: StoreStatusReader;

  constructor(dependencies: {
    readonly inventory: InventoryRevisionReader;
    readonly contextReader: ContextAnalysisReader;
    readonly contextWriter: ContextAnalysisWriter;
    readonly freeSession: FreeAnalysisSession;
    readonly clock: AnalysisClock;
    readonly events: AnalysisScratchChangedPublisher;
    readonly storeStatus: StoreStatusReader;
  }) {
    this.#inventory = dependencies.inventory;
    this.#contextReader = dependencies.contextReader;
    this.#contextWriter = dependencies.contextWriter;
    this.#freeSession = dependencies.freeSession;
    this.#clock = dependencies.clock;
    this.#events = dependencies.events;
    this.#storeStatus = dependencies.storeStatus;
  }

  async execute(
    request: PromoteAnalysisToInventoryRevisionRequest,
  ): Promise<PromoteAnalysisToInventoryRevisionResult> {
    validateRequest(request);
    const record = await this.#inventory.readAnalysisRevision({
      itemId: request.itemId,
      revisionId: request.baseRevisionId,
      scope: request.scope,
      anchorId: request.anchorId,
    });
    if (
      record === undefined ||
      record.itemType !== 'analysis' ||
      record.historical ||
      (request.scope.kind === 'context' && !record.contextMember) ||
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
        mode:
          request.mode ??
          (request.anchorId.value ===
          (record.steps.at(-1)?.anchorId ?? record.rootAnchorId).value
            ? 'extend'
            : 'truncate_after'),
        anchorId: request.anchorId,
      });
    } catch {
      throw invalidInventoryRevision();
    }
    return request.scope.kind === 'free'
      ? this.#promoteFree(request, plan)
      : this.#promoteContext(request, request.scope.contextId, plan);
  }

  async #promoteFree(
    request: PromoteAnalysisToInventoryRevisionRequest,
    plan: InventoryRevisionPlan,
  ): Promise<PromoteAnalysisToInventoryRevisionResult> {
    const promoted = await this.#freeSession.run((current) => {
      const scratch = promote(current, request, plan);
      return { scratch, result: scratch };
    });
    const status = await this.#storeStatus.readStoreStatus();
    const result = Object.freeze({
      scratch: promoted,
      dataRevision: status.dataRevision,
    });
    this.#publish(request, result);
    return result;
  }

  async #promoteContext(
    request: PromoteAnalysisToInventoryRevisionRequest,
    contextId: WorkingContextId,
    plan: InventoryRevisionPlan,
  ): Promise<PromoteAnalysisToInventoryRevisionResult> {
    const workspace =
      await this.#contextReader.readContextAnalysisWorkspace(contextId);
    const scratch = promote(workspace?.scratch, request, plan);
    const occurredAt = this.#clock.now();
    const persisted = await this.#contextWriter.replaceContextAnalysisScratch({
      contextId,
      expectedScratchId: request.expectedScratchId,
      expectedScratchRevision: request.expectedScratchRevision,
      scratch,
      occurredAt,
    });
    const result = Object.freeze({
      scratch: persisted.scratch,
      dataRevision: persisted.dataRevision,
      resumeVersion: persisted.resumeVersion,
    });
    this.#publish(request, result, occurredAt);
    return result;
  }

  #publish(
    request: PromoteAnalysisToInventoryRevisionRequest,
    result: PromoteAnalysisToInventoryRevisionResult,
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

function promote(
  current: AnalysisScratch | undefined,
  request: PromoteAnalysisToInventoryRevisionRequest,
  plan: InventoryRevisionPlan,
): AnalysisScratch {
  if (
    current?.scratchId !== request.expectedScratchId ||
    current.scratchRevision !== request.expectedScratchRevision
  ) {
    throw analysisScratchRevisionConflict(
      request.expectedScratchRevision,
      current?.scratchRevision ?? null,
    );
  }
  if (
    current.intent.kind !== 'exploration' ||
    (plan.mode !== 'truncate_after' &&
      plan.mode !== 'extend' &&
      plan.mode !== 'add_variation') ||
    current.origin.kind !== 'inventory_anchor' ||
    current.origin.itemId.value !== plan.intent.itemId.value ||
    current.origin.revisionId.value !== plan.intent.baseRevisionId.value ||
    current.origin.anchorId.value !== plan.cutAnchorId.value ||
    current.root.fen !== plan.scratchRoot.fen ||
    current.root.position.positionKey !==
      plan.scratchRoot.position.positionKey ||
    current.steps.length === 0 ||
    current.cursor !== current.steps.length
  ) {
    throw invalidInventoryRevision();
  }
  try {
    return replaceAnalysisScratchIntent(current, plan.intent);
  } catch {
    throw invalidInventoryRevision();
  }
}

function validateRequest(
  request: PromoteAnalysisToInventoryRevisionRequest,
): void {
  if (
    request.expectedScratchId.trim().length === 0 ||
    !Number.isSafeInteger(request.expectedScratchRevision) ||
    request.expectedScratchRevision < 1
  ) {
    throw invalidInventoryRevision();
  }
}
