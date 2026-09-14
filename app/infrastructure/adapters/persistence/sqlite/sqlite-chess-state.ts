import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

import {
  createChessState,
  createPosition,
  type ChessState,
  type HistoryKnowledge,
  type Position,
} from '../../../../domain/chess_graph/index.ts';
import { localId, type PositionId } from '../../../../domain/identity/index.ts';
import { SqlitePersistenceProblem } from './sqlite-persistence-problem.ts';

interface PositionRow {
  readonly positionId: number;
  readonly boardKey: string;
  readonly sideToMove: 'white' | 'black';
  readonly whiteKingSide: number;
  readonly whiteQueenSide: number;
  readonly blackKingSide: number;
  readonly blackQueenSide: number;
  readonly effectiveEnPassantSquare: number;
}

export function ensurePosition(
  database: Database.Database,
  position: Position,
): PositionId {
  const values = positionValues(position);
  database
    .prepare(
      `INSERT OR IGNORE INTO chess_position
         (rule_set_id, board_key, side_to_move,
          white_king_side, white_queen_side,
          black_king_side, black_queen_side,
          effective_en_passant_square, position_hash)
       VALUES ('standardChess', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(...values, positionHash(position));
  const row = database
    .prepare(
      `SELECT position_id AS positionId
         FROM chess_position
        WHERE rule_set_id = 'standardChess'
          AND board_key = ? AND side_to_move = ?
          AND white_king_side = ? AND white_queen_side = ?
          AND black_king_side = ? AND black_queen_side = ?
          AND effective_en_passant_square = ?`,
    )
    .get(...values) as { positionId: number } | undefined;
  if (row === undefined) {
    throw new SqlitePersistenceProblem('persistence.unavailable');
  }
  return localId('position', row.positionId);
}

export function readChessState(
  database: Database.Database,
  positionId: PositionId,
  playState: {
    readonly halfmoveClock: number;
    readonly fullmoveNumber: number;
    readonly historyKnowledge: HistoryKnowledge;
  },
): ChessState {
  const row = database
    .prepare(
      `SELECT position_id AS positionId,
              board_key AS boardKey,
              side_to_move AS sideToMove,
              white_king_side AS whiteKingSide,
              white_queen_side AS whiteQueenSide,
              black_king_side AS blackKingSide,
              black_queen_side AS blackQueenSide,
              effective_en_passant_square AS effectiveEnPassantSquare
         FROM chess_position
        WHERE position_id = ?`,
    )
    .get(positionId.value) as PositionRow | undefined;
  if (row === undefined) {
    throw new SqlitePersistenceProblem('persistence.incompatible_store');
  }
  const position = createPosition({
    ruleSetId: 'standardChess',
    boardKey: row.boardKey,
    sideToMove: row.sideToMove,
    castlingRights: {
      whiteKingSide: row.whiteKingSide === 1,
      whiteQueenSide: row.whiteQueenSide === 1,
      blackKingSide: row.blackKingSide === 1,
      blackQueenSide: row.blackQueenSide === 1,
    },
    effectiveEnPassantSquare: row.effectiveEnPassantSquare,
  });
  return createChessState({
    position,
    ...playState,
    fen: fen(position, playState.halfmoveClock, playState.fullmoveNumber),
  });
}

function positionValues(
  position: Position,
): readonly [string, string, number, number, number, number, number] {
  return [
    position.boardKey,
    position.sideToMove,
    Number(position.castlingRights.whiteKingSide),
    Number(position.castlingRights.whiteQueenSide),
    Number(position.castlingRights.blackKingSide),
    Number(position.castlingRights.blackQueenSide),
    position.effectiveEnPassantSquare,
  ];
}

function positionHash(position: Position): Buffer {
  return createHash('sha256').update(position.positionKey, 'utf8').digest();
}

function fen(
  position: Position,
  halfmoveClock: number,
  fullmoveNumber: number,
): string {
  const ranks: string[] = [];
  for (let rank = 8; rank >= 1; rank -= 1) {
    let encoded = '';
    let empty = 0;
    for (let file = 0; file < 8; file += 1) {
      const piece = position.boardKey[(rank - 1) * 8 + file];
      if (piece === '.') {
        empty += 1;
      } else {
        if (empty > 0) encoded += String(empty);
        encoded += piece;
        empty = 0;
      }
    }
    if (empty > 0) encoded += String(empty);
    ranks.push(encoded);
  }
  const castling = [
    position.castlingRights.whiteKingSide ? 'K' : '',
    position.castlingRights.whiteQueenSide ? 'Q' : '',
    position.castlingRights.blackKingSide ? 'k' : '',
    position.castlingRights.blackQueenSide ? 'q' : '',
  ].join('');
  return [
    ranks.join('/'),
    position.sideToMove === 'white' ? 'w' : 'b',
    castling || '-',
    squareName(position.effectiveEnPassantSquare),
    halfmoveClock,
    fullmoveNumber,
  ].join(' ');
}

function squareName(index: number): string {
  if (index === -1) return '-';
  const file = 'abcdefgh'[index % 8];
  const rank = Math.floor(index / 8) + 1;
  if (file === undefined) {
    throw new SqlitePersistenceProblem('persistence.incompatible_store');
  }
  return `${file}${rank}`;
}
