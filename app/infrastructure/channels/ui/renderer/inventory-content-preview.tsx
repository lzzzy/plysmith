import { useId, useState } from 'react';
import { ArrowLeft, ArrowRight, SkipBack } from 'lucide-react';
import { Button } from 'react-aria-components';
import { FormattedMessage, useIntl } from 'react-intl';

import type { AnalysisRecordDto } from '../../host_client/index.ts';
import { ChessBoardSurface } from './chess-board-surface.tsx';
import { parseFenBoard, pieceName, sideName } from './chess-display.ts';
import { inventoryContentPresentation } from './inventory-content-presentation.ts';
import { GameOutcomeLabel } from './game-outcome-label.tsx';
import { chessTreePath } from './chess-tree-presentation.ts';
import { ChessTreeMoveList } from './chess-tree-view.tsx';
import styles from './inventory-content-preview.module.css';

export function InventoryContentPreview({
  record,
}: {
  readonly record: AnalysisRecordDto;
}) {
  return (
    <InventoryContent
      key={JSON.stringify([record.itemId, record.revisionId])}
      record={record}
    />
  );
}

function InventoryContent({ record }: { readonly record: AnalysisRecordDto }) {
  const intl = useIntl();
  const locale = intl.locale.startsWith('de') ? 'de-DE' : 'en-GB';
  const movesId = useId();
  const [cursor, setCursor] = useState(0);
  const [branchAnchor, setBranchAnchor] = useState(record.rootAnchorId);
  const previewRecord =
    record.tree === undefined
      ? record
      : { ...record, ...chessTreePath(record, branchAnchor) };
  const content = inventoryContentPresentation(previewRecord, cursor, locale);
  const currentAnchor =
    previewRecord.steps[content.cursor - 1]?.anchorId ?? record.rootAnchorId;
  const pieces = new Map(
    [...parseFenBoard(content.state.fen)].map(([square, piece]) => [
      square,
      { symbol: piece.symbol, accessibleName: pieceName(piece, locale) },
    ]),
  );
  const rootLabel = intl.formatMessage({
    id: 'playout.startPosition',
    defaultMessage: 'Starting position',
  });
  const previousLabel = intl.formatMessage({
    id: 'analysis.previousMove',
    defaultMessage: 'Previous move',
  });
  const nextLabel = intl.formatMessage({
    id: 'analysis.nextMove',
    defaultMessage: 'Next move',
  });
  const game = record.game;

  return (
    <div className={styles.content} data-inventory-content-preview>
      {game !== undefined && (
        <dl className={styles.facts}>
          <div>
            <dt>
              <FormattedMessage
                id="inventory.content.playerSide"
                defaultMessage="Your side"
              />
            </dt>
            <dd>{sideName(game.playerSide, locale)}</dd>
          </div>
          <div>
            <dt>
              <FormattedMessage
                id="playout.opponent"
                defaultMessage="Opponent"
              />
            </dt>
            <dd>{game.policy.providerDisplayName}</dd>
          </div>
          <div>
            <dt>
              <FormattedMessage
                id="inventory.content.outcome"
                defaultMessage="Result"
              />
            </dt>
            <dd>
              <GameOutcomeLabel outcome={game.outcome} />
            </dd>
          </div>
          <div>
            <dt>
              <FormattedMessage id="playout.resultSource" />
            </dt>
            <dd>
              <FormattedMessage
                id={`playout.resultSource.${game.outcomeSource}`}
              />
            </dd>
          </div>
        </dl>
      )}
      <div className={styles.boardRegion}>
        <ChessBoardSurface
          pieces={pieces}
          emptySquareName={intl.formatMessage({ id: 'analysis.emptySquare' })}
          ariaLabel={intl.formatMessage({ id: 'analysis.boardLabel' })}
          ariaReadOnly
          isInteractive={false}
          showCoordinates={false}
          orientation={game?.playerSide ?? 'white'}
        />
        <div className={styles.navigation}>
          <span title={rootLabel}>
            <Button
              className={styles.iconButton!}
              aria-label={rootLabel}
              isDisabled={content.cursor === 0}
              onPress={() => setCursor(0)}
            >
              <SkipBack size={16} aria-hidden="true" />
            </Button>
          </span>
          <span title={previousLabel}>
            <Button
              className={styles.iconButton!}
              aria-label={previousLabel}
              isDisabled={content.cursor === 0}
              onPress={() => setCursor(content.cursor - 1)}
            >
              <ArrowLeft size={16} aria-hidden="true" />
            </Button>
          </span>
          <span className={styles.cursor} aria-live="polite" aria-atomic="true">
            {content.cursor === 0
              ? rootLabel
              : content.moves[content.cursor - 1]?.label}
            <span>
              <FormattedMessage
                id="analysis.sideToMove"
                defaultMessage="{side} to move"
                values={{
                  side: sideName(content.state.position.sideToMove, locale),
                }}
              />
            </span>
          </span>
          <span title={nextLabel}>
            <Button
              className={styles.iconButton!}
              aria-label={nextLabel}
              isDisabled={content.cursor === content.moves.length}
              onPress={() => setCursor(content.cursor + 1)}
            >
              <ArrowRight size={16} aria-hidden="true" />
            </Button>
          </span>
        </div>
      </div>
      <section className={styles.line} aria-labelledby={movesId}>
        <h3 id={movesId}>
          <FormattedMessage id="analysis.moveList" defaultMessage="Moves" />
        </h3>
        {(record.tree?.nodes.length ?? record.steps.length) === 0 ? (
          <p className={styles.empty}>
            <FormattedMessage
              id="inventory.content.noMoves"
              defaultMessage="No moves"
            />
          </p>
        ) : (
          <ChessTreeMoveList
            record={record}
            anchorId={currentAnchor}
            disabled={false}
            onSelect={(anchorId) => {
              setBranchAnchor(anchorId);
              setCursor(chessTreePath(record, anchorId).cursor);
            }}
          />
        )}
      </section>
      {content.source !== undefined && (
        <details className={styles.source}>
          <summary>
            <FormattedMessage id="manage.origin" defaultMessage="Origin" />
            {': '}
            {content.source.displayName}
          </summary>
          <p className={styles.sourceMoves} tabIndex={0}>
            {content.source.moves.length === 0
              ? rootLabel
              : content.source.moves.map((move) => move.label).join(' ')}
          </p>
        </details>
      )}
    </div>
  );
}
