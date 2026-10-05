import type { ChessTreeCandidate } from '../../domain/inventory/chess-tree-candidate.ts';
import type { ContentFormatPort } from './content-format-port.ts';
import { ContentFormatRegistry } from './content-format-registry.ts';
import type { InventoryClock } from './inventory-ports.ts';
import type { InventoryOrganizationChangedPublisher } from './inventory-organization-ports.ts';
import type {
  ImportRepository,
  SourceAcquisitionPort,
} from './import-ports.ts';
import type {
  CheckImportNamesRequest,
  DiscardImportResult,
  ImportInputDescriptor,
  ImportNameChecks,
  ImportPreview,
  ImportPublished,
  PrepareImportRequest,
  PublishImportRequest,
} from './import-models.ts';
import { importProblem } from './import-problems.ts';
import { IMPORT_LIMITS } from './import-limits.ts';
import {
  assertImportPublicationBudget,
  measureImportCandidate,
} from './import-content-budget.ts';
import { ApplicationProblem } from '../problems/application-problem.ts';

export class RegisterImportInput {
  private readonly source: SourceAcquisitionPort;
  constructor(source: SourceAcquisitionPort) {
    this.source = source;
  }
  execute(request: {
    readonly inputLocator: string;
  }): Promise<ImportInputDescriptor> {
    return this.source.registerLocalFile(request.inputLocator);
  }
}

interface PreviewContent {
  readonly candidates: readonly ChessTreeCandidate[];
  readonly languageTag: string;
  readonly expiresAt: number;
  publishing: boolean;
  readonly budget: HeldImportBudget;
}

interface HeldImportBudget {
  nodes: number;
  noteCharacters: number;
  bytes: number;
}

export class ActiveImportPreviews {
  readonly #source: SourceAcquisitionPort;
  readonly #formats: ContentFormatRegistry;
  readonly #clock: InventoryClock;
  readonly #createPreviewId: () => string;
  readonly #previews = new Map<string, PreviewContent>();
  readonly #preparing = new Map<
    string,
    {
      controller: AbortController;
      promise: Promise<ImportPreview>;
      budget: HeldImportBudget;
    }
  >();
  readonly #publishing = new Set<Promise<ImportPublished>>();
  #closing = false;

  constructor(dependencies: {
    readonly source: SourceAcquisitionPort;
    readonly formats: ContentFormatRegistry | readonly ContentFormatPort[];
    readonly clock: InventoryClock;
    readonly createPreviewId: () => string;
  }) {
    this.#source = dependencies.source;
    this.#formats =
      dependencies.formats instanceof ContentFormatRegistry
        ? dependencies.formats
        : new ContentFormatRegistry(dependencies.formats);
    this.#clock = dependencies.clock;
    this.#createPreviewId = dependencies.createPreviewId;
  }

