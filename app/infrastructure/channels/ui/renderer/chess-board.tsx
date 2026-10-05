import { useEffect, useMemo, useState } from 'react';
import { Button, Dialog, Modal, ModalOverlay } from 'react-aria-components';
import { FormattedMessage, useIntl } from 'react-intl';

import type { AnalysisWorkspaceDto } from '../../host_client/index.ts';
import {
  parseFenBoard,
  pieceName,
  sideName,
  type CanonicalMoveDto,
} from './chess-display.ts';
import {
  ChessBoardOrientationButton,
  ChessBoardSurface,
  type ChessBoardOrientation,
} from './chess-board-surface.tsx';
import type { UiLocale } from './messages.ts';
import styles from './chess-board.module.css';

interface ChessBoardProps {
  readonly workspace: AnalysisWorkspaceDto;
  readonly locale: UiLocale;
  readonly isBusy: boolean;
  readonly canMove?: boolean;
  readonly undoMove?: Pick<CanonicalMoveDto, 'from' | 'to'>;
  readonly onMove: (
    from: string,
    to: string,
    promotion?: 'queen' | 'rook' | 'bishop' | 'knight',
  ) => void;
  readonly onTakeBack?: () => void;
  readonly initialOrientation?: ChessBoardOrientation;
}

export function ChessBoard({
  workspace,
  locale,
  isBusy,
  canMove,
  undoMove,
  onMove,
  onTakeBack,
  initialOrientation = 'white',
}: ChessBoardProps) {
  const intl = useIntl();
  const board = useMemo(
    () => parseFenBoard(workspace.currentState.fen),
    [workspace.currentState.fen],
  );
  const surfacePieces = useMemo(
    () =>
      new Map(
        [...board].map(([square, piece]) => [
          square,
          { symbol: piece.symbol, accessibleName: pieceName(piece, locale) },
        ]),
      ),
    [board, locale],
  );
  const interactive =
    (canMove ??
      (workspace.scratch !== undefined &&
        workspace.allowedActions.includes('apply_move'))) &&
    !isBusy;
  const [selectedSquare, setSelectedSquare] = useState<string>();
  const [orientation, setOrientation] =
    useState<ChessBoardOrientation>(initialOrientation);
  const [promotionMoves, setPromotionMoves] = useState<
    readonly CanonicalMoveDto[]
  >([]);

  useEffect(() => {
    setSelectedSquare(undefined);
    setPromotionMoves([]);
  }, [
    interactive,
    workspace.currentState.fen,
    workspace.scope.kind,
    workspace.scope.kind === 'context' ? workspace.scope.contextId : undefined,
    workspace.scratch?.scratchId,
    workspace.scratch?.cursor,
    workspace.record?.itemId,
    workspace.record?.revisionId,
    workspace.record?.currentAnchorId,
  ]);

  useEffect(() => setOrientation(initialOrientation), [initialOrientation]);

  const legalSources = new Set(workspace.legalMoves.map((move) => move.from));
  if (undoMove !== undefined) legalSources.add(undoMove.to);
  const legalTargets = new Set(
    !interactive || selectedSquare === undefined
      ? []
      : workspace.legalMoves
          .filter((move) => move.from === selectedSquare)
          .map((move) => move.to),
  );
  if (interactive && undoMove !== undefined && selectedSquare === undoMove.to)
    legalTargets.add(undoMove.from);

  function activateSquare(square: string) {
    if (!interactive) return;
    if (selectedSquare === undefined) {
      if (legalSources.has(square)) setSelectedSquare(square);
      return;
    }
    if (selectedSquare === square) {
      setSelectedSquare(undefined);
      return;
    }
    if (
      undoMove !== undefined &&
      selectedSquare === undoMove.to &&
      square === undoMove.from
    ) {
      setSelectedSquare(undefined);
      onTakeBack?.();
      return;
    }
    const matching = workspace.legalMoves.filter(
      (move) => move.from === selectedSquare && move.to === square,
    );
    if (matching.length === 0) {
      setSelectedSquare(legalSources.has(square) ? square : undefined);
      return;
    }
    if (matching.length > 1) {
      setPromotionMoves(matching);
      return;
    }
    const move = matching[0];
    if (move !== undefined)
      onMove(move.from, move.to, move.promotion ?? undefined);
  }

  return (
    <section
      className={styles.boardRegion}
      aria-labelledby="board-title"
      data-analysis-board
    >
      <div className={styles.boardHeading}>
        <h2 id="board-title">
          <FormattedMessage id="analysis.board" />
        </h2>
        <div className={styles.boardStatus}>
          <span>
            <FormattedMessage
              id="analysis.sideToMove"
              values={{
                side: sideName(
                  workspace.currentState.position.sideToMove,
                  locale,
                ),
              }}
            />
          </span>
          <ChessBoardOrientationButton
            label={intl.formatMessage({ id: 'board.flip' })}
            onToggle={() =>
              setOrientation((current) =>
                current === 'white' ? 'black' : 'white',
              )
            }
          />
        </div>
      </div>
      <ChessBoardSurface
        className={styles.boardSize!}
        pieces={surfacePieces}
        emptySquareName={intl.formatMessage({ id: 'analysis.emptySquare' })}
        ariaLabel={intl.formatMessage({ id: 'analysis.boardLabel' })}
        ariaReadOnly={!interactive}
        isInteractive={interactive}
        orientation={orientation}
        {...(!interactive || selectedSquare === undefined
          ? {}
          : { selectedSquare })}
        getSquareClassName={(square) => {
          const selected = interactive && selectedSquare === square;
          const target = legalTargets.has(square);
          const movable = interactive && legalSources.has(square);
          const lastMove =
            (!interactive || selectedSquare === undefined) &&
            undoMove !== undefined &&
            (square === undoMove.from || square === undoMove.to);
          return `${lastMove ? styles.lastMove : ''} ${selected ? styles.selected : ''} ${target ? styles.target : ''} ${movable ? styles.movable : ''}`;
        }}
        onSquarePress={activateSquare}
        onEscape={() => {
          const handled = selectedSquare !== undefined;
          setSelectedSquare(undefined);
          setPromotionMoves([]);
          return handled;
        }}
      />

      <ModalOverlay
        className={styles.promotionOverlay!}
        isOpen={interactive && promotionMoves.length > 0}
        isDismissable
        onOpenChange={(open) => {
          if (!open) {
            setPromotionMoves([]);
            setSelectedSquare(undefined);
          }
        }}
      >
        <Modal className={styles.promotionModal!}>
          <Dialog
            className={styles.promotionPanel!}
            aria-label={intl.formatMessage({ id: 'analysis.choosePromotion' })}
          >
            <strong>
              <FormattedMessage id="analysis.choosePromotion" />
            </strong>
            <div>
              {promotionMoves.map((move, index) => (
                <Button
                  key={move.promotion}
                  className={styles.promotionButton!}
                  autoFocus={index === 0}
                  isDisabled={!interactive}
                  onPress={() => {
                    if (
                      interactive &&
                      workspace.legalMoves.some(
                        (legal) =>
                          legal.from === move.from &&
                          legal.to === move.to &&
                          legal.promotion === move.promotion,
                      )
                    ) {
                      onMove(move.from, move.to, move.promotion ?? undefined);
                    }
                    setPromotionMoves([]);
                    setSelectedSquare(undefined);
                  }}
                >
                  <FormattedMessage id={`piece.${move.promotion}`} />
                </Button>
              ))}
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </section>
  );
}
