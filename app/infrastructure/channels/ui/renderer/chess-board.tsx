import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, Modal, ModalOverlay } from 'react-aria-components';
import { FormattedMessage, useIntl } from 'react-intl';

import type { AnalysisWorkspaceDto } from '../../host_client/index.ts';
import {
  parseFenBoard,
  pieceName,
  sideName,
  type CanonicalMoveDto,
} from './chess-display.ts';
import type { UiLocale } from './messages.ts';
import styles from './chess-board.module.css';

const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const ranks = [8, 7, 6, 5, 4, 3, 2, 1] as const;

interface ChessBoardProps {
  readonly workspace: AnalysisWorkspaceDto;
  readonly locale: UiLocale;
  readonly isBusy: boolean;
  readonly onMove: (
    from: string,
    to: string,
    promotion?: 'queen' | 'rook' | 'bishop' | 'knight',
  ) => void;
}

export function ChessBoard({
  workspace,
  locale,
  isBusy,
  onMove,
}: ChessBoardProps) {
  const intl = useIntl();
  const board = useMemo(
    () => parseFenBoard(workspace.currentState.fen),
    [workspace.currentState.fen],
  );
  const interactive =
    workspace.scratch !== undefined &&
    workspace.allowedActions.includes('apply_move') &&
    !isBusy;
  const [selectedSquare, setSelectedSquare] = useState<string>();
  const [focusSquare, setFocusSquare] = useState('e2');
  const [promotionMoves, setPromotionMoves] = useState<
    readonly CanonicalMoveDto[]
  >([]);
  const squareRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    setSelectedSquare(undefined);
    setPromotionMoves([]);
  }, [workspace.currentState.fen]);

  const legalSources = new Set(workspace.legalMoves.map((move) => move.from));
  const legalTargets = new Set(
    selectedSquare === undefined
      ? []
      : workspace.legalMoves
          .filter((move) => move.from === selectedSquare)
          .map((move) => move.to),
  );

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

  function moveFocus(square: string, fileDelta: number, rankDelta: number) {
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]);
    const nextFile = Math.min(7, Math.max(0, file + fileDelta));
    const nextRank = Math.min(8, Math.max(1, rank + rankDelta));
    const nextSquare = `${String.fromCharCode(97 + nextFile)}${nextRank}`;
    setFocusSquare(nextSquare);
    squareRefs.current.get(nextSquare)?.focus();
  }

  return (
    <section className={styles.boardRegion} aria-labelledby="board-title">
      <div className={styles.boardHeading}>
        <h2 id="board-title">
          <FormattedMessage id="analysis.board" />
        </h2>
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
      </div>
      <div
        className={styles.board}
        role="grid"
        aria-label={intl.formatMessage({ id: 'analysis.boardLabel' })}
        aria-readonly={!interactive}
      >
        {ranks.map((rank) => (
          <div key={rank} className={styles.boardRow} role="row">
            {files.map((fileName) => {
              const square = `${fileName}${rank}`;
              const piece = board.get(square);
              const file = square.charCodeAt(0) - 97;
              const dark = (file + rank) % 2 === 1;
              const selected = selectedSquare === square;
              const target = legalTargets.has(square);
              const movable = interactive && legalSources.has(square);
              const label = `${square}, ${
                piece === undefined
                  ? intl.formatMessage({ id: 'analysis.emptySquare' })
                  : pieceName(piece, locale)
              }`;
              return (
                <button
                  key={square}
                  ref={(element) => {
                    if (element === null) squareRefs.current.delete(square);
                    else squareRefs.current.set(square, element);
                  }}
                  type="button"
                  role="gridcell"
                  aria-label={label}
                  aria-selected={selected}
                  className={`${styles.square} ${dark ? styles.dark : styles.light} ${selected ? styles.selected : ''} ${target ? styles.target : ''} ${movable ? styles.movable : ''}`}
                  tabIndex={focusSquare === square ? 0 : -1}
                  onClick={() => activateSquare(square)}
                  onFocus={() => setFocusSquare(square)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowLeft') {
                      event.preventDefault();
                      moveFocus(square, -1, 0);
                    } else if (event.key === 'ArrowRight') {
                      event.preventDefault();
                      moveFocus(square, 1, 0);
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      moveFocus(square, 0, 1);
                    } else if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      moveFocus(square, 0, -1);
                    } else if (event.key === 'Escape') {
                      setSelectedSquare(undefined);
                      setPromotionMoves([]);
                    }
                  }}
                >
                  {piece !== undefined && (
                    <span className={styles.piece} aria-hidden="true">
                      {piece.symbol}
                    </span>
                  )}
                  {file === 0 && (
                    <span className={styles.rankLabel} aria-hidden="true">
                      {rank}
                    </span>
                  )}
                  {rank === 1 && (
                    <span className={styles.fileLabel} aria-hidden="true">
                      {fileName}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <ModalOverlay
        className={styles.promotionOverlay!}
        isOpen={promotionMoves.length > 0}
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
                  onPress={() => {
                    onMove(move.from, move.to, move.promotion ?? undefined);
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
