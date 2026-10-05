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

export interface PositionRow {
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
  return prepareEnsurePosition(database)(position);
}

export function prepareEnsurePosition(
  database: Database.Database,
): (position: Position) => PositionId {
  const insert = database.prepare(
    `INSERT OR IGNORE INTO chess_position
         (rule_set_id, board_key, side_to_move,
          white_king_side, white_queen_side,
          black_king_side, black_queen_side,
          effective_en_passant_square, position_hash)
       VALUES ('standardChess', ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const select = database.prepare(
    `SELECT position_id AS positionId
         FROM chess_position
        WHERE rule_set_id = 'standardChess'
          AND board_key = ? AND side_to_move = ?
          AND white_king_side = ? AND white_queen_side = ?
          AND black_king_side = ? AND black_queen_side = ?
          AND effective_en_passant_square = ?`,
  );
  return (position) => {
    const values = positionValues(position);
    insert.run(...values, positionHash(position));
    const row = select.get(...values) as { positionId: number } | undefined;
    if (row === undefined) {
      throw new SqlitePersistenceProblem('persistence.unavailable');
    }
    return localId('position', row.positionId);
  };
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
  return chessStateFromPositionRow(row, playState);
}

export function chessStateFromPositionRow(
  row: PositionRow,
  playState: {
    readonly halfmoveClock: number;
    readonly fullmoveNumber: number;
    readonly historyKnowledge: HistoryKnowledge;
  },
): ChessState {
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

export function deleteUnreferencedPositions(
  database: Database.Database,
  positionIds: readonly number[],
): void {
  const remove = database.prepare(
    `DELETE FROM chess_position
      WHERE position_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM chess_occurrence_snapshot
           WHERE position_id = chess_position.position_id)
        AND NOT EXISTS (
          SELECT 1 FROM chess_anchor
           WHERE position_id = chess_position.position_id)
        AND NOT EXISTS (
          SELECT 1 FROM analysis_scratch_draft
           WHERE root_position_id = chess_position.position_id)
        AND NOT EXISTS (
          SELECT 1 FROM analysis_scratch_step
           WHERE before_position_id = chess_position.position_id
              OR after_position_id = chess_position.position_id)
        AND NOT EXISTS (
          SELECT 1 FROM workspace_analysis_resume
           WHERE current_position_id = chess_position.position_id)
        AND NOT EXISTS (
          SELECT 1 FROM playout_draft
           WHERE root_position_id = chess_position.position_id
              OR source_root_position_id = chess_position.position_id)
        AND NOT EXISTS (
          SELECT 1 FROM playout_source_ply
           WHERE before_position_id = chess_position.position_id
              OR after_position_id = chess_position.position_id)
        AND NOT EXISTS (
          SELECT 1 FROM inventory_game_source_path
           WHERE root_position_id = chess_position.position_id)
        AND NOT EXISTS (
          SELECT 1 FROM inventory_game_source_ply
           WHERE before_position_id = chess_position.position_id
              OR after_position_id = chess_position.position_id)
        AND NOT EXISTS (
          SELECT 1 FROM playout_ply
           WHERE before_position_id = chess_position.position_id
              OR after_position_id = chess_position.position_id)`,
  );
  for (const positionId of new Set(positionIds)) remove.run(positionId);
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
