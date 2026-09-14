import type { AnalysisWorkspaceDto } from '../../host_client/index.ts';
import type { UiLocale } from './messages.ts';

export type ChessStateDto = AnalysisWorkspaceDto['currentState'];
export type CanonicalMoveDto = AnalysisWorkspaceDto['legalMoves'][number];
export type PieceColour = 'white' | 'black';
export type PieceKind =
  'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';

export interface BoardPiece {
  readonly colour: PieceColour;
  readonly kind: PieceKind;
  readonly symbol: string;
}

const pieces: Readonly<Record<string, BoardPiece>> = Object.freeze({
  K: Object.freeze({ colour: 'white', kind: 'king', symbol: '♔' }),
  Q: Object.freeze({ colour: 'white', kind: 'queen', symbol: '♕' }),
  R: Object.freeze({ colour: 'white', kind: 'rook', symbol: '♖' }),
  B: Object.freeze({ colour: 'white', kind: 'bishop', symbol: '♗' }),
  N: Object.freeze({ colour: 'white', kind: 'knight', symbol: '♘' }),
  P: Object.freeze({ colour: 'white', kind: 'pawn', symbol: '♙' }),
  k: Object.freeze({ colour: 'black', kind: 'king', symbol: '♚' }),
  q: Object.freeze({ colour: 'black', kind: 'queen', symbol: '♛' }),
  r: Object.freeze({ colour: 'black', kind: 'rook', symbol: '♜' }),
  b: Object.freeze({ colour: 'black', kind: 'bishop', symbol: '♝' }),
  n: Object.freeze({ colour: 'black', kind: 'knight', symbol: '♞' }),
  p: Object.freeze({ colour: 'black', kind: 'pawn', symbol: '♟' }),
});

const germanSanPieces: Readonly<Record<string, string>> = Object.freeze({
  K: 'K',
  Q: 'D',
  R: 'T',
  B: 'L',
  N: 'S',
});

export function parseFenBoard(fen: string): ReadonlyMap<string, BoardPiece> {
  const placement = fen.split(' ')[0];
  if (placement === undefined) return new Map();
  const board = new Map<string, BoardPiece>();
  const ranks = placement.split('/');
  for (const [rankIndex, encodedRank] of ranks.entries()) {
    let fileIndex = 0;
    for (const token of encodedRank) {
      const empty = Number(token);
      if (Number.isInteger(empty) && empty > 0) {
        fileIndex += empty;
        continue;
      }
      const piece = pieces[token];
      if (piece !== undefined && fileIndex < 8) {
        const square = `${String.fromCharCode(97 + fileIndex)}${8 - rankIndex}`;
        board.set(square, piece);
      }
      fileIndex += 1;
    }
  }
  return board;
}

export function localizeSan(san: string, locale: UiLocale): string {
  if (locale === 'en-GB') return san;
  return san
    .replace(/^([KQRBN])/, (piece) => germanSanPieces[piece] ?? piece)
    .replace(
      /=([QRBN])/,
      (_match, piece: string) => `=${germanSanPieces[piece] ?? piece}`,
    );
}

export function pieceName(piece: BoardPiece, locale: UiLocale): string {
  const names =
    locale === 'de-DE'
      ? {
          white: 'Weiß',
          black: 'Schwarz',
          king: 'König',
          queen: 'Dame',
          rook: 'Turm',
          bishop: 'Läufer',
          knight: 'Springer',
          pawn: 'Bauer',
        }
      : {
          white: 'White',
          black: 'Black',
          king: 'king',
          queen: 'queen',
          rook: 'rook',
          bishop: 'bishop',
          knight: 'knight',
          pawn: 'pawn',
        };
  return `${names[piece.colour]} ${names[piece.kind]}`;
}

export function sideName(side: PieceColour, locale: UiLocale): string {
  if (locale === 'de-DE') return side === 'white' ? 'Weiß' : 'Schwarz';
  return side === 'white' ? 'White' : 'Black';
}
