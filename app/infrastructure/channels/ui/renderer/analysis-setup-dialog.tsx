import { useState } from 'react';
import {
  ArrowRight,
  Check,
  Eraser,
  FileInput,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { Button, Dialog, Modal, ModalOverlay } from 'react-aria-components';
import { FormattedMessage, useIntl } from 'react-intl';

import type { ValidateAnalysisSetupResultDto } from '../../host_client/index.ts';
import {
  applySetupBoardPress,
  enPassantCandidates,
  withoutEnPassant,
  type PieceTool,
  type PositionSetup,
  type SetupPiece,
  type SetupTool,
} from './analysis-setup-presentation.ts';
import { pieceName, type BoardPiece } from './chess-display.ts';
import {
  ChessBoardOrientationButton,
  ChessPieceGlyph,
  ChessBoardSurface,
  chessBoardFiles,
  type ChessBoardOrientation,
} from './chess-board-surface.tsx';
import type { PlysmithApplicationStore } from './plysmith-application-store.ts';
import styles from './analysis-setup-dialog.module.css';

type SetupIssue = Extract<
  ValidateAnalysisSetupResultDto,
  { valid: false }
>['issues'][number];

const files = chessBoardFiles;
const roles = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'] as const;

export function AnalysisSetupDialog({
  isOpen,
  hasScratch,
  isBusy,
  store,
  onOpenChange,
}: {
  readonly isOpen: boolean;
  readonly hasScratch: boolean;
  readonly isBusy: boolean;
  readonly store: PlysmithApplicationStore;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const intl = useIntl();
  const [mode, setMode] = useState<'choose' | 'setup'>('choose');
  const [scratchDiscarded, setScratchDiscarded] = useState(false);
  const [setup, setSetup] = useState<PositionSetup>(() => initialSetup());
  const [tool, setTool] = useState<SetupTool>();
  const [moveSource, setMoveSource] = useState<string>();
  const [fen, setFen] = useState('');
  const [issues, setIssues] = useState<readonly SetupIssue[]>([]);
  const scratchNeedsDecision = hasScratch && !scratchDiscarded;
  const enPassantOptions = enPassantCandidates(setup);

  function close() {
    if (!isBusy) onOpenChange(false);
  }

  function updateSetup(next: PositionSetup) {
    const nextEnPassantOptions = enPassantCandidates(next);
    setSetup(
      next.enPassantSquare !== undefined &&
        !nextEnPassantOptions.includes(next.enPassantSquare)
        ? withoutEnPassant(next)
        : next,
    );
    setIssues([]);
  }

  function updateSquare(square: string) {
    const next = applySetupBoardPress({ setup, tool, moveSource }, square);
    if (next.setup !== setup) updateSetup(next.setup);
    setTool(next.tool);
    setMoveSource(next.moveSource);
  }

  async function importFen() {
    const result = await store.validateAnalysisSetup({
      input: { kind: 'fen', fen: fen.trim() },
    });
    if (result === undefined) return;
    if (!result.valid) {
      setIssues(result.issues);
      return;
    }
    setSetup(result.setup);
    setIssues([]);
    setTool(undefined);
    setMoveSource(undefined);
  }

  async function startSetup() {
    const result = await store.validateAnalysisSetup({
      input: { kind: 'position_setup', setup },
    });
    if (result === undefined) return;
    if (!result.valid) {
      setIssues(result.issues);
      return;
    }
    if (await store.startScratchAtSetup(result.setup)) onOpenChange(false);
  }

  return (
    <ModalOverlay
      className={styles.overlay!}
      isOpen={isOpen}
      isDismissable={!isBusy}
      onOpenChange={onOpenChange}
    >
      <Modal className={styles.modal!}>
        <Dialog className={styles.dialog!} aria-labelledby="new-analysis-title">
          <header className={styles.header}>
            <div>
              <span className={styles.eyebrow}>
                <FormattedMessage id="analysisSetup.eyebrow" />
              </span>
              <h2 id="new-analysis-title">
                <FormattedMessage id="analysisSetup.title" />
              </h2>
              <p>
                <FormattedMessage id="analysisSetup.intro" />
              </p>
            </div>
            <Button
              className={styles.closeButton!}
              aria-label={intl.formatMessage({ id: 'action.cancel' })}
              isDisabled={isBusy}
              onPress={close}
            >
              <X aria-hidden="true" size={20} />
            </Button>
          </header>

          {scratchNeedsDecision ? (
            <section className={styles.scratchDecision}>
              <div>
                <h3>
                  <FormattedMessage id="analysisSetup.existingDraft" />
                </h3>
                <p>
                  <FormattedMessage id="analysisSetup.existingDraftDetail" />
                </p>
              </div>
              <div className={styles.decisionActions}>
                <Button
                  className={styles.primaryButton!}
                  isDisabled={isBusy}
                  onPress={() => {
                    onOpenChange(false);
                    store.setActivity('analyze');
                  }}
                >
                  <ArrowRight aria-hidden="true" size={17} />
                  <FormattedMessage id="analysisSetup.continueDraft" />
                </Button>
                <Button
                  className={styles.dangerButton!}
                  isDisabled={isBusy}
                  onPress={async () => {
                    if (await store.discardAnalysisScratch()) {
                      setScratchDiscarded(true);
                    }
                  }}
                >
                  <Trash2 aria-hidden="true" size={17} />
                  <FormattedMessage id="analysisSetup.discardDraft" />
                </Button>
              </div>
            </section>
          ) : mode === 'choose' ? (
            <section className={styles.choices}>
              <Button
                className={styles.choiceButton!}
                isDisabled={isBusy}
                onPress={async () => {
                  if (await store.startScratchAtInitialPosition()) {
                    onOpenChange(false);
                  }
                }}
              >
                <RotateCcw aria-hidden="true" size={22} />
                <span>
                  <strong>
                    <FormattedMessage id="analysisSetup.fromInitial" />
                  </strong>
                  <small>
                    <FormattedMessage id="analysisSetup.fromInitialDetail" />
                  </small>
                </span>
                <ArrowRight aria-hidden="true" size={19} />
              </Button>
              <Button
                className={styles.choiceButton!}
                isDisabled={isBusy}
                onPress={() => setMode('setup')}
              >
                <ChessPieceGlyph
                  className={styles.boardChoiceIcon}
                  symbol="♔"
                />
                <span>
                  <strong>
                    <FormattedMessage id="analysisSetup.buildPosition" />
                  </strong>
                  <small>
                    <FormattedMessage id="analysisSetup.buildPositionDetail" />
                  </small>
                </span>
                <ArrowRight aria-hidden="true" size={19} />
              </Button>
            </section>
          ) : (
            <div className={styles.builder}>
              <section className={styles.boardColumn}>
                <SetupBoard
                  pieces={setup.pieces}
                  sideToMove={setup.sideToMove}
                  isBusy={isBusy}
                  tool={tool}
                  {...(moveSource === undefined
                    ? {}
                    : { selectedSquare: moveSource })}
                  onToolChange={(next) => {
                    setMoveSource(undefined);
                    setTool(next);
                  }}
                  onSquarePress={updateSquare}
                  onEscape={() => {
                    const handled =
                      moveSource !== undefined || tool !== undefined;
                    setMoveSource(undefined);
                    setTool(undefined);
                    return handled;
                  }}
                />
              </section>

              <section className={styles.controls}>
                <div className={styles.positionControls}>
                  <label>
                    <span>
                      <FormattedMessage id="analysisSetup.sideToMove" />
                    </span>
                    <select
                      value={setup.sideToMove}
                      disabled={isBusy}
                      onChange={(event) =>
                        updateSetup({
                          ...setup,
                          sideToMove: event.target.value as 'white' | 'black',
                        })
                      }
                    >
                      <option value="white">
                        {intl.formatMessage({ id: 'analysisSetup.white' })}
                      </option>
                      <option value="black">
                        {intl.formatMessage({ id: 'analysisSetup.black' })}
                      </option>
                    </select>
                  </label>
                  <label>
                    <span>
                      <FormattedMessage id="analysisSetup.enPassant" />
                    </span>
                    <select
                      value={setup.enPassantSquare ?? ''}
                      disabled={isBusy}
                      onChange={(event) =>
                        updateSetup(
                          event.target.value.length === 0
                            ? withoutEnPassant(setup)
                            : {
                                ...setup,
                                enPassantSquare: event.target.value,
                              },
                        )
                      }
                    >
                      <option value="">
                        {intl.formatMessage({
                          id: 'analysisSetup.enPassantNone',
                        })}
                      </option>
                      {enPassantOptions.map((square) => (
                        <option value={square} key={square}>
                          {intl.formatMessage(
                            { id: 'analysisSetup.enPassantCapture' },
                            {
                              side: intl.formatMessage({
                                id: `analysisSetup.${setup.sideToMove}`,
                              }),
                              square,
                            },
                          )}
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset>
                    <legend>
                      <FormattedMessage id="analysisSetup.castling" />
                    </legend>
                    {(
                      [
                        ['whiteKingSide', 'analysisSetup.whiteKingSide'],
                        ['whiteQueenSide', 'analysisSetup.whiteQueenSide'],
                        ['blackKingSide', 'analysisSetup.blackKingSide'],
                        ['blackQueenSide', 'analysisSetup.blackQueenSide'],
                      ] as const
                    ).map(([right, label]) => (
                      <label key={right} className={styles.checkboxLabel}>
                        <input
                          type="checkbox"
                          checked={setup.castlingRights[right]}
                          disabled={isBusy}
                          onChange={(event) =>
                            updateSetup({
                              ...setup,
                              castlingRights: {
                                ...setup.castlingRights,
                                [right]: event.target.checked,
                              },
                            })
                          }
                        />
                        <FormattedMessage id={label} />
                      </label>
                    ))}
                  </fieldset>
                </div>

                <div className={styles.boardActions}>
                  <Button
                    className={styles.secondaryButton!}
                    isDisabled={isBusy}
                    onPress={() => {
                      updateSetup(initialSetup());
                      setMoveSource(undefined);
                    }}
                  >
                    <RotateCcw aria-hidden="true" size={15} />
                    <FormattedMessage id="analysisSetup.initialPosition" />
                  </Button>
                  <Button
                    className={styles.secondaryButton!}
                    isDisabled={isBusy}
                    onPress={() => {
                      updateSetup({ ...setup, pieces: [] });
                      setMoveSource(undefined);
                    }}
                  >
                    <Trash2 aria-hidden="true" size={15} />
                    <FormattedMessage id="analysisSetup.clearBoard" />
                  </Button>
                </div>

                <details className={styles.advanced}>
                  <summary>
                    <FormattedMessage id="analysisSetup.advanced" />
                  </summary>
                  <div className={styles.advancedBody}>
                    <label className={styles.fenField}>
                      <span>FEN</span>
                      <div>
                        <input
                          value={fen}
                          disabled={isBusy}
                          onChange={(event) => {
                            setFen(event.target.value);
                            setIssues([]);
                          }}
                          placeholder={intl.formatMessage({
                            id: 'analysis.fenPlaceholder',
                          })}
                        />
                        <Button
                          className={styles.iconButton!}
                          aria-label={intl.formatMessage({
                            id: 'analysisSetup.importFen',
                          })}
                          isDisabled={isBusy || fen.trim().length === 0}
                          onPress={() => void importFen()}
                        >
                          <FileInput aria-hidden="true" size={17} />
                        </Button>
                      </div>
                    </label>
                    <div className={styles.numberFields}>
                      <label>
                        <span>
                          <FormattedMessage id="analysisSetup.halfmove" />
                        </span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={setup.halfmoveClock}
                          disabled={isBusy}
                          onChange={(event) =>
                            updateSetup({
                              ...setup,
                              halfmoveClock: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>
                          <FormattedMessage id="analysisSetup.fullmove" />
                        </span>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={setup.fullmoveNumber}
                          disabled={isBusy}
                          onChange={(event) =>
                            updateSetup({
                              ...setup,
                              fullmoveNumber: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                  </div>
                </details>

                <div className={styles.validation} aria-live="polite">
                  {issues.length > 0 && (
                    <>
                      <strong>
                        <FormattedMessage id="analysisSetup.invalid" />
                      </strong>
                      <ul>
                        {issues.map((issue, index) => (
                          <li
                            key={`${issue.code}-${issue.square ?? ''}-${index}`}
                          >
                            <FormattedMessage
                              id={`analysisSetup.issue.${issue.code}`}
                              values={{ square: issue.square ?? '' }}
                            />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>

                <footer className={styles.footer}>
                  <Button
                    className={styles.secondaryButton!}
                    isDisabled={isBusy}
                    onPress={() => setMode('choose')}
                  >
                    <FormattedMessage id="action.cancel" />
                  </Button>
                  <Button
                    className={styles.primaryButton!}
                    isDisabled={isBusy}
                    onPress={() => void startSetup()}
                  >
                    <Check aria-hidden="true" size={17} />
                    <FormattedMessage id="analysisSetup.start" />
                  </Button>
                </footer>
              </section>
            </div>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function SetupBoard({
  pieces,
  sideToMove,
  isBusy,
  tool,
  selectedSquare,
  onToolChange,
  onSquarePress,
  onEscape,
}: {
  readonly pieces: readonly SetupPiece[];
  readonly sideToMove: PositionSetup['sideToMove'];
  readonly isBusy: boolean;
  readonly tool: SetupTool | undefined;
  readonly selectedSquare?: string;
  readonly onToolChange: (tool: SetupTool | undefined) => void;
  readonly onSquarePress: (square: string) => void;
  readonly onEscape: () => boolean;
}) {
  const intl = useIntl();
  const [orientation, setOrientation] =
    useState<ChessBoardOrientation>('white');
  const boardPieces = new Map(
    pieces.map((piece) => [
      piece.square,
      {
        symbol: pieceSymbol(piece),
        accessibleName: setupPieceName(piece, intl.locale),
      },
    ]),
  );
  const topColor = orientation === 'white' ? 'black' : 'white';
  const bottomColor = orientation === 'white' ? 'white' : 'black';
  return (
    <div className={styles.setupBoardFrame}>
      <div className={styles.setupBoardHeading}>
        <h3>
          <FormattedMessage id="analysis.board" />
        </h3>
        <div className={styles.setupBoardStatus}>
          <span>
            <FormattedMessage
              id="analysis.sideToMove"
              values={{
                side: intl.formatMessage({
                  id: `analysisSetup.${sideToMove}`,
                }),
              }}
            />
          </span>
          <ChessBoardOrientationButton
            isDisabled={isBusy}
            label={intl.formatMessage({ id: 'board.flip' })}
            onToggle={() =>
              setOrientation((current) =>
                current === 'white' ? 'black' : 'white',
              )
            }
          />
        </div>
      </div>
      <SetupPieceRail
        color={topColor}
        isBusy={isBusy}
        tool={tool}
        onToolChange={onToolChange}
      />
      <ChessBoardSurface
        className={styles.boardSize!}
        pieces={boardPieces}
        emptySquareName={intl.formatMessage({ id: 'analysis.emptySquare' })}
        ariaLabel={intl.formatMessage({ id: 'analysisSetup.board' })}
        ariaReadOnly={isBusy}
        isInteractive={!isBusy}
        orientation={orientation}
        {...(selectedSquare === undefined ? {} : { selectedSquare })}
        getSquareClassName={(square) =>
          `${isBusy ? '' : styles.editableSquare!} ${selectedSquare === square ? styles.selectedSquare : ''}`
        }
        onSquarePress={onSquarePress}
        onEscape={onEscape}
      />
      <SetupPieceRail
        color={bottomColor}
        isBusy={isBusy}
        tool={tool}
        onToolChange={onToolChange}
      />
    </div>
  );
}

function SetupPieceRail({
  color,
  isBusy,
  tool,
  onToolChange,
}: {
  readonly color: PieceTool['color'];
  readonly isBusy: boolean;
  readonly tool: SetupTool | undefined;
  readonly onToolChange: (tool: SetupTool | undefined) => void;
}) {
  const intl = useIntl();
  return (
    <div className={styles.pieceRail}>
      <span>
        <FormattedMessage id={`analysisSetup.${color}`} />
      </span>
      <div className={styles.pieceRailButtons}>
        {roles.map((role) => {
          const piece = { color, role } as const;
          const selected =
            tool !== undefined &&
            tool !== 'erase' &&
            tool.color === color &&
            tool.role === role;
          return (
            <Button
              key={role}
              className={`${styles.pieceButton!} ${selected ? styles.selectedTool : ''}`}
              aria-label={setupPieceName(piece, intl.locale)}
              aria-pressed={selected}
              isDisabled={isBusy}
              onPress={() => onToolChange(selected ? undefined : piece)}
            >
              <ChessPieceGlyph
                className={styles.pieceChoiceGlyph}
                symbol={pieceSymbol(piece)}
              />
            </Button>
          );
        })}
        <Button
          className={`${styles.pieceButton!} ${styles.eraseTool!} ${tool === 'erase' ? styles.selectedTool : ''}`}
          aria-label={intl.formatMessage({ id: 'analysisSetup.removePiece' })}
          aria-pressed={tool === 'erase'}
          isDisabled={isBusy}
          onPress={() => onToolChange(tool === 'erase' ? undefined : 'erase')}
        >
          <Eraser aria-hidden="true" size={18} />
        </Button>
      </div>
    </div>
  );
}

function initialSetup(): PositionSetup {
  const backRank = [
    'rook',
    'knight',
    'bishop',
    'queen',
    'king',
    'bishop',
    'knight',
    'rook',
  ] as const;
  const pieces: SetupPiece[] = [];
  for (const [index, file] of files.entries()) {
    const role = backRank[index]!;
    pieces.push({ square: `${file}1`, color: 'white', role });
    pieces.push({ square: `${file}2`, color: 'white', role: 'pawn' });
    pieces.push({ square: `${file}7`, color: 'black', role: 'pawn' });
    pieces.push({ square: `${file}8`, color: 'black', role });
  }
  return {
    pieces,
    sideToMove: 'white',
    castlingRights: {
      whiteKingSide: true,
      whiteQueenSide: true,
      blackKingSide: true,
      blackQueenSide: true,
    },
    halfmoveClock: 0,
    fullmoveNumber: 1,
  };
}

function pieceSymbol(piece: PieceTool): string {
  const symbols = {
    white: {
      king: '♔',
      queen: '♕',
      rook: '♖',
      bishop: '♗',
      knight: '♘',
      pawn: '♙',
    },
    black: {
      king: '♚',
      queen: '♛',
      rook: '♜',
      bishop: '♝',
      knight: '♞',
      pawn: '♟',
    },
  } as const;
  return symbols[piece.color][piece.role];
}

function setupPieceName(piece: PieceTool, locale: string): string {
  const displayPiece: BoardPiece = {
    colour: piece.color,
    kind: piece.role,
    symbol: pieceSymbol(piece),
  };
  return pieceName(displayPiece, locale === 'en-GB' ? 'en-GB' : 'de-DE');
}
