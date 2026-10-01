import type {
  ContextRemovalPreviewDto,
  PendingRevisionImpactDto,
} from '../../host_client/index.ts';

export function hasContentLoss(
  loss: Pick<
    PendingRevisionImpactDto['useTargetLoss'],
    'activeNoteCount' | 'changedScratchCount'
  >,
): boolean {
  return loss.activeNoteCount > 0 || loss.changedScratchCount > 0;
}

export function contextRemovalHasContentLoss(
  preview: ContextRemovalPreviewDto,
): boolean {
  return hasContentLoss({
    activeNoteCount: preview.losses.notes.length,
    changedScratchCount: Number(preview.losses.scratch?.hasChanges === true),
  });
}
