import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  GitBranch,
  GitBranchPlus,
  MessageSquarePlus,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { Button, Radio, RadioGroup } from 'react-aria-components';
import { FormattedMessage, useIntl } from 'react-intl';
import type {
  AnalyzePositionRequestDto,
  AnalysisRecordDto,
} from '../../host_client/index.ts';

import { ChessBoard } from './chess-board.tsx';
import { localizeSan, formatMoveSequence } from './chess-display.ts';
import { InventoryTypeIcon } from './inventory-type-icon.tsx';
import { inventoryDefaultFolder } from './inventory-folder-presentation.ts';
import {
  InventoryFolderField,
  InventoryNameSuggestion,
} from './inventory-save-fields.tsx';
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
  type AnalysisNoteFormDraft,
  type AnalysisRecordFormDraft,
} from './plysmith-application-store.ts';
import { PositionAnalysisPanel } from './position-analysis-panel.tsx';
import { AnalysisPanelLayout } from './analysis-panel-layout.tsx';
import { ChessTreeMoveList } from './chess-tree-view.tsx';
import { RevisionImpactView } from './revision-impact-view.tsx';
import { RevisionLineComparison } from './revision-line-comparison.tsx';
import { RevisionFollowingContexts } from './revision-following-contexts.tsx';
import styles from './analysis-view.module.css';

type ReadyState = Extract<PlysmithApplicationState, { phase: 'ready' }>;
type AnalysisReadyState = ReadyState & {
  readonly analysis: NonNullable<ReadyState['analysis']>;
};
type NoteEditor =
  | AnalysisNoteFormDraft
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
  const analysis = state.analysis;
  if (state.fairPlayBlocked || analysis === undefined) return null;
  return (
    <AnalysisWorkspaceView
      key={JSON.stringify([state.scope, analysis.record?.itemId])}
      state={{ ...state, analysis }}
      store={store}
    />
  );
}

