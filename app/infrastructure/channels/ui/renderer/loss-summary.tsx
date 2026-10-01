import { FormattedMessage, FormattedNumber } from 'react-intl';

import type {
  ContextRemovalPreviewDto,
  PendingRevisionImpactDto,
} from '../../host_client/index.ts';
import styles from './loss-summary.module.css';

type UsageSummary = PendingRevisionImpactDto['useTargetLoss'];

export function contextRemovalSummary(
  preview: ContextRemovalPreviewDto,
): UsageSummary {
  const { losses } = preview;
  return {
    referenceCount: preview.referenceCount,
    activeNoteCount: losses.notes.length,
    noteMoveCount: losses.notes.reduce((sum, note) => sum + note.moveCount, 0),
    scratchCount: Number(losses.scratch !== undefined),
    changedScratchCount: Number(losses.scratch?.hasChanges === true),
    scratchMoveCount: losses.scratch?.stepCount ?? 0,
    scratchNoteCount: Number(
      (losses.scratch?.noteBody?.trim().length ?? 0) > 0,
    ),
    managementResumeAffected: losses.managementResume !== undefined,
    analysisResumeAffected: losses.analysisResume !== undefined,
  };
}

export function LossSummary({ summary }: { readonly summary: UsageSummary }) {
  const counts = [
    ['references', summary.referenceCount],
    ['notes', summary.activeNoteCount],
    ['noteMoves', summary.noteMoveCount],
    ['scratch', summary.scratchCount],
    ['scratchMoves', summary.scratchMoveCount],
    ['scratchNotes', summary.scratchNoteCount],
    ['managementResume', Number(summary.managementResumeAffected)],
    ['analysisResume', Number(summary.analysisResumeAffected)],
  ] as const;
  const affected = counts.filter(([, count]) => count > 0);
  if (affected.length === 0)
    return (
      <p>
        <FormattedMessage id="loss.none" />
      </p>
    );
  return (
    <dl className={styles.summary}>
      {affected.map(([name, count]) => (
        <div key={name}>
          <dt>
            <FormattedMessage id={`loss.${name}`} />
          </dt>
          <dd>
            <FormattedNumber value={count} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
