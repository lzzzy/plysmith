import { ArrowRight } from 'lucide-react';
import { FormattedMessage, useIntl } from 'react-intl';

import { localizeSan } from './chess-display.ts';
import styles from './revision-line-comparison.module.css';

export interface RevisionLine {
  readonly displayName?: string | undefined;
  readonly summary?: string | undefined;
  readonly root: {
    readonly position: { readonly sideToMove: 'white' | 'black' };
    readonly playState: { readonly fullmoveNumber: number };
  };
  readonly steps: readonly {
    readonly anchorId?: string;
    readonly move: { readonly san: string };
  }[];
}

export function RevisionLineComparison({
  previous,
  next,
  unchangedCount = commonPrefixLength(previous, next),
}: {
  readonly previous: RevisionLine;
  readonly next: RevisionLine;
  readonly unchangedCount?: number;
}) {
  const intl = useIntl();
  const previousMoves = revisionLineTokens(previous, intl.locale);
  const nextMoves = revisionLineTokens(next, intl.locale);

  return (
    <section className={styles.changeOverview}>
      <strong>
        <FormattedMessage id="revisionImpact.changeOverview" />
      </strong>
      {previous.displayName !== next.displayName && (
        <ComparedText
          label="inventory.displayName"
          previous={previous.displayName}
          next={next.displayName}
        />
      )}
      {previous.summary !== next.summary && (
        <ComparedText
          label="inventory.summary"
          previous={previous.summary}
          next={next.summary}
        />
      )}
      <ComparedLine
        label="revisionImpact.previousLine"
        moves={previousMoves}
        unchangedCount={unchangedCount}
        change="removed"
      />
      <ComparedLine
        label="revisionImpact.targetLine"
        moves={nextMoves}
        unchangedCount={unchangedCount}
        change="added"
      />
    </section>
  );
}

function ComparedText({
  label,
  previous,
  next,
}: {
  readonly label: string;
  readonly previous: string | undefined;
  readonly next: string | undefined;
}) {
  return (
    <div className={styles.comparisonLine}>
      <span className={styles.comparisonLabel}>
        <FormattedMessage id={label} />
      </span>
      <span className={styles.textChange}>
        <del>{previous ?? <FormattedMessage id="inventory.emptyValue" />}</del>
        <ArrowRight aria-hidden="true" size={13} />
        <ins>{next ?? <FormattedMessage id="inventory.emptyValue" />}</ins>
      </span>
    </div>
  );
}

function ComparedLine({
  label,
  moves,
  unchangedCount,
  change,
}: {
  readonly label: string;
  readonly moves: readonly { readonly key: string; readonly label: string }[];
  readonly unchangedCount: number;
  readonly change: 'removed' | 'added';
}) {
  return (
    <div className={styles.comparisonLine}>
      <span className={styles.comparisonLabel}>
        <FormattedMessage id={label} />
      </span>
      <span className={styles.moves}>
        {moves.length === 0 ? (
          <em>
            <FormattedMessage id="revisionImpact.initialPosition" />
          </em>
        ) : (
          moves.map((move, index) => {
            if (index < unchangedCount) {
              return (
                <span key={move.key} className={styles.unchangedMove}>
                  {move.label}
                </span>
              );
            }
            return change === 'removed' ? (
              <del key={move.key} className={styles.removedMove}>
                {move.label}
              </del>
            ) : (
              <ins key={move.key} className={styles.addedMove}>
                {move.label}
              </ins>
            );
          })
        )}
      </span>
    </div>
  );
}

function revisionLineTokens(
  revision: RevisionLine,
  locale: string,
): readonly { readonly key: string; readonly label: string }[] {
  const initialPly =
    (revision.root.playState.fullmoveNumber - 1) * 2 +
    (revision.root.position.sideToMove === 'black' ? 1 : 0);
  return revision.steps.map((step, index) => {
    const ply = initialPly + index;
    const moveNumber = Math.floor(ply / 2) + 1;
    const prefix = ply % 2 === 0 ? `${moveNumber}.` : `${moveNumber}...`;
    return Object.freeze({
      key: step.anchorId ?? `new-${index}`,
      label: `${prefix} ${localizeSan(
        step.move.san,
        locale.startsWith('de') ? 'de-DE' : 'en-GB',
      )}`,
    });
  });
}

function commonPrefixLength(previous: RevisionLine, next: RevisionLine) {
  const length = Math.min(previous.steps.length, next.steps.length);
  let index = 0;
  while (
    index < length &&
    previous.steps[index]?.anchorId !== undefined &&
    previous.steps[index]?.anchorId === next.steps[index]?.anchorId
  ) {
    index += 1;
  }
  return index;
}
