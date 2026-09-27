import { ApplicationProblem } from '../problems/application-problem.ts';

export function invalidInventorySearch(): ApplicationProblem {
  return new ApplicationProblem(
    'inventory.invalid_search',
    'The inventory search request is invalid.',
  );
}

export function inventoryItemNotFound(): ApplicationProblem {
  return new ApplicationProblem(
    'inventory.item_not_found',
    'The inventory item does not exist.',
  );
}

export function inventoryDisplayNameConflict(): ApplicationProblem {
  return new ApplicationProblem(
    'inventory.display_name_conflict',
    'An active analysis already uses this name. Choose another name.',
  );
}

export function invalidInventoryDeletion(): ApplicationProblem {
  return new ApplicationProblem(
    'inventory.invalid_deletion',
    'The inventory deletion request is invalid.',
  );
}

export function inventoryDeletionConflict(): ApplicationProblem {
  return new ApplicationProblem(
    'inventory.deletion_conflict',
    'The inventory deletion preview is stale. Preview the deletion again.',
  );
}

export function invalidInventoryRevision(): ApplicationProblem {
  return new ApplicationProblem(
    'inventory.invalid_revision',
    'The inventory revision request is invalid.',
  );
}

export function inventoryRevisionConflict(): ApplicationProblem {
  return new ApplicationProblem(
    'inventory.revision_conflict',
    'The inventory item has changed. Read its current revision first.',
  );
}

export function inventoryPreviewConflict(): ApplicationProblem {
  return new ApplicationProblem(
    'inventory.preview_conflict',
    'The inventory revision preview is stale. Preview the change again.',
  );
}

export function revisionImpactNotFound(): ApplicationProblem {
  return new ApplicationProblem(
    'workspace.impact_not_found',
    'The pending revision impact does not exist.',
  );
}

export function revisionImpactConflict(): ApplicationProblem {
  return new ApplicationProblem(
    'workspace.impact_conflict',
    'The pending revision impact has changed.',
  );
}

export function invalidRevisionImpactResolution(): ApplicationProblem {
  return new ApplicationProblem(
    'workspace.invalid_impact_resolution',
    'The revision impact resolution is incomplete or invalid.',
  );
}
