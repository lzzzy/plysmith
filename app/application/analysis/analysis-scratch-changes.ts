import type { AnalysisScratch } from '../../domain/analysis/index.ts';
import {
  inventoryRevisionHasChanges,
  type InventoryRevisionLine,
} from '../../domain/inventory/index.ts';

export function analysisScratchHasChanges(
  scratch: AnalysisScratch | undefined,
  base?: InventoryRevisionLine,
): boolean {
  if (scratch === undefined) return false;
  if (
    scratch.noteDraft !== undefined &&
    (scratch.noteDraft.body.trim() !== '' || scratch.noteDraft.moves.length > 0)
  ) {
    return true;
  }
  if (scratch.intent.kind === 'exploration') {
    return (
      scratch.steps.length > 0 ||
      scratch.origin.kind === 'fen' ||
      scratch.origin.kind === 'position_setup'
    );
  }
  if (base === undefined) return true;
  try {
    // Cursor navigation is not a change to the complete candidate line.
    return inventoryRevisionHasChanges({
      base,
      scratch: { ...scratch, cursor: scratch.steps.length },
    });
  } catch {
    return true;
  }
}
