import { localizeSan } from './chess-display.ts';
import type { UiLocale } from './messages.ts';

export interface PlayoutMoveRow {
  readonly moveNumber: number;
  readonly white?: { readonly notation: string; readonly ply: number };
  readonly black?: { readonly notation: string; readonly ply: number };
}

export function playoutMoveRows(
  root: {
    readonly position: { readonly sideToMove: 'white' | 'black' };
    readonly playState: { readonly fullmoveNumber: number };
  },
  steps: readonly { readonly move: { readonly san: string } }[],
  locale: UiLocale,
): readonly PlayoutMoveRow[] {
  const rows: PlayoutMoveRow[] = [];
  let side = root.position.sideToMove;
  let moveNumber = root.playState.fullmoveNumber;
  for (const [index, step] of steps.entries()) {
    let row = rows.at(-1);
    if (row === undefined || row.moveNumber !== moveNumber) {
      row = { moveNumber };
      rows.push(row);
    }
    const move = {
      notation: localizeSan(step.move.san, locale),
      ply: index + 1,
    };
    rows[rows.length - 1] =
      side === 'white' ? { ...row, white: move } : { ...row, black: move };
    if (side === 'black') moveNumber += 1;
    side = side === 'white' ? 'black' : 'white';
  }
  return Object.freeze(rows);
}
