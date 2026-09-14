import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CornerDownLeft,
  FilePlus2,
  GitBranch,
  MessageSquarePlus,
  Pencil,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { Button, Radio, RadioGroup } from 'react-aria-components';
import { FormattedDate, FormattedMessage, useIntl } from 'react-intl';

import { ChessBoard } from './chess-board.tsx';
import { localizeSan } from './chess-display.ts';
import {
  analysisMoveRows,
  analysisNoteMoveRows,
  analysisPathPresentation,
  type AnalysisNoteTarget,
  type AnalysisPathEntry,
  type PathContribution,
} from './analysis-path-presentation.ts';
import {
  type PlysmithApplicationState,
  type PlysmithApplicationStore,
} from './plysmith-application-store.ts';
import styles from './analysis-view.module.css';

type ReadyState = Extract<PlysmithApplicationState, { phase: 'ready' }>;
type NoteEditor =
  | {
      readonly kind: 'create';
      readonly targetKey: string;
      readonly body: string;
      readonly noteScope: 'global' | 'context';
    }
  | {
      readonly kind: 'edit';
      readonly targetKey: string;
      readonly contributionId: string;
      readonly contributionVersion: number;
      readonly body: string;
    }
  | {
      readonly kind: 'delete';
      readonly targetKey: string;
      readonly contributionId: string;
      readonly contributionVersion: number;
    };

