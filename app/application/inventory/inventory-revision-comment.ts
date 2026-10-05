import { validatePositionNoteInput } from '../analysis/index.ts';
import type { WorkScope } from '../../domain/workspace/index.ts';
import type { InventoryRevisionComment } from './inventory-models.ts';

export function normalizeInventoryRevisionComment(
  scope: WorkScope,
  comment: InventoryRevisionComment | undefined,
): InventoryRevisionComment | undefined {
  if (comment === undefined) return undefined;
  validatePositionNoteInput({ scope, ...comment });
  return Object.freeze({
    body: comment.body.trim(),
    languageTag: comment.languageTag,
    noteScope:
      comment.noteScope.kind === 'global'
        ? Object.freeze({ kind: 'global' as const })
        : Object.freeze({
            kind: 'context' as const,
            contextId: comment.noteScope.contextId,
          }),
  });
}
