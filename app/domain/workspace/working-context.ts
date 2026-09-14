import type {
  AnchorId,
  InventoryItemId,
  WorkingContextId,
} from '../identity/index.ts';

export type WorkScope =
  | { readonly kind: 'free' }
  | { readonly kind: 'context'; readonly contextId: WorkingContextId };

export interface WorkingContextDraft {
  readonly displayName: string;
  readonly purpose?: string;
  readonly boundary?: string;
  readonly nextStep?: string;
}

export interface ContextReferenceTarget {
  readonly itemId: InventoryItemId;
  readonly anchorId: AnchorId;
}

export function createWorkingContextDraft(input: {
  readonly displayName: string;
  readonly purpose?: string;
  readonly boundary?: string;
  readonly nextStep?: string;
}): WorkingContextDraft {
  requireText(input.displayName, 160, 'display name');
  validateOptional(input.purpose, 2_000, 'purpose');
  validateOptional(input.boundary, 2_000, 'boundary');
  validateOptional(input.nextStep, 500, 'next step');
  return Object.freeze({ ...input });
}

export function freeWorkScope(): WorkScope {
  return Object.freeze({ kind: 'free' });
}

export function contextWorkScope(contextId: WorkingContextId): WorkScope {
  return Object.freeze({ kind: 'context', contextId });
}

function validateOptional(
  value: string | undefined,
  max: number,
  name: string,
): void {
  if (value !== undefined) requireText(value, max, name);
}

function requireText(value: string, max: number, name: string): void {
  if (value.trim() !== value || value.length === 0 || value.length > max) {
    throw new Error(`A working context requires a valid ${name}.`);
  }
}