export function AnalysisView({
  state,
  store,
}: {
  readonly state: ReadyState;
  readonly store: PlysmithApplicationStore;
}) {
  const intl = useIntl();
  const scratch = state.analysis.scratch;
  const record = state.analysis.record;
  const path = analysisPathPresentation(state.analysis);
  const line = path.entries;
  const sourceEntries = line.filter((entry) => entry.kind === 'source');
  const storedEntries = line.filter((entry) => entry.kind === 'stored');
  const scratchEntries = line.filter((entry) => entry.kind === 'scratch');
  const pathNoteOrigin =
    scratch?.origin.kind === 'inventory_anchor' ? scratch.origin : undefined;
  const pathNoteTarget =
    pathNoteOrigin !== undefined
      ? [
          path.sourceRootTarget,
          path.recordRootTarget,
          ...line.map((entry) => entry.noteTarget),
        ].find(
          (target) =>
            target !== undefined &&
            target.itemId === pathNoteOrigin.itemId &&
            target.revisionId === pathNoteOrigin.revisionId &&
            target.anchorId === pathNoteOrigin.anchorId,
        )
      : undefined;
  const pathNoteDraft =
    pathNoteTarget === undefined ? undefined : scratch?.noteDraft;
  const visibleScratchEntries =
    pathNoteDraft === undefined ? scratchEntries : [];
  const isBusy = state.busyCommand !== undefined || state.refreshing;
  const canChangeNotes = record?.readOnlyPreview !== true;
  const lineStartNoteTarget = path.hasSourcePrefix
    ? path.sourceRootTarget
    : path.recordRootTarget;
  const [moveInput, setMoveInput] = useState('');
  const [fen, setFen] = useState('');
  const [noteBody, setNoteBody] = useState(scratch?.noteDraft?.body ?? '');
  const [noteEditor, setNoteEditor] = useState<NoteEditor>();
  const [recordTitle, setRecordTitle] = useState('');
  const [recordNoteBody, setRecordNoteBody] = useState('');
  const [destination, setDestination] = useState<'inventory' | 'context'>(
    state.scope.kind === 'context' ? 'context' : 'inventory',
  );
  const [pathNoteScope, setPathNoteScope] = useState<'global' | 'context'>(
    state.scope.kind === 'context' ? 'context' : 'global',
  );
  const [recordNoteScope, setRecordNoteScope] = useState<'global' | 'context'>(
    state.scope.kind === 'context' ? 'context' : 'global',
  );
  const [selectedPositionIndex, setSelectedPositionIndex] = useState(
    path.currentPositionIndex,
  );
  const moveListRef = useRef<HTMLOListElement>(null);
  const activePositionIndex = Math.max(
    0,
    Math.min(selectedPositionIndex, Math.max(0, path.positions.length - 1)),
  );
  const activePosition = path.positions[activePositionIndex];
  const navigationLocked =
    isBusy || pathNoteDraft !== undefined || noteEditor !== undefined;
  const atWorkspacePosition = activePositionIndex === path.currentPositionIndex;
  const displayedAnalysis =
    activePosition === undefined || atWorkspacePosition
      ? state.analysis
      : {
          ...state.analysis,
          currentState: activePosition.state,
          legalMoves: [],
          allowedActions: state.analysis.allowedActions.filter(
            (action) => action !== 'apply_move',
          ),
        };

  useEffect(() => {
    setNoteBody(scratch?.noteDraft?.body ?? '');
  }, [scratch?.scratchId, scratch?.noteDraft?.body]);

  useEffect(() => {
    setDestination(state.scope.kind === 'context' ? 'context' : 'inventory');
    setPathNoteScope(state.scope.kind === 'context' ? 'context' : 'global');
    setRecordNoteScope(state.scope.kind === 'context' ? 'context' : 'global');
    setNoteEditor(undefined);
  }, [state.scope]);

  useEffect(() => {
    setSelectedPositionIndex(path.currentPositionIndex);
  }, [
    path.currentPositionIndex,
    record?.currentAnchorId,
    record?.itemId,
    record?.revisionId,
    scratch?.scratchId,
    scratch?.scratchRevision,
  ]);

  useEffect(() => {
    const moveList = moveListRef.current;
    if (moveList === null) return;
    if (activePositionIndex === 0) {
      moveList.scrollTop = 0;
      return;
    }
    moveList
      .querySelector<HTMLElement>('[aria-current="step"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [activePositionIndex]);

  function selectPathPosition(positionIndex: number) {
    const boundedIndex = Math.max(
      0,
      Math.min(positionIndex, path.positions.length - 1),
    );
    const position = path.positions[boundedIndex];
    if (position === undefined) return;
    if (
      scratch !== undefined &&
      position.scratchCursor !== undefined &&
      position.scratchCursor !== scratch.cursor
    ) {
      void store.moveAnalysisCursor(position.scratchCursor);
      return;
    }
    setSelectedPositionIndex(boundedIndex);
  }

  async function submitMove(event: FormEvent) {
    event.preventDefault();
    if (!atWorkspacePosition || moveInput.trim() === '') return;
    await store.applyMove(moveInput);
    setMoveInput('');
  }

  async function startFromFen(event: FormEvent) {
    event.preventDefault();
    if (fen.trim() === '') return;
    await store.startScratchAtFen(fen);
  }

  async function saveRecord(event: FormEvent) {
    event.preventDefault();
    if (
      await store.createAnalysisRecord(
        recordTitle,
        destination,
        recordNoteScope,
        recordNoteBody,
      )
    ) {
      setRecordTitle('');
      setRecordNoteBody('');
    }
  }

  async function submitInlineNote(
    event: FormEvent,
    target: AnalysisNoteTarget,
  ) {
    event.preventDefault();
    if (noteEditor?.kind === 'create') {
      if (
        await store.createPositionNote(
          target,
          noteEditor.body,
          noteEditor.noteScope,
        )
      ) {
        setNoteEditor(undefined);
      }
      return;
    }
    if (
      noteEditor?.kind === 'edit' &&
      (await store.updateAnalysisNote(
        noteEditor.contributionId,
        noteEditor.contributionVersion,
        noteEditor.body,
      ))
    ) {
      setNoteEditor(undefined);
    }
  }

  async function confirmDeleteNote() {
    if (noteEditor?.kind !== 'delete') return;
    if (
      await store.deleteAnalysisNote(
        noteEditor.contributionId,
        noteEditor.contributionVersion,
      )
    ) {
      setNoteEditor(undefined);
    }
  }

  function startCreateNote(target: AnalysisNoteTarget) {
    setNoteEditor({
      kind: 'create',
      targetKey: targetKey(target),
      body: '',
      noteScope: canUseContextScope(target) ? 'context' : 'global',
    });
  }

  function startEditNote(
    target: AnalysisNoteTarget,
    contribution: PathContribution,
  ) {
    setNoteEditor({
      kind: 'edit',
      targetKey: targetKey(target),
      contributionId: contribution.contributionId,
      contributionVersion: contribution.contributionVersion,
      body: contribution.body,
    });
  }

  function startDeleteNote(
    target: AnalysisNoteTarget,
    contribution: PathContribution,
  ) {
    setNoteEditor({
      kind: 'delete',
      targetKey: targetKey(target),
      contributionId: contribution.contributionId,
      contributionVersion: contribution.contributionVersion,
    });
  }

  function canUseContextScope(target: AnalysisNoteTarget) {
    return (
      state.scope.kind === 'context' &&
      record?.contextMember === true &&
      target.itemId === record.itemId
    );
  }

  function hasInlineContent(target: AnalysisNoteTarget | undefined) {
    return (
      target !== undefined &&
      (target.contributions.length > 0 ||
        noteEditor?.targetKey === targetKey(target) ||
        (pathNoteDraft !== undefined && target === pathNoteTarget))
    );
  }

  function renderMoveRows(
    entries: readonly AnalysisPathEntry[],
    section: string,
  ): ReactNode[] {
    return analysisMoveRows(entries).flatMap((row, index) => {
      const key = `${section}-${row.fullmoveNumber}-${index}`;
      const splitAfterWhite = hasInlineContent(row.white?.noteTarget);
      return [
        <li className={styles.moveRow} key={`${key}-moves`}>
          <span className={styles.moveNumber}>{row.fullmoveNumber}.</span>
          {renderMove(row.white, 'white')}
          {splitAfterWhite ? renderEmptyMove() : renderMove(row.black, 'black')}
        </li>,
        renderInlineNotes(row.white?.noteTarget, `${key}-white-notes`),
        splitAfterWhite && row.black !== undefined ? (
          <li className={styles.moveRow} key={`${key}-black`}>
            <span className={styles.moveNumber}>{row.fullmoveNumber}...</span>
            {renderEmptyMove()}
            {renderMove(row.black, 'black')}
          </li>
        ) : null,
        renderInlineNotes(row.black?.noteTarget, `${key}-black-notes`),
      ].filter((entry): entry is ReactNode => entry !== null);
    });
  }

  function renderEmptyMove() {
    return <span className={styles.emptyMove} aria-hidden="true" />;
  }

  function renderMove(
    entry: AnalysisPathEntry | undefined,
    side: 'white' | 'black',
  ) {
    if (entry === undefined) return renderEmptyMove();
    const storedContext = scratch !== undefined && entry.kind !== 'scratch';
    const selected =
      entry.positionIndex === activePositionIndex &&
      entry.positionIndex !== path.analysisOriginPositionIndex;
    const localizedMove = localizeSan(
      entry.move.san,
      state.preferences.uiLocale,
    );
    return (
      <div className={styles.moveCell}>
        <Button
          className={`${styles.moveButton!} ${selected ? styles.currentMove : ''} ${storedContext ? styles.storedMove : ''}`}
          data-path-position={entry.positionIndex}
          {...(selected ? { 'aria-current': 'step' as const } : {})}
          aria-label={intl.formatMessage(
            { id: 'analysis.moveAt' },
            {
              number: entry.before.playState.fullmoveNumber,
              side,
              move: localizedMove,
            },
          )}
          onPress={() => selectPathPosition(entry.positionIndex)}
          isDisabled={navigationLocked}
        >
          {localizedMove}
        </Button>
        {entry.noteTarget !== undefined &&
          canChangeNotes &&
          pathNoteDraft === undefined && (
            <Button
              className={styles.addNoteButton!}
              aria-label={intl.formatMessage({ id: 'analysis.addNote' })}
              onPress={() => startCreateNote(entry.noteTarget!)}
              isDisabled={isBusy}
            >
              <MessageSquarePlus aria-hidden="true" size={14} />
            </Button>
          )}
      </div>
    );
  }

  function renderInlineNotes(
    target: AnalysisNoteTarget | undefined,
    key: string,
  ): ReactNode {
    if (target === undefined || !hasInlineContent(target)) return null;
    const activeEditor =
      noteEditor?.targetKey === targetKey(target) ? noteEditor : undefined;
    return (
      <li className={styles.inlineNotes} key={key}>
        {target.contributions.map((contribution) => {
          const editing =
            activeEditor?.kind === 'edit' &&
            activeEditor.contributionId === contribution.contributionId;
          const deleting =
            activeEditor?.kind === 'delete' &&
            activeEditor.contributionId === contribution.contributionId;
          return (
            <article
              className={styles.inlineNote}
              key={contribution.contributionId}
            >
              <div className={styles.noteMeta}>
                <span>
                  <FormattedMessage
                    id={
                      contribution.scopeKind === 'context'
                        ? 'analysis.contextNote'
                        : 'analysis.generalNote'
                    }
                  />
                </span>
                <time dateTime={contribution.updatedAt}>
                  <FormattedDate value={contribution.updatedAt} />
                </time>
                {canChangeNotes && !editing && !deleting && (
                  <span className={styles.noteActions}>
                    <Button
                      className={styles.noteIconButton!}
                      aria-label={intl.formatMessage({
                        id: 'analysis.editNote',
                      })}
                      onPress={() => startEditNote(target, contribution)}
                      isDisabled={isBusy}
                    >
                      <Pencil aria-hidden="true" size={13} />
                    </Button>
                    <Button
                      className={styles.noteIconButton!}
                      aria-label={intl.formatMessage({
                        id: 'analysis.deleteNote',
                      })}
                      onPress={() => startDeleteNote(target, contribution)}
                      isDisabled={isBusy}
                    >
                      <Trash2 aria-hidden="true" size={13} />
                    </Button>
                  </span>
                )}
              </div>
              {editing ? (
                renderNoteForm(target, activeEditor)
              ) : (
                <>
                  <p>{contribution.body}</p>
                  {contribution.moves.length > 0 &&
                    renderNotePath(target, contribution.moves)}
                </>
              )}
              {deleting && (
                <div className={styles.deleteConfirmation}>
                  <span>
                    <FormattedMessage id="analysis.confirmDeleteNote" />
                  </span>
                  <Button
                    className={styles.deleteNoteButton!}
                    onPress={() => void confirmDeleteNote()}
                    isDisabled={isBusy}
                  >
                    <Trash2 aria-hidden="true" size={13} />
                    <FormattedMessage id="analysis.delete" />
                  </Button>
                  <Button
                    className={styles.cancelNoteButton!}
                    onPress={() => setNoteEditor(undefined)}
                    isDisabled={isBusy}
                  >
                    <X aria-hidden="true" size={13} />
                    <FormattedMessage id="analysis.cancel" />
                  </Button>
                </div>
              )}
            </article>
          );
        })}
        {activeEditor?.kind === 'create' && (
          <article className={styles.inlineNoteEditor}>
            {renderNoteForm(target, activeEditor)}
          </article>
        )}
        {pathNoteDraft !== undefined && target === pathNoteTarget && (
          <article className={styles.inlineNoteEditor}>
            <div className={styles.noteMeta}>
              <span>
                <FormattedMessage id="analysis.pathNoteDraft" />
              </span>
            </div>
            {renderNotePath(target, pathNoteDraft.moves)}
            <form
              className={styles.inlineNoteForm}
              onSubmit={(event) => {
                event.preventDefault();
                void store.createAnalysisNote(pathNoteScope, noteBody);
              }}
            >
              <label htmlFor="analysis-path-note">
                <FormattedMessage id="analysis.pathNoteComment" />
              </label>
              <textarea
                id="analysis-path-note"
                value={noteBody}
                onChange={(event) => setNoteBody(event.target.value)}
                rows={3}
                autoFocus
                disabled={isBusy}
                placeholder={intl.formatMessage({
                  id: 'analysis.notePlaceholder',
                })}
              />
              {state.scope.kind === 'context' ? (
                <RadioGroup
                  className={styles.inlineScopeGroup!}
                  value={pathNoteScope}
                  onChange={(value) =>
                    setPathNoteScope(value as 'global' | 'context')
                  }
                  aria-label={intl.formatMessage({
                    id: 'analysis.noteVisibility',
                  })}
                >
                  <Radio value="context" className={styles.inlineScopeOption!}>
                    <FormattedMessage
                      id="analysis.contextOnly"
                      values={{ context: state.analysis.contextName }}
                    />
                  </Radio>
                  <Radio value="global" className={styles.inlineScopeOption!}>
                    <FormattedMessage id="analysis.generalNote" />
                  </Radio>
                </RadioGroup>
              ) : (
                <div className={styles.visibilityLabel}>
                  <FormattedMessage id="analysis.generalNote" />
                </div>
              )}
              <div className={styles.inlineFormActions}>
                <button
                  type="submit"
                  className={styles.saveNoteButton}
                  disabled={isBusy || noteBody.trim() === ''}
                >
                  <Save aria-hidden="true" size={14} />
                  <FormattedMessage id="analysis.saveNoteEdit" />
                </button>
                <Button
                  className={styles.cancelNoteButton!}
                  onPress={() => void store.clearAnalysisNote()}
                  isDisabled={isBusy}
                >
                  <ArrowLeft aria-hidden="true" size={14} />
                  <FormattedMessage id="analysis.backToPath" />
                </Button>
              </div>
            </form>
          </article>
        )}
      </li>
    );
  }

  function renderNotePath(
    target: AnalysisNoteTarget,
    moves: readonly {
      readonly from: string;
      readonly to: string;
      readonly san: string;
    }[],
  ) {
    const rows = analysisNoteMoveRows(target, moves);
    const text =
      rows.length === 0
        ? moves
            .map((move) => localizeSan(move.san, state.preferences.uiLocale))
            .join(' ')
        : rows
            .map((row) => {
              const white = row.white
                ? localizeSan(row.white.san, state.preferences.uiLocale)
                : undefined;
              const black = row.black
                ? localizeSan(row.black.san, state.preferences.uiLocale)
                : undefined;
              if (white !== undefined && black !== undefined)
                return `${row.fullmoveNumber}. ${white} ${black}`;
              if (white !== undefined) return `${row.fullmoveNumber}. ${white}`;
              return `${row.fullmoveNumber}... ${black ?? ''}`;
            })
            .join(' ');
    return <div className={styles.notePath}>{text}</div>;
  }

  function renderNoteForm(
    target: AnalysisNoteTarget,
    editor: Extract<NoteEditor, { kind: 'create' | 'edit' }>,
  ) {
    const canChooseContext =
      editor.kind === 'create' && canUseContextScope(target);
    return (
      <form
        className={styles.inlineNoteForm}
        onSubmit={(event) => void submitInlineNote(event, target)}
      >
        <label htmlFor={`note-${editor.targetKey}-${editor.kind}`}>
          <FormattedMessage
            id={
              editor.kind === 'create'
                ? 'analysis.newNote'
                : 'analysis.editNote'
            }
          />
        </label>
        <textarea
          id={`note-${editor.targetKey}-${editor.kind}`}
          value={editor.body}
          onChange={(event) =>
            setNoteEditor({ ...editor, body: event.target.value })
          }
          rows={3}
          autoFocus
          disabled={isBusy}
          placeholder={intl.formatMessage({ id: 'analysis.positionNoteHint' })}
        />
        {canChooseContext && (
          <RadioGroup
            className={styles.inlineScopeGroup!}
            value={editor.noteScope}
            onChange={(value) =>
              setNoteEditor({
                ...editor,
                noteScope: value as 'global' | 'context',
              })
            }
            aria-label={intl.formatMessage({
              id: 'analysis.noteVisibility',
            })}
          >
            <Radio value="context" className={styles.inlineScopeOption!}>
              <FormattedMessage
                id="analysis.contextOnly"
                values={{ context: state.analysis.contextName }}
              />
            </Radio>
            <Radio value="global" className={styles.inlineScopeOption!}>
              <FormattedMessage id="analysis.generalNote" />
            </Radio>
          </RadioGroup>
        )}
        <div className={styles.inlineFormActions}>
          <button
            type="submit"
            className={styles.saveNoteButton}
            disabled={isBusy || editor.body.trim() === ''}
          >
            <Save aria-hidden="true" size={14} />
            <FormattedMessage id="analysis.saveNoteEdit" />
          </button>
          <Button
            className={styles.cancelNoteButton!}
            onPress={() => setNoteEditor(undefined)}
            isDisabled={isBusy}
          >
            <X aria-hidden="true" size={14} />
            <FormattedMessage id="analysis.cancel" />
          </Button>
        </div>
      </form>
    );
  }

  return (
    <main className={styles.analysisView}>
      <header className={styles.viewHeader}>
        <div>
          <span className={styles.eyebrow}>
            <FormattedMessage id="analysis.eyebrow" />
          </span>
          <h1>
            {record?.displayName ?? (
              <FormattedMessage id="analysis.untitledWorkspace" />
            )}
          </h1>
        </div>
        <div className={styles.headerStatus}>
          {scratch === undefined ? (
            <FormattedMessage id="analysis.savedPosition" />
          ) : (
            <FormattedMessage
              id="analysis.scratchRevision"
              values={{ revision: scratch.scratchRevision }}
            />
          )}
        </div>
      </header>

      {record?.readOnlyPreview === true && state.scope.kind === 'context' && (
        <section
          className={styles.previewNotice}
          aria-labelledby="preview-title"
        >
          <div>
            <strong id="preview-title">
              <FormattedMessage
                id="analysis.outsideContext"
                values={{ context: state.analysis.contextName }}
              />
            </strong>
            <p>
              <FormattedMessage id="analysis.previewReadonly" />
            </p>
          </div>
          <div className={styles.noticeActions}>
            <Button
              className={styles.secondaryButton!}
              onPress={() => void store.openCurrentRecordWithoutContext()}
            >
              <ArrowRight aria-hidden="true" size={16} />
              <FormattedMessage id="analysis.openWithoutContext" />
            </Button>
            <Button
              className={styles.primaryButton!}
              onPress={() => void store.addCurrentRecordToContext()}
              isDisabled={isBusy}
            >
              <BookOpen aria-hidden="true" size={16} />
              <FormattedMessage id="analysis.useInContext" />
            </Button>
          </div>
        </section>
      )}

      <div className={styles.workspaceGrid}>
        <ChessBoard
          workspace={displayedAnalysis}
          locale={state.preferences.uiLocale}
          isBusy={isBusy}
          onMove={(from, to, promotion) =>
            void store.applyBoardMove(from, to, promotion)
          }
        />

        <section className={styles.linePanel} aria-labelledby="line-title">
          <div className={styles.panelHeading}>
            <Button
              id="line-title"
              className={styles.pathTitleButton!}
              onPress={() => selectPathPosition(0)}
              isDisabled={navigationLocked || path.positions.length === 0}
            >
              <RotateCcw aria-hidden="true" size={15} />
              <FormattedMessage id="analysis.path" />
            </Button>
            <div className={styles.cursorControls}>
              {lineStartNoteTarget !== undefined &&
                canChangeNotes &&
                pathNoteDraft === undefined && (
                  <Button
                    className={styles.addNoteButton!}
                    aria-label={intl.formatMessage({
                      id: 'analysis.addNoteAtPathStart',
                    })}
                    onPress={() => startCreateNote(lineStartNoteTarget)}
                    isDisabled={isBusy || noteEditor !== undefined}
                  >
                    <MessageSquarePlus aria-hidden="true" size={14} />
                  </Button>
                )}
              <Button
                className={styles.iconButton!}
                aria-label={intl.formatMessage({
                  id: 'analysis.previousMove',
                })}
                isDisabled={navigationLocked || activePositionIndex === 0}
                onPress={() => selectPathPosition(activePositionIndex - 1)}
              >
                <ChevronLeft aria-hidden="true" size={17} />
              </Button>
              <Button
                className={styles.iconButton!}
                aria-label={intl.formatMessage({ id: 'analysis.nextMove' })}
                isDisabled={
                  navigationLocked ||
                  activePositionIndex >= path.positions.length - 1
                }
                onPress={() => selectPathPosition(activePositionIndex + 1)}
              >
                <ChevronRight aria-hidden="true" size={17} />
              </Button>
            </div>
          </div>

          <ol
            ref={moveListRef}
            className={styles.moveList}
            aria-label={intl.formatMessage({ id: 'analysis.moveList' })}
          >
            {path.hasSourcePrefix && (
              <li className={styles.sourceLineLabel}>
                <Button
                  className={styles.sourceLineButton!}
                  onPress={() => {
                    if (path.sourceOriginTarget !== undefined)
                      void store.openAnalysisTarget(path.sourceOriginTarget);
                  }}
                  isDisabled={
                    navigationLocked ||
                    scratch !== undefined ||
                    path.sourceOriginTarget === undefined
                  }
                >
                  <span>
                    <FormattedMessage
                      id="analysis.sourceLine"
                      values={{ source: path.sourceDisplayName }}
                    />
                  </span>
                  <ArrowRight aria-hidden="true" size={13} />
                </Button>
              </li>
            )}
            {renderInlineNotes(lineStartNoteTarget, 'line-start-notes')}
            {renderMoveRows(sourceEntries, 'source')}
            {path.hasSourcePrefix && (
              <>
                <li
                  className={`${styles.pathBoundary} ${path.analysisOriginPositionIndex === activePositionIndex ? styles.currentBoundary : ''}`}
                >
                  <Button
                    className={styles.pathBoundaryButton!}
                    {...(path.analysisOriginPositionIndex === undefined
                      ? {}
                      : {
                          'data-path-position':
                            path.analysisOriginPositionIndex,
                        })}
                    {...(path.analysisOriginPositionIndex ===
                    activePositionIndex
                      ? { 'aria-current': 'step' as const }
                      : {})}
                    onPress={() => {
                      if (path.analysisOriginPositionIndex !== undefined)
                        selectPathPosition(path.analysisOriginPositionIndex);
                    }}
                    isDisabled={
                      navigationLocked ||
                      path.analysisOriginPositionIndex === undefined
                    }
                  >
                    <GitBranch aria-hidden="true" size={14} />
                    <FormattedMessage id="analysis.analysisOrigin" />
                  </Button>
                  {path.recordRootTarget !== undefined &&
                    canChangeNotes &&
                    pathNoteDraft === undefined && (
                      <Button
                        className={styles.addNoteButton!}
                        aria-label={intl.formatMessage({
                          id: 'analysis.addNote',
                        })}
                        onPress={() => startCreateNote(path.recordRootTarget!)}
                        isDisabled={isBusy || noteEditor !== undefined}
                      >
                        <MessageSquarePlus aria-hidden="true" size={14} />
                      </Button>
                    )}
                </li>
                {renderInlineNotes(
                  path.recordRootTarget,
                  'analysis-origin-notes',
                )}
              </>
            )}
            {renderMoveRows(storedEntries, 'stored')}
            {visibleScratchEntries.length > 0 &&
              (path.hasStoredPrefix || path.hasSourcePrefix) && (
                <li
                  className={styles.pathBoundary}
                  role="separator"
                  aria-label={intl.formatMessage({
                    id: 'analysis.newAnalysisPath',
                  })}
                >
                  <GitBranch aria-hidden="true" size={14} />
                  <FormattedMessage id="analysis.newAnalysisPath" />
                </li>
              )}
            {renderMoveRows(visibleScratchEntries, 'scratch')}
          </ol>

          {scratch !== undefined &&
            pathNoteDraft === undefined &&
            atWorkspacePosition && (
              <form className={styles.moveEntry} onSubmit={submitMove}>
                <label htmlFor="analysis-move">
                  <FormattedMessage id="analysis.enterMove" />
                </label>
                <div>
                  <input
                    id="analysis-move"
                    value={moveInput}
                    onChange={(event) => setMoveInput(event.target.value)}
                    placeholder={intl.formatMessage({
                      id: 'analysis.movePlaceholder',
                    })}
                    disabled={isBusy}
                  />
                  <button
                    type="submit"
                    className={styles.iconButton}
                    aria-label={intl.formatMessage({ id: 'analysis.playMove' })}
                    disabled={isBusy || moveInput.trim() === ''}
                  >
                    <CornerDownLeft aria-hidden="true" size={17} />
                  </button>
                </div>
              </form>
            )}

          {scratch === undefined && record?.readOnlyPreview !== true && (
            <div className={styles.startActions}>
              {record !== undefined && (
                <Button
                  className={styles.primaryButton!}
                  onPress={() => {
                    if (activePosition?.target !== undefined)
                      void store.startScratchAtTarget(activePosition.target);
                  }}
                  isDisabled={isBusy || activePosition?.target === undefined}
                >
                  <ArrowRight aria-hidden="true" size={16} />
                  <FormattedMessage id="analysis.exploreFromHere" />
                </Button>
              )}
              <Button
                className={styles.secondaryButton!}
                onPress={() => void store.startScratchAtInitialPosition()}
                isDisabled={isBusy}
              >
                <FilePlus2 aria-hidden="true" size={16} />
                <FormattedMessage id="analysis.fromInitial" />
              </Button>
              <form className={styles.fenForm} onSubmit={startFromFen}>
                <label htmlFor="analysis-fen">FEN</label>
                <div>
                  <input
                    id="analysis-fen"
                    value={fen}
                    onChange={(event) => setFen(event.target.value)}
                    placeholder={intl.formatMessage({
                      id: 'analysis.fenPlaceholder',
                    })}
                    disabled={isBusy}
                  />
                  <button
                    type="submit"
                    className={styles.smallButton}
                    disabled={isBusy || fen.trim() === ''}
                  >
                    <FormattedMessage id="analysis.start" />
                  </button>
                </div>
              </form>
            </div>
          )}

          {scratch !== undefined && pathNoteDraft === undefined && (
            <section
              className={styles.analysisActions}
              aria-labelledby="analysis-actions-title"
            >
              <h3 id="analysis-actions-title">
                <FormattedMessage id="analysis.keepAnalysis" />
              </h3>
              {scratch.origin.kind === 'inventory_anchor' &&
                scratch.cursor > 0 && (
                  <div className={styles.saveChoice}>
                    <strong className={styles.saveHeading}>
                      <FormattedMessage id="analysis.saveAsNote" />
                    </strong>
                    <Button
                      className={styles.ochreButton!}
                      onPress={() => void store.prepareAnalysisNote('')}
                      isDisabled={isBusy}
                    >
                      <ArrowLeft aria-hidden="true" size={16} />
                      <FormattedMessage id="analysis.prepareNote" />
                    </Button>
                  </div>
                )}

              {scratch.cursor > 0 && (
                <form className={styles.saveForm} onSubmit={saveRecord}>
                  <strong className={styles.saveHeading}>
                    <FormattedMessage id="analysis.saveAsRecord" />
                  </strong>
                  <label htmlFor="analysis-title">
                    <FormattedMessage id="analysis.recordTitle" />
                  </label>
                  <input
                    id="analysis-title"
                    value={recordTitle}
                    onChange={(event) => setRecordTitle(event.target.value)}
                    disabled={isBusy}
                  />
                  <label htmlFor="analysis-record-note">
                    <FormattedMessage id="analysis.recordNote" />
                  </label>
                  <textarea
                    id="analysis-record-note"
                    value={recordNoteBody}
                    onChange={(event) => setRecordNoteBody(event.target.value)}
                    rows={3}
                    disabled={isBusy}
                    placeholder={intl.formatMessage({
                      id: 'analysis.recordNotePlaceholder',
                    })}
                  />
                  {state.scope.kind === 'context' && (
                    <RadioGroup
                      className={styles.destinationGroup!}
                      value={destination}
                      onChange={(value) => {
                        const next = value as 'inventory' | 'context';
                        setDestination(next);
                        if (next === 'inventory') setRecordNoteScope('global');
                        if (next === 'context') setRecordNoteScope('context');
                      }}
                      aria-label={intl.formatMessage({
                        id: 'analysis.destination',
                      })}
                    >
                      <Radio
                        value="context"
                        className={styles.destinationOption!}
                      >
                        <FormattedMessage
                          id="analysis.inventoryAndContext"
                          values={{ context: state.analysis.contextName }}
                        />
                      </Radio>
                      <Radio
                        value="inventory"
                        className={styles.destinationOption!}
                      >
                        <FormattedMessage id="analysis.inventoryOnly" />
                      </Radio>
                    </RadioGroup>
                  )}
                  <button
                    type="submit"
                    className={styles.primaryButton}
                    disabled={isBusy || recordTitle.trim() === ''}
                  >
                    <Save aria-hidden="true" size={16} />
                    <FormattedMessage id="analysis.saveAsAnalysis" />
                  </button>
                </form>
              )}

              <Button
                className={styles.discardButton!}
                onPress={() => void store.discardAnalysisScratch()}
                isDisabled={isBusy}
              >
                <Trash2 aria-hidden="true" size={15} />
                <FormattedMessage id="analysis.discard" />
              </Button>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}

function targetKey(target: AnalysisNoteTarget): string {
  return `${target.itemId}:${target.revisionId}:${target.anchorId}`;
}
