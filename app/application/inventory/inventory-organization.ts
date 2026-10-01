import {
  inventoryFolderNameKey,
  InventoryFolderPolicyError,
} from '../../domain/inventory/index.ts';
import { ApplicationProblem } from '../problems/application-problem.ts';
import type { InventoryClock } from './inventory-ports.ts';
import type {
  ChangeInventoryOrganizationRequest,
  ChangeInventoryOrganizationResult,
  CheckInventoryNameAvailabilityRequest,
  ContextFolderRemovalPreview,
  GetInventoryOrganizationRequest,
  InventoryNameAvailability,
  InventoryOrganization,
  PreviewContextFolderRemovalRequest,
} from './inventory-organization-models.ts';
import type {
  InventoryNameAvailabilityReader,
  InventoryOrganizationReader,
  InventoryOrganizationWriter,
  InventoryOrganizationChangedPublisher,
} from './inventory-organization-ports.ts';

export function inventoryOrganizationProblem(
  reason: string,
): ApplicationProblem {
  return new ApplicationProblem(
    `inventory.${reason}`,
    `Inventory organization: ${reason}.`,
  );
}

export interface GetInventoryOrganizationUseCase {
  execute(
    request: GetInventoryOrganizationRequest,
  ): Promise<InventoryOrganization>;
}
export class GetInventoryOrganization implements GetInventoryOrganizationUseCase {
  readonly #reader: InventoryOrganizationReader;
  constructor(reader: InventoryOrganizationReader) {
    this.#reader = reader;
  }
  execute(
    request: GetInventoryOrganizationRequest,
  ): Promise<InventoryOrganization> {
    return this.#reader.readInventoryOrganization(request);
  }
}

export interface PreviewContextFolderRemovalUseCase {
  execute(
    request: PreviewContextFolderRemovalRequest,
  ): Promise<ContextFolderRemovalPreview>;
}
export class PreviewContextFolderRemoval implements PreviewContextFolderRemovalUseCase {
  readonly #reader: InventoryOrganizationReader;
  constructor(reader: InventoryOrganizationReader) {
    this.#reader = reader;
  }
  execute(
    request: PreviewContextFolderRemovalRequest,
  ): Promise<ContextFolderRemovalPreview> {
    return this.#reader.previewContextFolderRemoval(request);
  }
}

export interface ChangeInventoryOrganizationUseCase {
  execute(
    request: ChangeInventoryOrganizationRequest,
  ): Promise<ChangeInventoryOrganizationResult>;
}
export class ChangeInventoryOrganization implements ChangeInventoryOrganizationUseCase {
  readonly #writer: InventoryOrganizationWriter;
  readonly #clock: InventoryClock;
  readonly #events: InventoryOrganizationChangedPublisher;
  constructor(dependencies: {
    readonly writer: InventoryOrganizationWriter;
    readonly clock: InventoryClock;
    readonly events: InventoryOrganizationChangedPublisher;
  }) {
    this.#writer = dependencies.writer;
    this.#clock = dependencies.clock;
    this.#events = dependencies.events;
  }
  async execute(
    request: ChangeInventoryOrganizationRequest,
  ): Promise<ChangeInventoryOrganizationResult> {
    if (
      !Number.isSafeInteger(request.expectedDataRevision) ||
      request.expectedDataRevision < 0 ||
      (request.change.kind === 'move_items' &&
        (request.change.itemIds.length === 0 ||
          new Set(request.change.itemIds.map((id) => id.value)).size !==
            request.change.itemIds.length))
    ) {
      throw inventoryOrganizationProblem('invalid_organization');
    }
    try {
      if ('displayName' in request.change)
        inventoryFolderNameKey(request.change.displayName);
      const occurredAt = this.#clock.now();
      const result = await this.#writer.changeInventoryOrganization(
        request,
        occurredAt,
      );
      this.#events.publish({
        kind: 'inventory.organization-changed',
        occurredAt,
        ...result,
        ...('contextId' in request.change &&
        request.change.contextId !== undefined
          ? { contextId: request.change.contextId }
          : {}),
        ...(request.change.kind === 'move_items' &&
        request.change.contextId === undefined &&
        request.change.workContextId !== undefined
          ? { contextId: request.change.workContextId }
          : {}),
        ...(request.change.kind === 'move_items'
          ? { itemIds: request.change.itemIds }
          : {}),
      });
      return result;
    } catch (error) {
      if (error instanceof InventoryFolderPolicyError)
        throw inventoryOrganizationProblem(error.reason);
      throw error;
    }
  }
}

export interface CheckInventoryNameAvailabilityUseCase {
  execute(
    request: CheckInventoryNameAvailabilityRequest,
  ): Promise<InventoryNameAvailability>;
}
export class CheckInventoryNameAvailability implements CheckInventoryNameAvailabilityUseCase {
  readonly #reader: InventoryNameAvailabilityReader;
  constructor(reader: InventoryNameAvailabilityReader) {
    this.#reader = reader;
  }
  async execute(
    request: CheckInventoryNameAvailabilityRequest,
  ): Promise<InventoryNameAvailability> {
    if (
      request.displayName.trim() !== request.displayName ||
      request.displayName.length === 0 ||
      request.displayName.length > 200
    ) {
      throw inventoryOrganizationProblem('invalid_name');
    }
    return this.#reader.checkInventoryNameAvailability(request);
  }
}