  prepare(request: PrepareImportRequest): Promise<ImportPreview> {
    this.#prune();
    if (this.#preparing.has(request.inputHandle))
      return Promise.reject(importProblem('preparation_busy'));
    if (
      this.#closing ||
      this.#previews.size + this.#preparing.size >=
        IMPORT_LIMITS.maxActivePreparations
    ) {
      this.#source.forget(request.inputHandle);
      return Promise.reject(importProblem('preparation_busy'));
    }
    const controller = new AbortController();
    const budget: HeldImportBudget = { nodes: 0, noteCharacters: 0, bytes: 0 };
    const timeout = setTimeout(
      () => controller.abort(importProblem('provider_resource_exhausted')),
      IMPORT_LIMITS.maxPreparationDurationMs,
    );
    const promise = this.#prepare(request, controller.signal, budget)
      .catch((error: unknown) => {
        if (controller.signal.reason instanceof ApplicationProblem)
          throw controller.signal.reason;
        throw error;
      })
      .finally(() => {
        clearTimeout(timeout);
        this.#preparing.delete(request.inputHandle);
      });
    this.#preparing.set(request.inputHandle, { controller, promise, budget });
    return promise;
  }

  async #prepare(
    request: PrepareImportRequest,
    signal: AbortSignal,
    budget: HeldImportBudget,
  ): Promise<ImportPreview> {
    if (
      !/^[a-f0-9-]{36}$/.test(request.inputHandle) ||
      !['de-DE', 'en-GB'].includes(request.languageTag) ||
      (request.encoding !== undefined &&
        !['utf-8', 'iso-8859-1'].includes(request.encoding))
    ) {
      this.#source.forget(request.inputHandle);
      throw importProblem('invalid_request');
    }
    let input:
      Awaited<ReturnType<SourceAcquisitionPort['acquire']>> | undefined;
    let inputClosed = false;
    try {
      input = await this.#source.acquire(
        request.inputHandle,
        request.encoding ?? 'utf-8',
        signal,
      );
      const format = this.#formats.resolve(input.displayName, request.formatId);
      const candidates: ChessTreeCandidate[] = [];
      await format.decode(input.chunks, {
        signal,
        onCandidate: async (candidate) => {
          if (signal.aborted) throw importProblem('interrupted');
          if (candidates.length >= IMPORT_LIMITS.maxCandidates)
            throw importProblem('provider_resource_exhausted');
          if (
            !Number.isSafeInteger(candidate.sourceOrder) ||
            candidate.sourceOrder < 0 ||
            candidates.some(
              (existing) => existing.sourceOrder === candidate.sourceOrder,
            )
          )
            throw importProblem('invalid_candidate');
          const measured = measureImportCandidate(candidate);
          const bytes = new TextEncoder().encode(
            JSON.stringify(candidate),
          ).byteLength;
          const held = this.#heldBudget();
          if (
            budget.nodes + measured.nodes > IMPORT_LIMITS.maxPreparationNodes ||
            budget.noteCharacters + measured.noteCharacters >
              IMPORT_LIMITS.maxNoteCharacters ||
            budget.bytes + bytes > IMPORT_LIMITS.maxPreviewBytes ||
            held.nodes + measured.nodes > IMPORT_LIMITS.maxActiveNodes ||
            held.noteCharacters + measured.noteCharacters >
              IMPORT_LIMITS.maxActiveNoteCharacters ||
            held.bytes + bytes > IMPORT_LIMITS.maxActiveBytes
          )
            throw importProblem('provider_resource_exhausted');
          budget.nodes += measured.nodes;
          budget.noteCharacters += measured.noteCharacters;
          budget.bytes += bytes;
          candidates.push(freezeContent(structuredClone(candidate)));
        },
      });
      await input.close();
      inputClosed = true;
      if (signal.aborted || this.#closing) throw importProblem('interrupted');
      const previewId = this.#createPreviewId();
      if (this.#previews.has(previewId))
        throw importProblem('preparation_busy');
      this.#previews.set(previewId, {
        candidates: Object.freeze(candidates),
        languageTag: request.languageTag,
        expiresAt:
          Date.parse(this.#clock.now()) + IMPORT_LIMITS.previewLifetimeMs,
        publishing: false,
        budget: { ...budget },
      });
      budget.nodes = 0;
      budget.noteCharacters = 0;
      budget.bytes = 0;
      this.#source.forget(request.inputHandle);
      return freezeContent({
        previewId,
        sourceDisplayName: input.displayName,
        inputSize: input.inputSize,
        encoding: request.encoding ?? 'utf-8',
        formatId: format.descriptor.formatId,
        candidates: candidates.map((candidate) => ({
          sourceOrder: candidate.sourceOrder,
          status: candidate.status,
          suggestedName: candidate.suggestedName,
          moveCount: candidate.nodes.length,
          variationCount: candidate.nodes.filter(
            (node) => node.siblingOrder > 0,
          ).length,
          ...(candidate.root === undefined
            ? {}
            : { rootFen: candidate.root.fen }),
          findings: candidate.findings,
        })),
      });
    } catch (error) {
      if (!(
        error instanceof ApplicationProblem &&
        error.problemCode === 'import.encoding_choice_required'
      ))
        this.#source.forget(request.inputHandle);
      throw error;
    } finally {
      if (!inputClosed) await input?.close();
    }
  }