function AnalysisWorkspaceView({
  state,
  store,
}: {
  readonly state: AnalysisReadyState;
  readonly store: PlysmithApplicationStore;
}) {
  const intl = useIntl();
  const scratch = state.analysis.scratch;
  const record = state.analysis.record;
  const emptyScratchCleanupRef = useRef<string | null>(null);
  const gameResult =
    record?.game === undefined
      ? undefined
      : record.game.outcome.kind === 'win'
        ? intl.formatMessage(
            { id: 'playout.result.win' },
            {
              side: intl.formatMessage({
                id: `side.${record.game.outcome.winner}`,
              }),
            },
          )
        : record.game.outcome.kind === 'draw'
          ? intl.formatMessage({
              id:
                'reason' in record.game.outcome
                  ? `playout.result.draw.${record.game.outcome.reason}`
                  : 'playout.result.draw',
            })
          : intl.formatMessage({ id: 'playout.result.unfinished' });
  const pendingRevisionImpact =
    record === undefined
      ? undefined
      : state.contextWorkspace?.pendingRevisionImpacts.find(
          (impact) => impact.itemId === record.itemId,
        );
  const revisionScratch =
    scratch?.intent.kind === 'inventory_revision' ? scratch : undefined;
  const revisionIntent =
    scratch?.intent.kind === 'inventory_revision' ? scratch.intent : undefined;
  const revisionPreview = state.inventoryRevisionPreview;
  const revisionMode = revisionPreview?.mode ?? revisionIntent?.mode;
  const scratchBoundaryMessageId =
    revisionIntent === undefined
      ? 'analysis.newAnalysisPath'
      : `inventory.mode.${revisionMode}`;
  const explorationStartsAtLineEnd =
    scratch?.origin.kind === 'inventory_anchor' &&
    record !== undefined &&
    scratch.origin.anchorId ===
      (record.steps.at(-1)?.anchorId ?? record.rootAnchorId);
  const revisionCandidate =
    record === undefined || revisionPreview === undefined
      ? undefined
      : {
          ...record,
          displayName: revisionPreview.displayName,
          ...(revisionPreview.summary === undefined
            ? { summary: undefined }
            : { summary: revisionPreview.summary }),
          steps: [
            ...record.steps.slice(0, revisionPreview.preservedMoveCount),
            ...revisionPreview.addedSteps,
          ],
        };
  const path = useMemo(
    () => analysisPathPresentation(state.analysis),
    [state.analysis],
  );
  const line = path.entries;
  const sourceEntries = line.filter((entry) => entry.kind === 'source');
  const storedEntries = line.filter((entry) => entry.kind === 'stored');
  const storedEntriesByAnchor = new Map(
    storedEntries.map((entry) => [entry.anchorId, entry]),
  );
  const contributionsByAnchor = useMemo(() => {
    const grouped = new Map<string, PathContribution[]>();
    for (const note of record?.contributions ?? []) {
      const entries = grouped.get(note.anchorId) ?? [];
      entries.push(note);
      grouped.set(note.anchorId, entries);
    }
    return grouped;
  }, [record?.contributions]);
  const scratchEntries = line.filter((entry) => entry.kind === 'scratch');
  const reusedScratchCount =
    revisionScratch !== undefined &&
    revisionPreview !== undefined &&
    (revisionIntent?.mode === 'truncate_after' ||
      revisionIntent?.mode === 'replace_move')
      ? Math.max(
          0,
          revisionScratch.steps.length - revisionPreview.addedSteps.length,
        )
      : 0;
  const reusedScratchEntriesByAnchor = new Map(
    scratchEntries.slice(0, reusedScratchCount).flatMap((entry, index) => {
      const anchorId =
        record?.steps[
          revisionPreview!.preservedMoveCount - reusedScratchCount + index
        ]?.anchorId;
      return anchorId === undefined ? [] : [[anchorId, entry] as const];
    }),
  );
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
  const visibleScratchEntries = scratchEntries.slice(reusedScratchCount);
  const inlineScratchAnchor =
    scratch !== undefined &&
    pathNoteOrigin?.itemId === record?.itemId &&
    pathNoteOrigin?.revisionId === record?.revisionId &&
    revisionIntent?.mode !== 'metadata'
      ? reusedScratchCount > 0
        ? record?.steps[revisionPreview!.preservedMoveCount - 1]?.anchorId
        : pathNoteOrigin?.anchorId
      : undefined;
  const isBusy = state.busyCommand !== undefined || state.refreshing;
  const canChangeNotes = pendingRevisionImpact === undefined;
  const lineStartNoteTarget = path.hasSourcePrefix
    ? path.sourceRootTarget
    : path.recordRootTarget;
  const [noteBody, setNoteBody] = useState(scratch?.noteDraft?.body ?? '');
  const noteOwner = record?.itemId ?? '';
  const [selectedNoteEditor, setNoteEditorState] = useState<
    NoteEditor | undefined
  >(() => store.getActiveAnalysisNoteForm?.(state.scope, noteOwner));
  const [, setNoteDraftVersion] = useState(0);
  const noteTargets = new Map<string, AnalysisNoteTarget>();
  for (const target of [
    path.sourceRootTarget,
    path.recordRootTarget,
    ...line.map((entry) => entry.noteTarget),
  ]) {
    if (target !== undefined) noteTargets.set(targetKey(target), target);
  }
  for (const node of record?.tree?.nodes ?? []) {
    const target = {
      itemId: record!.itemId,
      revisionId: record!.revisionId,
      anchorId: node.anchorId,
      start: node.after,
      contributions: contributionsByAnchor.get(node.anchorId) ?? [],
    };
    noteTargets.set(targetKey(target), target);
  }
  function editorIsAvailable(editor: NoteEditor) {
    const target = noteTargets.get(editor.targetKey);
    return (
      target !== undefined &&
      (editor.kind === 'create' ||
        target.contributions.some(
          (note) =>
            note.contributionId === editor.contributionId &&
            note.contributionVersion === editor.contributionVersion,
        ))
    );
  }
  const noteEditor =
    selectedNoteEditor !== undefined && editorIsAvailable(selectedNoteEditor)
      ? selectedNoteEditor
      : undefined;
  const unavailableNoteDrafts = (
    store.getAnalysisNoteFormDrafts?.(state.scope, noteOwner) ?? []
  ).filter((draft) => !editorIsAvailable(draft));

  function setNoteEditor(next: NoteEditor | undefined) {
    if (
      next === undefined &&
      selectedNoteEditor !== undefined &&
      selectedNoteEditor.kind !== 'delete'
    )
      store.discardAnalysisNoteForm?.(
        state.scope,
        noteOwner,
        selectedNoteEditor,
      );
    store.setAnalysisNoteForm?.(
      state.scope,
      noteOwner,
      next?.kind === 'delete' ? undefined : next,
    );
    setNoteEditorState(next);
  }
  function activateNoteEditor(next: AnalysisNoteFormDraft) {
    setNoteEditor(
      store.getAnalysisNoteForm?.(state.scope, noteOwner, next) ?? next,
    );
  }
  const [variationComment, setVariationComment] = useState({
    enabled: false,
    body: '',
    noteScope:
      state.scope.kind === 'context'
        ? ('context' as const)
        : ('global' as const),
  });
  function readRecordForm(): AnalysisRecordFormDraft {
    return (
      (scratch === undefined
        ? undefined
        : store.getAnalysisRecordForm?.(state.scope, scratch.scratchId)) ?? {
        title: '',
        noteBody: '',
        open: false,
        destination: state.scope.kind === 'context' ? 'context' : 'inventory',
        noteScope: state.scope.kind === 'context' ? 'context' : 'global',
        folderId:
          scratch?.origin.kind === 'inventory_anchor'
            ? undefined
            : inventoryDefaultFolder(
                state.inventoryOrganization,
                state.selectedInventoryFolderId,
                state.scope.kind === 'context',
              ),
      }
    );
  }
  const [recordFormState, setRecordFormState] = useState(() => ({
    scratchId: scratch?.scratchId,
    draft: readRecordForm(),
  }));
  const recordForm =
    recordFormState.scratchId === scratch?.scratchId
      ? recordFormState.draft
      : readRecordForm();
  function updateRecordForm(patch: Partial<AnalysisRecordFormDraft>) {
    const draft = { ...recordForm, ...patch };
    if (scratch !== undefined)
      store.setAnalysisRecordForm?.(state.scope, scratch.scratchId, draft);
    setRecordFormState({ scratchId: scratch?.scratchId, draft });
  }
  const recordTitle = recordForm.title;
  const recordFolderId = recordForm.folderId;
  const recordNoteBody = recordForm.noteBody;
  const destination = recordForm.destination;
  const recordNoteScope = recordForm.noteScope;
  const showSaveRecord = recordForm.open;
  const setRecordTitle = (title: string) => updateRecordForm({ title });
  const setRecordFolderId = (folderId: string | null | undefined) =>
    updateRecordForm({ folderId });
  const setRecordNoteBody = (noteBody: string) =>
    updateRecordForm({ noteBody });
  const setShowSaveRecord = (open: boolean) => updateRecordForm({ open });
  const [pathNoteScope, setPathNoteScope] = useState<'global' | 'context'>(
    state.scope.kind === 'context' ? 'context' : 'global',
  );
  const [revisionDetailsOpen, setRevisionDetailsOpen] = useState(false);
  const [analysisDetailsOpen, setAnalysisDetailsOpen] = useState(false);
  const [selectedPositionIndex, setSelectedPositionIndex] = useState(
    path.currentPositionIndex,
  );
  const moveListRef = useRef<HTMLDivElement>(null);
  const revisionSummaryRef = useRef<HTMLButtonElement>(null);
  const analysisSummaryRef = useRef<HTMLButtonElement>(null);
  const activePositionIndex = Math.max(
    0,
    Math.min(selectedPositionIndex, Math.max(0, path.positions.length - 1)),
  );
  const activePosition = path.positions[activePositionIndex];
  const positionAnalysisWork = useMemo<
    Extract<AnalyzePositionRequestDto['work'], { readonly scope: unknown }>
  >(() => {
    const itemId =
      activePosition?.target?.itemId ??
      (activePositionIndex < sourceEntries.length
        ? record?.sourceLine?.sourceItemId
        : undefined) ??
      (scratch?.origin.kind === 'inventory_anchor'
        ? scratch.origin.itemId
        : record?.itemId);
    return {
      scope: state.scope,
      subject:
        itemId === undefined
          ? { kind: 'position' }
          : { kind: 'inventory_item', itemId },
    };
  }, [
    activePosition,
    activePositionIndex,
    sourceEntries.length,
    record,
    scratch,
    state.scope,
  ]);
  const canAnalyzePosition =
    positionAnalysisWork.subject.kind === 'position' ||
    store.canWorkWithInventoryItem(positionAnalysisWork.subject.itemId);
  const positionAnalysisFocus = useMemo(() => {
    const root = path.positions[0]?.state;
    if (root === undefined || activePosition === undefined) return undefined;
    const focusKey = [
      state.analysis.record?.revisionId ?? 'draft',
      state.analysis.scratch?.scratchId ?? '-',
      state.analysis.scratch?.scratchRevision ?? 0,
      activePositionIndex,
      activePosition.state.fen,
    ].join(':');
    return Object.freeze({
      focusKey,
      root,
      moves: Object.freeze(
        path.entries.slice(0, activePositionIndex).map((entry) => entry.move),
      ),
      current: activePosition.state,
    });
  }, [
    activePosition,
    activePositionIndex,
    path,
    state.analysis.record,
    state.analysis.scratch,
  ]);
  const navigationLocked = isBusy || pathNoteDraft !== undefined;
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
  const canAnalyzeRecord =
    scratch === undefined &&
    record !== undefined &&
    !record.historical &&
    record.revisionId === record.currentRevisionId &&
    pendingRevisionImpact === undefined &&
    atWorkspacePosition;
  const canStartAnalysisPath =
    scratch === undefined &&
    record === undefined &&
    state.analysis.allowedActions.includes('start_scratch') &&
    atWorkspacePosition;
  const candidateStoredMoveCount =
    scratch === undefined
      ? record?.itemType === 'analysis'
        ? record.steps.length
        : undefined
      : revisionScratch !== undefined && revisionScratch.steps.length === 0
        ? revisionPreview?.preservedMoveCount
        : undefined;
  const lastEditableEntry =
    scratch !== undefined && scratch.steps.length > 0
      ? scratchEntries.at(-1)
      : candidateStoredMoveCount === undefined || candidateStoredMoveCount === 0
        ? undefined
        : revisionIntent?.mode === 'add_variation'
          ? undefined
          : storedEntries.find(
              (entry) =>
                entry.anchorId ===
                record?.steps[candidateStoredMoveCount - 1]?.anchorId,
            );
  const canTakeBackLastMove =
    lastEditableEntry !== undefined &&
    lastEditableEntry.positionIndex === activePositionIndex &&
    atWorkspacePosition &&
    !navigationLocked &&
    (scratch === undefined
      ? record?.itemType === 'analysis' && record.cursor === record.steps.length
      : scratch.cursor === scratch.steps.length);

  useEffect(() => {
    const draft =
      scratch?.noteDraft === undefined
        ? undefined
        : store.getPathNoteFormDraft?.(
            scratch.scratchId,
            scratch.noteDraft.body,
          );
    setNoteBody(draft?.body ?? scratch?.noteDraft?.body ?? '');
    setPathNoteScope(
      draft?.noteScope ??
        (state.scope.kind === 'context' ? 'context' : 'global'),
    );
  }, [scratch?.scratchId, scratch?.noteDraft?.body, state.scope, store]);

  useEffect(
    () => setRevisionDetailsOpen(revisionScratch !== undefined),
    [revisionScratch?.scratchId],
  );
  useEffect(() => {
    setVariationComment(
      scratch === undefined
        ? {
            enabled: false,
            body: '',
            noteScope: state.scope.kind === 'context' ? 'context' : 'global',
          }
        : (store.getVariationCommentDraft?.(scratch.scratchId) ?? {
            enabled: false,
            body: '',
            noteScope: state.scope.kind === 'context' ? 'context' : 'global',
          }),
    );
  }, [scratch?.scratchId, state.scope, store]);
  useEffect(() => setAnalysisDetailsOpen(false), [scratch?.scratchId]);

  useEffect(() => {
    if (
      !isBusy &&
      scratch?.intent.kind === 'exploration' &&
      scratch.origin.kind === 'inventory_anchor' &&
      scratch.scratchRevision > 1 &&
      scratch.steps.length === 0 &&
      record?.itemId === scratch.origin.itemId &&
      record.revisionId === scratch.origin.revisionId
    ) {
      const key = `${state.scope.kind}:${scratch.scratchId}:${scratch.scratchRevision}`;
      if (emptyScratchCleanupRef.current === key) return;
      emptyScratchCleanupRef.current = key;
      void store.discardAnalysisScratch();
    }
  }, [
    isBusy,
    record?.itemId,
    record?.revisionId,
    scratch,
    state.scope.kind,
    store,
  ]);

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

  useEffect(() => {
    function takeBackWithKeyboard(event: KeyboardEvent) {
      if (event.key !== 'Backspace' || !canTakeBackLastMove) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
          (target.tagName === 'BUTTON' &&
            target.closest('[data-analysis-board]') === null))
      ) {
        return;
      }
      event.preventDefault();
      void store.takeBackLastMove();
    }
    window.addEventListener('keydown', takeBackWithKeyboard);
    return () => window.removeEventListener('keydown', takeBackWithKeyboard);
  }, [canTakeBackLastMove, store]);

  function selectPathPosition(positionIndex: number) {
    const boundedIndex = Math.max(
      0,
      Math.min(positionIndex, path.positions.length - 1),
    );
    const position = path.positions[boundedIndex];
    if (position === undefined) return;
    if (
      scratch !== undefined &&
      scratch.intent.kind !== 'inventory_revision' &&
      position.scratchCursor !== undefined &&
      position.scratchCursor !== scratch.cursor
    ) {
      void store.moveAnalysisCursor(position.scratchCursor);
      return;
    }
    if (
      scratch === undefined &&
      record !== undefined &&
      position.target?.itemId === record.itemId &&
      position.target.revisionId === record.revisionId &&
      position.target.anchorId !== record.currentAnchorId
    ) {
      void store.openRecordAnchor(position.target.anchorId, 'sequential');
      return;
    }
    setSelectedPositionIndex(boundedIndex);
  }

  async function saveRecord(event: FormEvent) {
    event.preventDefault();
    if (
      await store.createAnalysisRecord(
        recordTitle,
        destination,
        recordNoteScope,
        scratch !== undefined && scratch.cursor > 0 ? recordNoteBody : '',
        recordFolderId,
      )
    ) {
      cancelSaveRecord();
    }
  }

  function cancelSaveRecord() {
    if (scratch !== undefined)
      store.setAnalysisRecordForm?.(state.scope, scratch.scratchId, undefined);
    setRecordFormState({
      scratchId: scratch?.scratchId,
      draft: readRecordForm(),
    });
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
    if (!store.canWorkWithInventoryItem(target.itemId)) return;
    activateNoteEditor({
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
    activateNoteEditor({
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
        noteEditor?.targetKey === targetKey(target))
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
          <span className={styles.moveNumber}>
            {row.fullmoveNumber}
            {row.white === undefined ? '...' : '.'}
          </span>
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

  function renderTreeSteps(steps: AnalysisRecordDto['steps'], key: string) {
    if (record === undefined) return null;
    const entries = steps.map((step): AnalysisPathEntry => ({
      ...step,
      kind: 'stored',
      positionIndex:
        reusedScratchEntriesByAnchor.get(step.anchorId)?.positionIndex ??
        storedEntriesByAnchor.get(step.anchorId)?.positionIndex ??
        -1,
      current: record.currentAnchorId === step.anchorId,
      branchOrigin: false,
      noteTarget: {
        itemId: record.itemId,
        revisionId: record.revisionId,
        anchorId: step.anchorId,
        start: step.after,
        contributions: contributionsByAnchor.get(step.anchorId) ?? [],
      },
    }));
    return renderMoveRows(entries, 'tree-' + key);
  }

  function renderScratchMoves() {
    return (
      <>
        {visibleScratchEntries.length > 0 &&
          (path.hasStoredPrefix ||
            path.hasSourcePrefix ||
            inlineScratchAnchor !== undefined) && (
            <li
              className={styles.pathBoundary}
              aria-label={intl.formatMessage({ id: scratchBoundaryMessageId })}
            >
              <span className={styles.pathBoundaryLabel}>
                <GitBranch aria-hidden="true" size={14} />
                <FormattedMessage id={scratchBoundaryMessageId} />
              </span>
            </li>
          )}
        {renderMoveRows(visibleScratchEntries, 'scratch')}
        {inlineScratchAnchor !== undefined && <li>{renderPathActions()}</li>}
      </>
    );
  }

  function updateVariationComment(patch: Partial<typeof variationComment>) {
    const next = { ...variationComment, ...patch };
    setVariationComment(next);
    if (scratch !== undefined)
      store.setVariationCommentDraft(scratch.scratchId, next);
  }

  function renderMove(
    entry: AnalysisPathEntry | undefined,
    side: 'white' | 'black',
  ) {
    if (entry === undefined) return renderEmptyMove();
    const storedContext = scratch !== undefined && entry.kind !== 'scratch';
    const selected =
      entry.kind === 'stored' && entry.anchorId !== undefined
        ? (activePosition?.target?.anchorId === entry.anchorId &&
            activePosition.target.itemId === record?.itemId) ||
          (activePosition?.scratchCursor !== undefined &&
            reusedScratchEntriesByAnchor.has(entry.anchorId) &&
            entry.positionIndex === activePositionIndex)
        : entry.positionIndex === activePositionIndex &&
          entry.positionIndex !== path.analysisOriginPositionIndex;
    const localizedMove = localizeSan(
      entry.move.san,
      state.preferences.uiLocale,
    );
    const isLastEditableMove =
      lastEditableEntry?.positionIndex === entry.positionIndex &&
      (lastEditableEntry.kind === entry.kind ||
        (entry.anchorId !== undefined &&
          reusedScratchEntriesByAnchor.has(entry.anchorId)));
    return (
      <div className={styles.moveCell}>
        <Button
          className={`${styles.moveButton!} ${selected ? styles.currentMove : ''} ${storedContext ? styles.storedMove : ''}`}
          data-path-position={entry.positionIndex}
          data-tree-anchor={
            entry.kind === 'stored' ? entry.anchorId : undefined
          }
          {...(selected ? { 'aria-current': 'step' as const } : {})}
          aria-label={intl.formatMessage(
            { id: 'analysis.moveAt' },
            {
              number: entry.before.playState.fullmoveNumber,
              side,
              move: localizedMove,
            },
          )}
          onPress={() => {
            if (
              entry.kind === 'stored' &&
              entry.anchorId !== undefined &&
              scratch === undefined
            )
              void store.openRecordAnchor(entry.anchorId);
            else selectPathPosition(entry.positionIndex);
          }}
          isDisabled={
            navigationLocked ||
            (entry.kind === 'stored' && scratch !== undefined)
          }
        >
          {localizedMove}
        </Button>
        <div className={styles.moveActions}>
          {entry.noteTarget !== undefined &&
            canChangeNotes &&
            store.canWorkWithInventoryItem(entry.noteTarget.itemId) &&
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
          {isLastEditableMove && (
            <Button
              className={styles.takeBackButton!}
              aria-label={intl.formatMessage({
                id: 'analysis.takeBackLastMove',
              })}
              onPress={() => void store.takeBackLastMove()}
              isDisabled={!canTakeBackLastMove}
            >
              <Undo2 aria-hidden="true" size={14} />
            </Button>
          )}
        </div>
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
              className={`${styles.inlineNote!} ${contribution.scopeKind === 'context' ? styles.contextNote : ''}`}
              data-note-scope={contribution.scopeKind}
              aria-label={intl.formatMessage({
                id:
                  contribution.scopeKind === 'context'
                    ? 'analysis.contextNote'
                    : 'analysis.generalNote',
              })}
              key={contribution.contributionId}
            >
              <div className={styles.noteMeta}>
                <span>
                  {(editing || deleting) && (
                    <FormattedMessage
                      id={
                        contribution.scopeKind === 'context'
                          ? 'analysis.contextNote'
                          : 'analysis.generalNote'
                      }
                    />
                  )}
                </span>
                {canChangeNotes &&
                  store.canWorkWithInventoryItem(target.itemId) &&
                  !editing &&
                  !deleting && (
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
          <article
            className={`${styles.inlineNoteEditor!} ${activeEditor.noteScope === 'global' ? styles.globalNoteEditor : ''}`}
            data-note-draft-scope={activeEditor.noteScope}
          >
            {renderNoteForm(target, activeEditor)}
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
        {editor.kind === 'create' && !canChooseContext && (
          <div className={styles.visibilityLabel}>
            <FormattedMessage id="analysis.generalNote" />
          </div>
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

  function renderPathNoteDraft() {
    return pathNoteDraft === undefined ? null : (
      <article
        className={`${styles.inlineNoteEditor!} ${pathNoteScope === 'global' ? styles.globalNoteEditor : ''}`}
        data-note-draft-scope={pathNoteScope}
      >
        <div className={styles.noteMeta}>
          <span>
            <FormattedMessage id="analysis.pathNoteDraft" />
          </span>
        </div>
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
            onChange={(event) => {
              setNoteBody(event.target.value);
              store.setPathNoteFormDraft(
                scratch!.scratchId,
                event.target.value,
                pathNoteScope,
              );
            }}
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
              onChange={(value) => {
                const noteScope = value as 'global' | 'context';
                setPathNoteScope(noteScope);
                store.setPathNoteFormDraft(
                  scratch!.scratchId,
                  noteBody,
                  noteScope,
                );
              }}
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
    );
  }

  function renderPathActions() {
    return (
      <div data-analysis-path-actions>
        {renderPathNoteDraft()}
        {revisionScratch !== undefined && pathNoteDraft === undefined && (
          <section
            className={styles.revisionActions}
            aria-labelledby="revision-actions-title"
          >
            <div className={styles.draftBar}>
              <button
                ref={revisionSummaryRef}
                type="button"
                className={styles.draftToggle}
                aria-controls="revision-details"
                aria-expanded={revisionDetailsOpen}
                onClick={() => setRevisionDetailsOpen((open) => !open)}
              >
                <ChevronDown aria-hidden="true" size={17} />
                <span className={styles.draftToggleText}>
                  <span className={styles.panelLabel}>
                    <FormattedMessage id="draft.unsavedChange" />
                  </span>
                  <strong id="revision-actions-title">
                    <FormattedMessage id={`inventory.mode.${revisionMode}`} />
                  </strong>
                </span>
                {revisionMode !== 'metadata' && (
                  <span className={styles.draftCount}>
                    <FormattedMessage
                      id="inventory.moveCount"
                      values={{
                        count:
                          revisionPreview?.addedSteps.length ??
                          revisionScratch.steps.length,
                      }}
                    />
                  </span>
                )}
              </button>
              {!revisionDetailsOpen && (
                <Button
                  className={`${styles.primaryButton!} ${styles.draftPrompt!}`}
                  onPress={() => {
                    setRevisionDetailsOpen(true);
                    revisionSummaryRef.current?.focus();
                  }}
                  isDisabled={isBusy}
                >
                  <ClipboardCheck aria-hidden="true" size={15} />
                  <FormattedMessage id="draft.reviewChange" />
                </Button>
              )}
            </div>
            <div
              id="revision-details"
              className={styles.draftContent}
              hidden={!revisionDetailsOpen}
            >
              {revisionPreview === undefined ? (
                <p className={styles.revisionHint}>
                  <FormattedMessage id="inventory.previewPending" />
                </p>
              ) : (
                <div className={styles.revisionPreview}>
                  {revisionIntent?.mode === 'add_variation' ? (
                    <>
                      <strong>
                        <FormattedMessage id="analysis.variationScope" />
                      </strong>
                      <div className={styles.notePath}>
                        {formatMoveSequence(
                          revisionScratch.steps,
                          state.preferences.uiLocale,
                        )}
                      </div>
                      {revisionPreview.noOp &&
                        revisionScratch.steps.length > 0 && (
                          <p role="status">
                            <FormattedMessage id="analysis.variationExists" />
                          </p>
                        )}
                      <label className={styles.variationCommentChoice}>
                        <input
                          type="checkbox"
                          checked={variationComment.enabled}
                          disabled={isBusy}
                          onChange={(event) =>
                            updateVariationComment({
                              enabled: event.target.checked,
                              ...(event.target.checked &&
                              variationComment.body === ''
                                ? {
                                    body: formatMoveSequence(
                                      revisionScratch.steps,
                                      state.preferences.uiLocale,
                                    ),
                                  }
                                : {}),
                            })
                          }
                        />
                        <FormattedMessage id="analysis.variationComment" />
                      </label>
                      {variationComment.enabled && (
                        <>
                          <label htmlFor="variation-comment">
                            <FormattedMessage id="analysis.pathNoteComment" />
                          </label>
                          <textarea
                            id="variation-comment"
                            value={variationComment.body}
                            maxLength={128000}
                            rows={3}
                            disabled={isBusy}
                            onChange={(event) =>
                              updateVariationComment({
                                body: event.target.value,
                              })
                            }
                          />
                          {state.scope.kind === 'context' && (
                            <RadioGroup
                              className={styles.inlineScopeGroup!}
                              value={variationComment.noteScope}
                              aria-label={intl.formatMessage({
                                id: 'analysis.noteVisibility',
                              })}
                              onChange={(value) =>
                                updateVariationComment({
                                  noteScope: value as 'global' | 'context',
                                })
                              }
                            >
                              <Radio
                                className={styles.inlineScopeOption!}
                                value="context"
                              >
                                <FormattedMessage
                                  id="analysis.contextOnly"
                                  values={{
                                    context: state.analysis.contextName,
                                  }}
                                />
                              </Radio>
                              <Radio
                                className={styles.inlineScopeOption!}
                                value="global"
                              >
                                <FormattedMessage id="analysis.generalNote" />
                              </Radio>
                            </RadioGroup>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    record !== undefined &&
                    revisionCandidate !== undefined && (
                      <RevisionLineComparison
                        previous={record}
                        next={revisionCandidate}
                        unchangedCount={revisionPreview.preservedMoveCount}
                      />
                    )
                  )}
                  {revisionPreview.historicalGlobalContributionCount > 0 && (
                    <div className={styles.impactWarning} role="status">
                      <AlertTriangle aria-hidden="true" size={18} />
                      <FormattedMessage
                        id="inventory.globalNotesAffected"
                        values={{
                          count:
                            revisionPreview.historicalGlobalContributionCount,
                        }}
                      />
                    </div>
                  )}
                  {revisionPreview.affectedContexts.length > 0 && (
                    <div className={styles.impactWarning}>
                      <AlertTriangle aria-hidden="true" size={18} />
                      <div>
                        <strong>
                          <FormattedMessage id="inventory.contextsAffected" />
                        </strong>
                        <p>
                          <FormattedMessage id="inventory.contextsAffectedDetail" />
                        </p>
                        <ul>
                          {revisionPreview.affectedContexts.map((context) => (
                            <li key={context.contextId}>
                              {context.contextName}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                  <RevisionFollowingContexts
                    contexts={revisionPreview.followingContexts}
                  />
                  <div className={styles.previewActions}>
                    <Button
                      className={styles.secondaryButton!}
                      onPress={() => {
                        setRevisionDetailsOpen(false);
                        revisionSummaryRef.current?.focus();
                      }}
                      isDisabled={isBusy}
                    >
                      <ArrowLeft aria-hidden="true" size={16} />
                      <FormattedMessage id="inventory.backToEdit" />
                    </Button>
                    <Button
                      className={styles.primaryButton!}
                      onPress={() =>
                        void store.saveInventoryRevision(
                          revisionIntent?.mode === 'add_variation' &&
                            variationComment.enabled
                            ? {
                                body: variationComment.body,
                                languageTag: state.preferences.uiLocale,
                                noteScope:
                                  variationComment.noteScope === 'context' &&
                                  state.scope.kind === 'context'
                                    ? {
                                        kind: 'context',
                                        contextId: state.scope.contextId,
                                      }
                                    : { kind: 'global' },
                              }
                            : undefined,
                        )
                      }
                      isDisabled={
                        isBusy ||
                        revisionPreview.noOp ||
                        (revisionIntent?.mode === 'add_variation' &&
                          variationComment.enabled &&
                          variationComment.body.trim() === '')
                      }
                    >
                      <Save aria-hidden="true" size={16} />
                      <FormattedMessage id="inventory.saveRevision" />
                    </Button>
                  </div>
                </div>
              )}
              {state.analysis.allowedActions.includes(
                'continue_exploration',
              ) && (
                <Button
                  className={styles.secondaryButton!}
                  onPress={() => void store.continueAnalysisExploration()}
                  isDisabled={isBusy}
                >
                  <GitBranch aria-hidden="true" size={16} />
                  <FormattedMessage id="analysis.continueExploration" />
                </Button>
              )}
              <Button
                className={styles.discardButton!}
                onPress={() => void store.discardAnalysisScratch()}
                isDisabled={isBusy}
              >
                <Trash2 aria-hidden="true" size={15} />
                <FormattedMessage id="inventory.discardRevision" />
              </Button>
            </div>
          </section>
        )}

        {scratch !== undefined &&
          revisionScratch === undefined &&
          pathNoteDraft === undefined && (
            <section
              className={styles.analysisActions}
              aria-labelledby="analysis-actions-title"
            >
              <div className={styles.draftBar}>
                <button
                  ref={analysisSummaryRef}
                  type="button"
                  className={styles.draftToggle}
                  aria-controls="analysis-actions-details"
                  aria-expanded={analysisDetailsOpen}
                  onClick={() => setAnalysisDetailsOpen((open) => !open)}
                >
                  <ChevronDown aria-hidden="true" size={17} />
                  <span className={styles.draftToggleText}>
                    <span className={styles.panelLabel}>
                      <FormattedMessage id="draft.unsavedChange" />
                    </span>
                    <strong id="analysis-actions-title">
                      <FormattedMessage id="analysis.newAnalysisPath" />
                    </strong>
                  </span>
                  {scratch.cursor > 0 && (
                    <span className={styles.draftCount}>
                      <FormattedMessage
                        id="inventory.moveCount"
                        values={{ count: scratch.cursor }}
                      />
                    </span>
                  )}
                </button>
                {!analysisDetailsOpen && (
                  <Button
                    className={`${styles.primaryButton!} ${styles.draftPrompt!}`}
                    onPress={() => {
                      setAnalysisDetailsOpen(true);
                      analysisSummaryRef.current?.focus();
                    }}
                    isDisabled={isBusy}
                  >
                    <ClipboardCheck aria-hidden="true" size={15} />
                    <FormattedMessage id="draft.reviewChange" />
                  </Button>
                )}
              </div>
              <div
                id="analysis-actions-details"
                className={styles.draftContent}
                hidden={!analysisDetailsOpen}
              >
                {!showSaveRecord &&
                  record?.itemType === 'analysis' &&
                  scratch.origin.kind === 'inventory_anchor' &&
                  scratch.cursor === scratch.steps.length &&
                  scratch.steps.length > 0 && (
                    <div className={styles.saveChoice}>
                      <Button
                        className={styles.primaryButton!}
                        onPress={() =>
                          void store.promoteAnalysisToInventoryRevision(
                            'add_variation',
                          )
                        }
                        isDisabled={isBusy}
                      >
                        <GitBranchPlus aria-hidden="true" size={16} />
                        <FormattedMessage id="inventory.mode.add_variation" />
                      </Button>
                      <Button
                        className={styles.primaryButton!}
                        onPress={() =>
                          void store.promoteAnalysisToInventoryRevision()
                        }
                        isDisabled={isBusy}
                      >
                        <GitBranch aria-hidden="true" size={16} />
                        <FormattedMessage
                          id={
                            explorationStartsAtLineEnd
                              ? 'inventory.mode.extend'
                              : 'analysis.replaceMainLine'
                          }
                        />
                      </Button>
                    </div>
                  )}
                {!showSaveRecord &&
                  scratch.origin.kind === 'inventory_anchor' &&
                  scratch.cursor > 0 && (
                    <div className={styles.saveChoice}>
                      <strong className={styles.saveHeading}>
                        <FormattedMessage id="analysis.saveAsNote" />
                      </strong>
                      <Button
                        className={`${styles.primaryButton!} ${styles.noteAction!}`}
                        onPress={() => {
                          setShowSaveRecord(false);
                          void store.prepareAnalysisNote(
                            formatMoveSequence(
                              scratch.steps.slice(0, scratch.cursor),
                              state.preferences.uiLocale,
                            ),
                          );
                        }}
                        isDisabled={isBusy}
                      >
                        <ArrowLeft aria-hidden="true" size={16} />
                        <FormattedMessage id="analysis.prepareNote" />
                      </Button>
                    </div>
                  )}

                {!showSaveRecord && (
                  <Button
                    className={styles.primaryButton!}
                    onPress={() => setShowSaveRecord(true)}
                    isDisabled={isBusy}
                  >
                    <Save aria-hidden="true" size={16} />
                    <FormattedMessage id="analysis.saveAsRecord" />
                  </Button>
                )}

                {showSaveRecord && (
                  <form className={styles.saveForm} onSubmit={saveRecord}>
                    <strong>
                      <FormattedMessage id="analysis.saveAsRecord" />
                    </strong>
                    <label htmlFor="analysis-title">
                      <FormattedMessage id="analysis.recordTitle" />
                    </label>
                    <input
                      id="analysis-title"
                      value={recordTitle}
                      onChange={(event) => setRecordTitle(event.target.value)}
                      autoFocus
                      disabled={isBusy}
                    />
                    <InventoryNameSuggestion
                      name={recordTitle}
                      store={store}
                      onChoose={setRecordTitle}
                      disabled={isBusy}
                    />
                    <InventoryFolderField
                      state={state}
                      value={recordFolderId}
                      onChange={setRecordFolderId}
                      contextOnly={destination === 'context'}
                      canInherit={scratch.origin.kind === 'inventory_anchor'}
                      disabled={isBusy}
                    />
                    {scratch.cursor > 0 && (
                      <>
                        <label htmlFor="analysis-record-note">
                          <FormattedMessage id="analysis.recordNote" />
                        </label>
                        <textarea
                          id="analysis-record-note"
                          value={recordNoteBody}
                          onChange={(event) =>
                            setRecordNoteBody(event.target.value)
                          }
                          rows={3}
                          disabled={isBusy}
                          placeholder={intl.formatMessage({
                            id: 'analysis.recordNotePlaceholder',
                          })}
                        />
                      </>
                    )}
                    {state.scope.kind === 'context' && (
                      <RadioGroup
                        className={styles.destinationGroup!}
                        value={destination}
                        onChange={(value) => {
                          const next = value as 'inventory' | 'context';
                          updateRecordForm({
                            destination: next,
                            noteScope:
                              next === 'context' ? 'context' : 'global',
                          });
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
                            values={{
                              context: state.analysis.contextName,
                            }}
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
                    <div className={styles.previewActions}>
                      <Button
                        className={styles.secondaryButton!}
                        onPress={cancelSaveRecord}
                        isDisabled={isBusy}
                      >
                        <X aria-hidden="true" size={16} />
                        <FormattedMessage id="analysis.cancel" />
                      </Button>
                      <button
                        type="submit"
                        className={styles.primaryButton}
                        disabled={isBusy || recordTitle.trim() === ''}
                      >
                        <Save aria-hidden="true" size={16} />
                        <FormattedMessage id="analysis.saveAsAnalysis" />
                      </button>
                    </div>
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
              </div>
            </section>
          )}
      </div>
    );
  }

  return (
    <main className={styles.analysisView}>
      <header className={styles.viewHeader}>
        <div>
          {record !== undefined && (
            <span className={styles.eyebrow}>
              <InventoryTypeIcon itemType={record.itemType} size={12} />
              <FormattedMessage id={`itemType.${record.itemType}`} />
            </span>
          )}
          <h1>
            {record?.displayName ?? <FormattedMessage id="activity.analyze" />}
          </h1>
          {record?.game !== undefined && gameResult !== undefined && (
            <p
              className={styles.gameMetadata}
              title={record.game.policy.providerFingerprint}
            >
              <FormattedMessage
                id="playout.recordMetadata"
                values={{
                  player: intl.formatMessage({
                    id: `side.${record.game.playerSide}`,
                  }),
                  result: gameResult,
                  provider: record.game.policy.providerDisplayName,
                  providerType: record.game.policy.providerType,
                  policy: intl.formatMessage({
                    id: `playout.policy.${record.game.policy.capability}`,
                  }),
                }}
              />
            </p>
          )}
        </div>
        <div className={styles.headerActions}>
          {(record !== undefined || scratch !== undefined) && (
            <span className={styles.headerStatus}>
              {scratch === undefined ? (
                <FormattedMessage id="analysis.savedPosition" />
              ) : (
                <FormattedMessage
                  id="analysis.scratchRevision"
                  values={{ revision: scratch.scratchRevision }}
                />
              )}
            </span>
          )}
          <Button
            className={styles.primaryButton!}
            isDisabled={isBusy || !atWorkspacePosition}
            onPress={() => store.openPlayoutFromCurrentAnalysis()}
          >
            <Play aria-hidden="true" size={15} />
            <FormattedMessage id="activity.playout" />
          </Button>
        </div>
      </header>

      {unavailableNoteDrafts.map((draft, index) => (
        <section
          className={styles.inlineNoteEditor}
          key={`${draft.targetKey}:${draft.kind}:${draft.kind === 'edit' ? draft.contributionId + ':' + draft.contributionVersion : ''}`}
        >
          <p role="status">
            <FormattedMessage id="analysis.noteDraftUnavailable" />
          </p>
          <div className={styles.inlineNoteForm}>
            <label htmlFor={`recovered-note-${index}`}>
              <FormattedMessage id="analysis.recoveredNoteDraft" />
            </label>
            <textarea
              id={`recovered-note-${index}`}
              value={draft.body}
              readOnly
              rows={3}
            />
            <Button
              className={styles.cancelNoteButton!}
              onPress={() => {
                store.discardAnalysisNoteForm(state.scope, noteOwner, draft);
                setNoteEditorState(
                  store.getActiveAnalysisNoteForm(state.scope, noteOwner),
                );
                setNoteDraftVersion((version) => version + 1);
              }}
              isDisabled={isBusy}
            >
              <Trash2 aria-hidden="true" size={14} />
              <FormattedMessage id="analysis.discardNoteDraft" />
            </Button>
          </div>
        </section>
      ))}

      {state.analysisUnavailable !== undefined && (
        <section
          className={styles.revisionNotice}
          aria-labelledby="analysis-unavailable-title"
          role="status"
        >
          <AlertTriangle aria-hidden="true" size={19} />
          <div>
            <strong id="analysis-unavailable-title">
              <FormattedMessage
                id={
                  state.analysisUnavailable.reason === 'deleted_from_inventory'
                    ? 'analysis.deletedFromInventory'
                    : 'analysis.removedFromContext'
                }
              />
            </strong>
            <p>
              <FormattedMessage
                id={
                  state.analysisUnavailable.reason === 'deleted_from_inventory'
                    ? 'analysis.deletedFromInventoryDetail'
                    : 'analysis.removedFromContextDetail'
                }
                values={{ name: state.analysisUnavailable.displayName }}
              />
            </p>
          </div>
          <Button
            className={styles.impactButton!}
            onPress={() => store.setActivity('manage')}
            isDisabled={isBusy}
          >
            <FormattedMessage id="activity.manage" />
            <ArrowRight aria-hidden="true" size={15} />
          </Button>
        </section>
      )}

      {pendingRevisionImpact !== undefined && (
        <section
          className={styles.revisionNotice}
          aria-labelledby="pending-revision-title"
        >
          <RefreshCw aria-hidden="true" size={19} />
          <div>
            <strong id="pending-revision-title">
              <FormattedMessage id="revisionImpact.available" />
            </strong>
            <p>
              <FormattedMessage
                id="analysis.pendingRevisionDetail"
                values={{ revision: record?.revisionNumber }}
              />
            </p>
          </div>
          <Button
            className={styles.impactButton!}
            onPress={() =>
              void store.openRevisionImpact(pendingRevisionImpact.impactId)
            }
            isDisabled={isBusy}
          >
            <FormattedMessage id="revisionImpact.review" />
            <ArrowRight aria-hidden="true" size={15} />
          </Button>
        </section>
      )}

      <div className={styles.workspaceGrid}>
        <ChessBoard
          workspace={displayedAnalysis}
          locale={state.preferences.uiLocale}
          isBusy={isBusy}
          canMove={
            !navigationLocked &&
            atWorkspacePosition &&
            (canStartAnalysisPath ||
              canAnalyzeRecord ||
              (scratch !== undefined &&
                state.analysis.allowedActions.includes('apply_move')))
          }
          {...(canTakeBackLastMove && lastEditableEntry !== undefined
            ? { undoMove: lastEditableEntry.move }
            : {})}
          onMove={(from, to, promotion) =>
            void store.applyBoardMove(from, to, promotion)
          }
          onTakeBack={() => void store.takeBackLastMove()}
        />

        <AnalysisPanelLayout
          engine={
            positionAnalysisFocus !== undefined && canAnalyzePosition ? (
              <PositionAnalysisPanel
                focus={positionAnalysisFocus}
                work={positionAnalysisWork}
                locale={state.preferences.uiLocale}
                providers={state.analysisProviders}
                store={store}
                stretch
              />
            ) : undefined
          }
        >
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
                  store.canWorkWithInventoryItem(lineStartNoteTarget.itemId) &&
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

            <div
              ref={moveListRef}
              className={styles.lineContent}
              role="region"
              tabIndex={0}
              aria-label={intl.formatMessage({ id: 'analysis.moveList' })}
            >
              <ol
                className={styles.moveList}
                aria-label={intl.formatMessage({ id: 'analysis.moveList' })}
              >
                {path.hasSourcePrefix && path.sourceItemType !== undefined && (
                  <li className={styles.sourceLineLabel}>
                    <Button
                      className={styles.sourceLineButton!}
                      onPress={() => {
                        if (path.sourceOriginTarget !== undefined)
                          void store.openAnalysisTarget(
                            path.sourceOriginTarget,
                          );
                      }}
                      isDisabled={
                        navigationLocked ||
                        scratch !== undefined ||
                        path.sourceOriginTarget === undefined ||
                        !store.canWorkWithInventoryItem(
                          path.sourceOriginTarget.itemId,
                        )
                      }
                    >
                      <span className={styles.sourceIdentity}>
                        <InventoryTypeIcon
                          itemType={path.sourceItemType}
                          size={13}
                        />
                        <span className={styles.sourceIdentityText}>
                          <FormattedMessage
                            id="analysis.sourceLine"
                            values={{
                              type: intl.formatMessage({
                                id: `itemType.${path.sourceItemType}`,
                              }),
                              source: path.sourceDisplayName,
                            }}
                          />
                        </span>
                      </span>
                      <ArrowRight aria-hidden="true" size={13} />
                    </Button>
                  </li>
                )}
                {renderInlineNotes(lineStartNoteTarget, 'line-start-notes')}
                {renderMoveRows(sourceEntries, 'source')}
                {path.hasSourcePrefix && record !== undefined && (
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
                            selectPathPosition(
                              path.analysisOriginPositionIndex,
                            );
                        }}
                        isDisabled={
                          navigationLocked ||
                          path.analysisOriginPositionIndex === undefined
                        }
                      >
                        <InventoryTypeIcon
                          itemType={record.itemType}
                          size={14}
                        />
                        <FormattedMessage
                          id={
                            record.itemType === 'game'
                              ? 'analysis.gameOrigin'
                              : 'analysis.analysisOrigin'
                          }
                        />
                      </Button>
                      {path.recordRootTarget !== undefined &&
                        canChangeNotes &&
                        pathNoteDraft === undefined && (
                          <Button
                            className={styles.addNoteButton!}
                            aria-label={intl.formatMessage({
                              id: 'analysis.addNote',
                            })}
                            onPress={() =>
                              startCreateNote(path.recordRootTarget!)
                            }
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
                {record === undefined ? (
                  renderMoveRows(storedEntries, 'stored')
                ) : (
                  <li>
                    <ChessTreeMoveList
                      record={record}
                      anchorId={record.currentAnchorId}
                      disabled={navigationLocked || scratch !== undefined}
                      onSelect={(anchorId) =>
                        void store.openRecordAnchor(anchorId)
                      }
                      renderSteps={renderTreeSteps}
                      {...(canAnalyzeRecord && record.itemType === 'analysis'
                        ? {
                            onRemoveVariation: (anchorId: string) =>
                              void store.removeAnalysisVariation(anchorId),
                          }
                        : {})}
                      {...(inlineScratchAnchor === undefined
                        ? {}
                        : {
                            draft: {
                              anchorId: inlineScratchAnchor,
                              content: renderScratchMoves(),
                            },
                          })}
                    />
                  </li>
                )}
                {inlineScratchAnchor === undefined && renderScratchMoves()}
              </ol>

              {inlineScratchAnchor === undefined && renderPathActions()}
            </div>
          </section>
        </AnalysisPanelLayout>
      </div>
      {state.revisionImpact !== undefined && (
        <RevisionImpactView
          details={state.revisionImpact}
          store={store}
          isBusy={state.busyCommand !== undefined}
        />
      )}
    </main>
  );
}

function targetKey(target: AnalysisNoteTarget): string {
  return `${target.itemId}:${target.revisionId}:${target.anchorId}`;
}
