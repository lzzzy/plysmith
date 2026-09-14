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