  publish(
    request: PublishImportRequest,
    repository: ImportRepository,
    occurredAt: string,
  ): Promise<ImportPublished> {
    this.#prune();
    const preview = this.#previews.get(request.previewId);
    if (this.#closing || preview === undefined)
      return Promise.reject(importProblem('not_found'));
    if (preview.publishing)
      return Promise.reject(importProblem('publication_busy'));
    validateNames(request.candidates);
    if (
      request.candidates.length === 0 ||
      request.candidates.length > IMPORT_LIMITS.maxPublishedCandidates
    )
      throw importProblem('invalid_selection');
    const candidates = request.candidates.map((selection) => {
      const content = preview.candidates.find(
        (candidate) => candidate.sourceOrder === selection.sourceOrder,
      );
      if (
        content === undefined ||
        content.status === 'rejected' ||
        !['analysis', 'game'].includes(selection.itemType)
      )
        throw importProblem('invalid_selection');
      if (
        !request.confirmWarnings &&
        (content.status === 'warning' ||
          content.findings.some((finding) => finding.severity === 'warning'))
      )
        throw importProblem('warning_confirmation_required');
      return { ...selection, content };
    });
    assertImportPublicationBudget(
      candidates.map((candidate) => candidate.content),
    );
    const folder = structuredClone(request.folder);
    preview.publishing = true;
    const promise = Promise.resolve()
      .then(() =>
        repository.publishImport({
          candidates,
          folder,
          languageTag: preview.languageTag,
          occurredAt,
        }),
      )
      .then((result) => {
        this.#previews.delete(request.previewId);
        return result;
      })
      .finally(() => {
        preview.publishing = false;
        this.#publishing.delete(promise);
      });
    this.#publishing.add(promise);
    return promise;
  }

  discard(previewId: string): DiscardImportResult {
    this.#prune();
    if (this.#previews.get(previewId)?.publishing)
      throw importProblem('publication_busy');
    return { discarded: this.#previews.delete(previewId) };
  }

  async cancelPreparation(
    inputHandle: string,
  ): Promise<{ readonly cancelled: boolean }> {
    const preparation = this.#preparing.get(inputHandle);
    if (preparation === undefined) return { cancelled: false };
    preparation.controller.abort();
    await preparation.promise.catch(() => undefined);
    return { cancelled: true };
  }

  async close(): Promise<void> {
    this.#closing = true;
    for (const preparation of this.#preparing.values())
      preparation.controller.abort();
    await Promise.allSettled([
      ...[...this.#preparing.values()].map(
        (preparation) => preparation.promise,
      ),
      ...this.#publishing,
    ]);
    this.#previews.clear();
  }

  #heldBudget(): HeldImportBudget {
    const result = { nodes: 0, noteCharacters: 0, bytes: 0 };
    for (const { budget } of [
      ...this.#preparing.values(),
      ...this.#previews.values(),
    ]) {
      result.nodes += budget.nodes;
      result.noteCharacters += budget.noteCharacters;
      result.bytes += budget.bytes;
    }
    return result;
  }

  #prune(): void {
    for (const [id, preview] of this.#previews)
      if (
        !preview.publishing &&
        preview.expiresAt <= Date.parse(this.#clock.now())
      )
        this.#previews.delete(id);
  }
}

export class PrepareImport {
  private readonly active: ActiveImportPreviews;
  constructor(active: ActiveImportPreviews) {
    this.active = active;
  }
  execute(request: PrepareImportRequest): Promise<ImportPreview> {
    return this.active.prepare(request);
  }
}
export class CheckImportNames {
  private readonly repository: ImportRepository;
  constructor(repository: ImportRepository) {
    this.repository = repository;
  }
  execute(request: CheckImportNamesRequest): Promise<ImportNameChecks> {
    validateNames(request.candidates);
    return this.repository.checkImportNames(request);
  }
}
export class PublishImport {
  private readonly dependencies: {
    readonly active: ActiveImportPreviews;
    readonly repository: ImportRepository;
    readonly clock: InventoryClock;
    readonly events: InventoryOrganizationChangedPublisher;
  };
  constructor(dependencies: {
    readonly active: ActiveImportPreviews;
    readonly repository: ImportRepository;
    readonly clock: InventoryClock;
    readonly events: InventoryOrganizationChangedPublisher;
  }) {
    this.dependencies = dependencies;
  }
  async execute(request: PublishImportRequest): Promise<ImportPublished> {
    const { active, repository, clock, events } = this.dependencies;
    const occurredAt = clock.now();
    const result = await active.publish(request, repository, occurredAt);
    events.publish({
      kind: 'inventory.organization-changed',
      occurredAt,
      dataRevision: result.dataRevision,
      itemIds: result.items.map((item) => item.itemId),
      ...(result.folderId === undefined ? {} : { folderId: result.folderId }),
    });
    return result;
  }
}
export class DiscardImport {
  private readonly active: ActiveImportPreviews;
  constructor(active: ActiveImportPreviews) {
    this.active = active;
  }
  execute(request: { readonly previewId: string }): DiscardImportResult {
    return this.active.discard(request.previewId);
  }
}

export class CancelImportPreparation {
  private readonly active: ActiveImportPreviews;
  constructor(active: ActiveImportPreviews) {
    this.active = active;
  }
  execute(request: {
    readonly inputHandle: string;
  }): Promise<{ readonly cancelled: boolean }> {
    if (!/^[a-f0-9-]{36}$/.test(request.inputHandle))
      throw importProblem('invalid_request');
    return this.active.cancelPreparation(request.inputHandle);
  }
}

function validateNames(
  candidates: CheckImportNamesRequest['candidates'],
): void {
  if (
    candidates.length > IMPORT_LIMITS.maxCandidates ||
    new Set(candidates.map((candidate) => candidate.sourceOrder)).size !==
      candidates.length ||
    candidates.some(
      (candidate) =>
        !Number.isSafeInteger(candidate.sourceOrder) ||
        candidate.sourceOrder < 0 ||
        candidate.displayName.trim() !== candidate.displayName ||
        candidate.displayName.length < 1 ||
        candidate.displayName.length > 160,
    )
  )
    throw importProblem('invalid_selection');
}
function freezeContent<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeContent(child);
    Object.freeze(value);
  }
  return value;
}
