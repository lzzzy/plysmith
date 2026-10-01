import type {
  ChangeInventoryOrganizationRequest,
  ChangeInventoryOrganizationResult,
  CheckInventoryNameAvailabilityRequest,
  ContextFolderRemovalPreview,
  GetInventoryOrganizationRequest,
  InventoryNameAvailability,
  InventoryOrganization,
  PreviewContextFolderRemovalRequest,
  InventoryOrganizationChanged,
} from './inventory-organization-models.ts';

export interface InventoryOrganizationChangedPublisher {
  publish(event: InventoryOrganizationChanged): void;
}

export interface InventoryOrganizationReader {
  readInventoryOrganization(
    request: GetInventoryOrganizationRequest,
  ): Promise<InventoryOrganization>;
  previewContextFolderRemoval(
    request: PreviewContextFolderRemovalRequest,
  ): Promise<ContextFolderRemovalPreview>;
}

export interface InventoryOrganizationWriter {
  changeInventoryOrganization(
    request: ChangeInventoryOrganizationRequest,
    occurredAt: string,
  ): Promise<ChangeInventoryOrganizationResult>;
}

export interface InventoryNameAvailabilityReader {
  checkInventoryNameAvailability(
    request: CheckInventoryNameAvailabilityRequest,
  ): Promise<InventoryNameAvailability>;
}
