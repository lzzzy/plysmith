import { Fragment, useState, type ReactNode } from 'react';
import { GitBranch, Trash2 } from 'lucide-react';
import { useIntl } from 'react-intl';
import type { AnalysisRecordDto } from '../../host_client/index.ts';
import { localizeSan } from './chess-display.ts';
import { chessTreeLayout } from './chess-tree-presentation.ts';
import styles from './chess-tree-view.module.css';

export function ChessTreeMoveList(props: {
  readonly record: AnalysisRecordDto;
  readonly anchorId: string;
  readonly disabled: boolean;
  readonly onSelect: (anchorId: string) => void;
  readonly renderSteps?: (
    steps: AnalysisRecordDto['steps'],
    key: string,
  ) => ReactNode;
  readonly onRemoveVariation?: (anchorId: string) => void;
  readonly draft?: { readonly anchorId: string; readonly content: ReactNode };
}) {
  return (
    <ChessTreeList
      key={props.record.itemId + ':' + props.record.revisionId}
      {...props}
    />
  );
}

function ChessTreeList({
  record,
  anchorId,
  disabled,
  onSelect,
  renderSteps,
  onRemoveVariation,
  draft,
}: Parameters<typeof ChessTreeMoveList>[0]) {
  const intl = useIntl();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const locale = intl.locale.startsWith('de') ? 'de-DE' : 'en-GB';
  const lines = chessTreeLayout(record, draft?.anchorId);
  const draftOwners = new Set<string>();
  let owner =
    draft === undefined
      ? undefined
      : lines.find((line) =>
          line.steps.some((step) => step.anchorId === draft.anchorId),
        );
  while (owner !== undefined) {
    draftOwners.add(owner.key);
    owner = lines.find((line) => line.key === owner!.parentKey);
  }
  const main = lines.find((line) => !line.variation);
  const rendered = new Map<string, ReactNode>();
  const moveLabel = (step: AnalysisRecordDto['steps'][number]) =>
    `${step.before.playState.fullmoveNumber}${step.before.position.sideToMove === 'black' ? '...' : '.'} ${localizeSan(step.move.san, locale)}`;

  function renderCompactSteps(steps: AnalysisRecordDto['steps']) {
    const pairs: AnalysisRecordDto['steps'][] = [];
    for (const step of steps) {
      const previous = pairs.at(-1);
      if (
        previous?.length === 1 &&
        previous[0]!.before.position.sideToMove === 'white' &&
        step.before.position.sideToMove === 'black' &&
        previous[0]!.before.playState.fullmoveNumber ===
          step.before.playState.fullmoveNumber
      )
        pairs[pairs.length - 1] = [...previous, step];
      else pairs.push([step]);
    }
    return pairs.map((pair) => (
      <li key={pair[0]!.anchorId} className={styles.pair} data-tree-move-pair>
        {pair.map((step, index) => (
          <button
            type="button"
            key={step.anchorId}
            className={styles.move}
            data-tree-anchor={step.anchorId}
            aria-label={moveLabel(step)}
            aria-current={anchorId === step.anchorId ? 'step' : undefined}
            disabled={disabled}
            onClick={() => onSelect(step.anchorId)}
          >
            {index === 0 ? moveLabel(step) : localizeSan(step.move.san, locale)}
          </button>
        ))}
      </li>
    ));
  }

  // Build children first: DOM nesting follows ownership without recursive projection.
  for (const line of [...lines].reverse()) {
    const closed =
      line.variation && !expanded.has(line.key) && !draftOwners.has(line.key);
    const startLabel = moveLabel(line.steps[0]!);
    const collapseLabel = intl.formatMessage(
      {
        id: closed
          ? 'chessTree.expandVariation'
          : 'chessTree.collapseVariation',
      },
      { move: startLabel },
    );
    rendered.set(
      line.key,
      <li
        key={line.key}
        className={styles.line}
        data-tree-line={line.key}
        style={{
          paddingInlineStart:
            line.variation && line.depth <= 3 ? '12px' : undefined,
        }}
      >
        {line.variation && (
          <div className={styles.heading}>
            <button
              type="button"
              className={styles.toggle}
              aria-label={collapseLabel}
              title={collapseLabel}
              aria-expanded={!closed}
              disabled={draftOwners.has(line.key)}
              onClick={() =>
                setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(line.key)) next.delete(line.key);
                  else next.add(line.key);
                  return next;
                })
              }
            >
              <GitBranch size={16} aria-hidden="true" />
            </button>
            {onRemoveVariation && (
              <button
                type="button"
                className={styles.remove}
                aria-label={intl.formatMessage(
                  { id: 'chessTree.removeVariation' },
                  { move: startLabel },
                )}
                title={intl.formatMessage(
                  { id: 'chessTree.removeVariation' },
                  { move: startLabel },
                )}
                disabled={disabled}
                onClick={() => onRemoveVariation(line.key)}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        {!closed && (
          <ol className={styles.sections}>
            {line.sections.map((section, index) => (
              <Fragment key={line.key + ':' + index}>
                {section.steps.length > 0 && (
                  <li>
                    <ol
                      className={
                        renderSteps ? styles.moves : styles.compactMoves
                      }
                    >
                      {renderSteps
                        ? renderSteps(section.steps, section.steps[0]!.anchorId)
                        : renderCompactSteps(section.steps)}
                    </ol>
                  </li>
                )}
                {section.branches.map((key) => rendered.get(key))}
                {section.draft && draft && (
                  <li className={styles.draft} data-tree-draft>
                    <ol className={styles.moves}>{draft.content}</ol>
                  </li>
                )}
              </Fragment>
            ))}
          </ol>
        )}
      </li>,
    );
  }
  if (lines.length === 0 && draft === undefined) return null;
  return (
    <ol
      className={styles.tree}
      aria-label={intl.formatMessage({ id: 'analysis.moveList' })}
    >
      {lines
        .filter(
          (line) =>
            line.parentKey === undefined &&
            (!line.variation || main === undefined),
        )
        .map((line) => rendered.get(line.key))}
      {main === undefined && draft?.anchorId === record.rootAnchorId && (
        <li className={styles.draft} data-tree-draft>
          <ol className={styles.moves}>{draft.content}</ol>
        </li>
      )}
    </ol>
  );
}
