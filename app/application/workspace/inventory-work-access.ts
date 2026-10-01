import type { InventoryItemId } from '../../domain/identity/index.ts';
import type { WorkScope } from '../../domain/workspace/index.ts';
import { ApplicationProblem } from '../problems/application-problem.ts';
import type { WorkingContextReader } from './workspace-ports.ts';
import { workingContextNotFound } from './workspace-problems.ts';

export type InventoryWorkAccessReader = Pick<
  WorkingContextReader,
  'readWorkingContextWorkspace'
>;

export interface InventoryWorkAccess {
  readonly scope: WorkScope;
  readonly subject:
    | { readonly kind: 'position' }
    | { readonly kind: 'inventory_item'; readonly itemId: InventoryItemId };
}

export function assertInventoryWorkAccess(
  scope: WorkScope,
  contextMember: boolean,
): void {
  if (scope.kind === 'context' && !contextMember) {
    throw new ApplicationProblem(
      'workspace.inventory_work_not_allowed',
      'Inventory work requires an explicit assignment to the working context.',
    );
  }
}

export async function requireInventoryWorkAccess(
  reader: InventoryWorkAccessReader,
  scope: WorkScope,
  itemId?: InventoryItemId,
): Promise<void> {
  if (scope.kind === 'free') return;
  const workspace = await reader.readWorkingContextWorkspace(scope.contextId);
  if (workspace === undefined || workspace.context.lifecycle !== 'active') {
    throw workingContextNotFound();
  }
  if (itemId !== undefined) {
    assertInventoryWorkAccess(
      scope,
      workspace.members.some((member) => member.itemId.value === itemId.value),
    );
  }
}
