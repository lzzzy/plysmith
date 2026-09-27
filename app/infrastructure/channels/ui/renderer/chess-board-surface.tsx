import { useRef, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { Button } from 'react-aria-components';

import styles from './chess-board-surface.module.css';

export const chessBoardFiles = [
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
] as const;
const chessBoardRanks = [8, 7, 6, 5, 4, 3, 2, 1] as const;
const reversedFiles = [...chessBoardFiles].reverse();
const reversedRanks = [...chessBoardRanks].reverse();

export type ChessBoardOrientation = 'white' | 'black';

export interface ChessBoardSurfacePiece {
  readonly accessibleName: string;
  readonly symbol: string;
}

export function ChessPieceGlyph({
  className,
  symbol,
}: {
  readonly className?: string | undefined;
  readonly symbol: string;
}) {
  return (
    <span
      className={`${styles.plysmithPieceGlyph} ${className ?? ''}`}
      aria-hidden="true"
    >
      {symbol}
    </span>
  );
}

export function ChessBoardOrientationButton({
  isDisabled = false,
  label,
  onToggle,
}: {
  readonly isDisabled?: boolean;
  readonly label: string;
  readonly onToggle: () => void;
}) {
  return (
    <Button
      className={styles.orientationButton!}
      isDisabled={isDisabled}
      aria-label={label}
      onPress={onToggle}
    >
      <RotateCw size={17} aria-hidden="true" />
      <span>{label}</span>
    </Button>
  );
}

export function ChessBoardSurface({
  pieces,
  emptySquareName,
  ariaLabel,
  ariaReadOnly,
  className,
  isInteractive = true,
  showCoordinates = true,
  orientation = 'white',
  selectedSquare,
  getSquareClassName,
  onSquarePress,
  onEscape,
}: {
  readonly pieces: ReadonlyMap<string, ChessBoardSurfacePiece>;
  readonly emptySquareName: string;
  readonly ariaLabel: string;
  readonly ariaReadOnly?: boolean;
  readonly className?: string;
  readonly isInteractive?: boolean;
  readonly showCoordinates?: boolean;
  readonly orientation?: ChessBoardOrientation;
  readonly selectedSquare?: string;
  readonly getSquareClassName?: (square: string) => string;
  readonly onSquarePress?: (square: string) => void;
  readonly onEscape?: () => boolean;
}) {
  const [focusSquare, setFocusSquare] = useState('e2');
  const squareRefs = useRef(new Map<string, HTMLButtonElement>());
  const files = orientation === 'white' ? chessBoardFiles : reversedFiles;
  const ranks = orientation === 'white' ? chessBoardRanks : reversedRanks;
  const direction = orientation === 'white' ? 1 : -1;

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
    <div
      className={`${styles.board} ${className ?? ''}`}
      role="grid"
      aria-label={ariaLabel}
      aria-readonly={ariaReadOnly}
    >
      {ranks.map((rank) => (
        <div key={rank} className={styles.boardRow} role="row">
          {files.map((file) => {
            const square = `${file}${rank}`;
            const piece = pieces.get(square);
            const fileIndex = file.charCodeAt(0) - 97;
            const dark = (fileIndex + rank) % 2 === 1;
            const selected = selectedSquare === square;
            return (
              <button
                key={square}
                ref={(element) => {
                  if (element === null) squareRefs.current.delete(square);
                  else squareRefs.current.set(square, element);
                }}
                type="button"
                data-chess-board-square
                data-chess-board-occupied={
                  piece === undefined ? undefined : 'true'
                }
                role="gridcell"
                aria-label={`${square}, ${piece?.accessibleName ?? emptySquareName}`}
                aria-selected={selected}
                className={`${styles.square} ${dark ? styles.dark : styles.light} ${getSquareClassName?.(square) ?? ''}`}
                tabIndex={focusSquare === square ? 0 : -1}
                onClick={() => {
                  if (isInteractive) onSquarePress?.(square);
                }}
                onFocus={() => setFocusSquare(square)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    moveFocus(square, -direction, 0);
                  } else if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    moveFocus(square, direction, 0);
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    moveFocus(square, 0, direction);
                  } else if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    moveFocus(square, 0, -direction);
                  } else if (event.key === 'Escape' && onEscape?.()) {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }}
              >
                {piece !== undefined && (
                  <span className={styles.piece} aria-hidden="true">
                    <ChessPieceGlyph symbol={piece.symbol} />
                  </span>
                )}
                {showCoordinates && file === files[0] && (
                  <span className={styles.rankLabel} aria-hidden="true">
                    {rank}
                  </span>
                )}
                {showCoordinates && rank === ranks[7] && (
                  <span className={styles.fileLabel} aria-hidden="true">
                    {file}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
