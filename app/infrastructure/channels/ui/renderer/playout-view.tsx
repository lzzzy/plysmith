import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CircleStop,
  Pause,
  Play,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { Button, Dialog, Modal, ModalOverlay } from 'react-aria-components';
import { FormattedMessage, useIntl } from 'react-intl';

import type {
  AnalysisWorkspaceDto,
  CompletePlayoutRequestDto,
} from '../../host_client/index.ts';
import { ChessBoard } from './chess-board.tsx';
import {
  type PlysmithApplicationState,
  type PlysmithApplicationStore,
} from './plysmith-application-store.ts';
import styles from './playout-view.module.css';
import { playoutMoveRows } from './playout-presentation.ts';
import { sideName } from './chess-display.ts';
import { GameOutcomeLabel } from './game-outcome-label.tsx';

type ReadyState = Extract<PlysmithApplicationState, { phase: 'ready' }>;

interface ReviewPosition {
  readonly kind: 'source' | 'playout';
  readonly ply: number;
}

export function PlayoutView({
  state,
  store,
}: {
  readonly state: ReadyState;
  readonly store: PlysmithApplicationStore;
}) {
  const saved =
    state.completedPlayout !== undefined &&
    state.completedPlayoutView !== undefined;
  const playout =
    state.completedPlayoutView ??
    state.pendingPlayoutCompletion?.view ??
    state.playout ??
    undefined;
  const isBusy = state.busyCommand !== undefined || state.refreshing;
  const [reviewPosition, setReviewPosition] = useState<ReviewPosition>({
    kind: 'playout',
    ply: playout?.draft.steps.length ?? 0,
  });

  useEffect(
    () =>
      setReviewPosition({
        kind: 'playout',
        ply: playout?.draft.steps.length ?? 0,
      }),
    [
      playout?.draft.draftId,
      playout?.draft.draftRevision,
      playout?.draft.steps.length,
    ],
  );

  if (playout === undefined) {
    return (
      <main className={styles.playoutView}>
        <ViewHeader />
        {state.playoutStart !== undefined ? (
          <PrestartWorkspace state={state} store={store} isBusy={isBusy} />
        ) : (
          <PreparingPanel />
        )}
      </main>
    );
  }

  const draft = playout.draft;

  const atCurrentPosition =
    reviewPosition.kind === 'playout' &&
    reviewPosition.ply === draft.steps.length;
  const currentState = stateAtReviewPosition(
    draft.sourcePath,
    draft.root,
    draft.steps,
    reviewPosition,
  );
  const workspace: AnalysisWorkspaceDto = {
    scope: state.scope,
    dataRevision: playout.dataRevision,
    currentState,
    legalMoves: atCurrentPosition ? playout.legalMoves : [],
    allowedActions: [],
  };
  const userTurn =
    currentState.position.sideToMove === draft.playerSide &&
    draft.status.kind === 'active';

  return (
    <main className={styles.playoutView}>
      <ViewHeader />
      <div className={styles.workspaceGrid}>
        <ChessBoard
          workspace={workspace}
          locale={state.preferences.uiLocale}
          isBusy={isBusy}
          canMove={atCurrentPosition && userTurn}
          initialOrientation={draft.playerSide}
          onMove={(from, to, promotion) =>
            void store.submitPlayoutMove(from, to, promotion)
          }
        />
        <section
          className={styles.sidePanel}
          aria-labelledby="playout-line-title"
        >
          <div className={styles.panelHeading}>
            <div>
              <span className={styles.eyebrow}>
                <FormattedMessage id="playout.game" />
              </span>
              <h2 id="playout-line-title">
                {saved ? (
                  state.completedPlayout?.displayName
                ) : (
                  <FormattedMessage id="playout.moves" />
                )}
              </h2>
            </div>
            <StatusBadge
              status={draft.status.kind}
              busy={isBusy}
              saved={saved}
            />
          </div>
          <MoveList
            {...(draft.sourcePath === undefined
              ? {}
              : { sourcePath: draft.sourcePath })}
            root={draft.root}
            steps={draft.steps}
            locale={state.preferences.uiLocale}
            reviewPosition={reviewPosition}
            onSelect={setReviewPosition}
          />
          <div className={styles.providerLine}>
            <span>
              <FormattedMessage id="playout.opponent" />
            </span>
            <strong>{draft.policy.providerDisplayName}</strong>
          </div>
          {saved && (
            <dl className={styles.gameFacts}>
              <div>
                <dt>
                  <FormattedMessage id="inventory.content.playerSide" />
                </dt>
                <dd>
                  {sideName(draft.playerSide, state.preferences.uiLocale)}
                </dd>
              </div>
              {state.completedPlayout !== undefined && (
                <div>
                  <dt>
                    <FormattedMessage id="inventory.content.outcome" />
                  </dt>
                  <dd>
                    <GameOutcomeLabel
                      outcome={state.completedPlayout.outcome}
                    />
                  </dd>
                </div>
              )}
              {state.completedPlayout !== undefined && (
                <div>
                  <dt>
                    <FormattedMessage id="playout.resultSource" />
                  </dt>
                  <dd>
                    <FormattedMessage
                      id={`playout.resultSource.${state.completedPlayout.outcomeSource}`}
                    />
                  </dd>
                </div>
              )}
            </dl>
          )}
          <PlayoutActions
            key={draft.draftId}
            state={state}
            store={store}
            draft={draft}
            saved={saved}
            isBusy={isBusy}
            atCurrentPosition={atCurrentPosition}
            onReturnToGame={() =>
              setReviewPosition({ kind: 'playout', ply: draft.steps.length })
            }
          />
        </section>
      </div>
    </main>
  );
}

export function PlayoutReplacementDialog({
  state,
  store,
}: {
  readonly state: ReadyState;
  readonly store: PlysmithApplicationStore;
}) {
  const pending = state.pendingPlayoutStart;
  if (pending === undefined) return null;
  const isBusy = state.busyCommand !== undefined || state.refreshing;
  return (
    <ModalOverlay
      className={styles.modalOverlay!}
      isOpen
      isDismissable={!isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) store.cancelPendingPlayoutStart();
      }}
    >
      <Modal className={styles.confirmationModal!}>
        <Dialog
          className={styles.confirmationDialog!}
          aria-labelledby="replace-playout-title"
        >
          <div>
            <h2 id="replace-playout-title">
              <FormattedMessage id="playout.replace.title" />
            </h2>
            <p>
              <FormattedMessage
                id={
                  pending.start.kind === 'initial_position'
                    ? 'playout.replace.initialDetail'
                    : 'playout.replace.detail'
                }
                values={{ source: pending.title }}
              />
            </p>
          </div>
          <div className={styles.confirmationActions}>
            <Button
              className={styles.secondaryButton!}
              isDisabled={isBusy}
              onPress={() => store.cancelPendingPlayoutStart()}
            >
              <FormattedMessage id="action.cancel" />
            </Button>
            <Button
              className={styles.destructiveButton!}
              isDisabled={isBusy}
              onPress={() => void store.discardPlayoutAndOpenPending()}
            >
              <Trash2 aria-hidden="true" size={16} />
              <FormattedMessage
                id={
                  pending.start.kind === 'initial_position'
                    ? 'playout.replace.initialConfirm'
                    : 'playout.replace.confirm'
                }
              />
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function ViewHeader() {
  return (
    <header className={styles.viewHeader}>
      <div>
        <h1>
          <FormattedMessage id="playout.title" />
        </h1>
      </div>
    </header>
  );
}

function PrestartWorkspace({
  state,
  store,
  isBusy,
}: {
  readonly state: ReadyState;
  readonly store: PlysmithApplicationStore;
  readonly isBusy: boolean;
}) {
  const available = state.playoutProviders.providers.filter(
    (provider) =>
      provider.status === 'available' &&
      provider.capabilities.some(
        (capability) =>
          capability === 'best_move' || capability === 'human_profile',
      ),
  );
  const [providerId, setProviderId] = useState(available[0]?.instanceId ?? '');
  const [reviewPosition, setReviewPosition] = useState<ReviewPosition>({
    kind: 'playout',
    ply: 0,
  });

  useEffect(() => {
    if (!available.some((provider) => provider.instanceId === providerId)) {
      setProviderId(available[0]?.instanceId ?? '');
    }
  }, [available, providerId]);

  const selection = state.playoutStart!;
  const atStartPosition =
    reviewPosition.kind === 'playout' && reviewPosition.ply === 0;
  const workspace: AnalysisWorkspaceDto = {
    ...selection.workspace,
    currentState: stateAtReviewPosition(
      selection.sourcePath,
      selection.workspace.currentState,
      [],
      reviewPosition,
    ),
    legalMoves: atStartPosition ? selection.workspace.legalMoves : [],
    allowedActions: [],
  };
  const canStart = !isBusy && providerId !== '' && atStartPosition;

  return (
    <div className={styles.workspaceGrid}>
      <ChessBoard
        workspace={workspace}
        locale={state.preferences.uiLocale}
        isBusy={isBusy}
        canMove={canStart}
        initialOrientation={
          selection.workspace.currentState.position.sideToMove
        }
        onMove={(from, to, promotion) =>
          void store.startPlayoutWithMove(providerId, from, to, promotion)
        }
      />
      <section
        className={styles.sidePanel}
        aria-labelledby="playout-line-title"
      >
        <div className={styles.panelHeading}>
          <div>
            <span className={styles.eyebrow}>
              <FormattedMessage id="playout.game" />
            </span>
            <h2 id="playout-line-title">
              <FormattedMessage id="playout.moves" />
            </h2>
          </div>
          <span className={styles.statusBadge}>
            <FormattedMessage id="playout.status.ready" />
          </span>
        </div>
        <MoveList
          {...(selection.sourcePath === undefined
            ? {}
            : { sourcePath: selection.sourcePath })}
          root={selection.workspace.currentState}
          steps={[]}
          locale={state.preferences.uiLocale}
          reviewPosition={reviewPosition}
          onSelect={setReviewPosition}
        />
        <div className={styles.prestartActions}>
          <label className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>
              <FormattedMessage id="playout.chooseOpponent" />
            </span>
            <select
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
              disabled={isBusy || available.length === 0}
            >
              {available.length === 0 ? (
                <option value="">
                  <FormattedMessage id="playout.noProvider" />
                </option>
              ) : (
                available.map((provider) => (
                  <option key={provider.instanceId} value={provider.instanceId}>
                    {provider.displayName}
                  </option>
                ))
              )}
            </select>
          </label>
          {available.length === 0 && (
            <p className={styles.providerNotice}>
              <FormattedMessage id="playout.configureProvider" />
            </p>
          )}
          <Button
            className={styles.primaryButton!}
            isDisabled={!canStart}
            onPress={() => void store.letProviderStartPlayout(providerId)}
          >
            <Play aria-hidden="true" size={17} />
            <FormattedMessage id="playout.providerMovesFirst" />
          </Button>
        </div>
      </section>
    </div>
  );
}

function PreparingPanel() {
  return (
    <section className={styles.preparingPanel} role="status">
      <RefreshCw className={styles.spinning} aria-hidden="true" size={22} />
      <FormattedMessage id="playout.preparing" />
    </section>
  );
}

function MoveList({
  sourcePath,
  root,
  steps,
  locale,
  reviewPosition,
  onSelect,
}: {
  readonly sourcePath?: NonNullable<
    NonNullable<ReadyState['playout']>['draft']['sourcePath']
  >;
  readonly root: NonNullable<ReadyState['playout']>['draft']['root'];
  readonly steps: NonNullable<ReadyState['playout']>['draft']['steps'];
  readonly locale: ReadyState['preferences']['uiLocale'];
  readonly reviewPosition: ReviewPosition;
  readonly onSelect: (position: ReviewPosition) => void;
}) {
  const rows = useMemo(
    () => playoutMoveRows(root, steps, locale),
    [locale, root, steps],
  );
  const sourceRows = useMemo(
    () =>
      sourcePath === undefined
        ? []
        : playoutMoveRows(sourcePath.root, sourcePath.steps, locale),
    [locale, sourcePath],
  );
  const moveListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = moveListRef.current;
    const current = container?.querySelector<HTMLElement>(
      '[data-current-move="true"]',
    );
    if (container === null || current === null || current === undefined) return;
    const containerRect = container.getBoundingClientRect();
    const currentRect = current.getBoundingClientRect();
    if (
      currentRect.top >= containerRect.top &&
      currentRect.bottom <= containerRect.bottom
    ) {
      return;
    }
    container.scrollTop +=
      currentRect.top -
      containerRect.top -
      (container.clientHeight - current.offsetHeight) / 2;
  }, [reviewPosition, sourcePath?.steps.length, steps.length]);

  const sourceSelected = (ply: number) =>
    reviewPosition.kind === 'source' && reviewPosition.ply === ply;
  const playoutSelected = (ply: number) =>
    reviewPosition.kind === 'playout' && reviewPosition.ply === ply;

  return (
    <div className={styles.moveList} ref={moveListRef}>
      {sourcePath !== undefined && (
        <div className={styles.sourceHeading}>{sourcePath.displayName}</div>
      )}
      <Button
        className={`${styles.rootMove!} ${sourcePath === undefined ? (playoutSelected(0) ? styles.currentMove : '') : sourceSelected(0) ? styles.currentMove : ''}`}
        data-current-move={
          sourcePath === undefined ? playoutSelected(0) : sourceSelected(0)
        }
        onPress={() =>
          onSelect({
            kind: sourcePath === undefined ? 'playout' : 'source',
            ply: 0,
          })
        }
      >
        <FormattedMessage id="playout.startPosition" />
      </Button>
      {sourceRows.map((row) => (
        <div className={styles.moveRow} key={`source-${row.moveNumber}`}>
          <span>{row.moveNumber}.</span>
          {row.white === undefined ? (
            <span />
          ) : (
            <MoveButton
              kind="source"
              move={row.white}
              selected={sourceSelected(row.white.ply)}
              onSelect={onSelect}
            />
          )}
          {row.black === undefined ? (
            <span />
          ) : (
            <MoveButton
              kind="source"
              move={row.black}
              selected={sourceSelected(row.black.ply)}
              onSelect={onSelect}
            />
          )}
        </div>
      ))}
      {sourcePath !== undefined && (
        <Button
          className={`${styles.playoutBoundary!} ${playoutSelected(0) ? styles.currentMove : ''}`}
          data-current-move={playoutSelected(0)}
          onPress={() => onSelect({ kind: 'playout', ply: 0 })}
        >
          <FormattedMessage id="playout.gameStart" />
        </Button>
      )}
      {rows.map((row) => (
        <div className={styles.moveRow} key={`playout-${row.moveNumber}`}>
          <span>{row.moveNumber}.</span>
          {row.white === undefined ? (
            <span />
          ) : (
            <MoveButton
              kind="playout"
              move={row.white}
              selected={playoutSelected(row.white.ply)}
              onSelect={onSelect}
            />
          )}
          {row.black === undefined ? (
            <span />
          ) : (
            <MoveButton
              kind="playout"
              move={row.black}
              selected={playoutSelected(row.black.ply)}
              onSelect={onSelect}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function MoveButton({
  kind,
  move,
  selected,
  onSelect,
}: {
  readonly kind: ReviewPosition['kind'];
  readonly move: { readonly notation: string; readonly ply: number };
  readonly selected: boolean;
  readonly onSelect: (position: ReviewPosition) => void;
}) {
  return (
    <Button
      className={`${styles.moveButton!} ${selected ? styles.currentMove : ''}`}
      data-current-move={selected}
      onPress={() => onSelect({ kind, ply: move.ply })}
    >
      {move.notation}
    </Button>
  );
}

function stateAtReviewPosition(
  sourcePath: NonNullable<ReadyState['playout']>['draft']['sourcePath'],
  playoutRoot: NonNullable<ReadyState['playout']>['draft']['root'],
  steps: NonNullable<ReadyState['playout']>['draft']['steps'],
  position: ReviewPosition,
): NonNullable<ReadyState['playout']>['draft']['root'] {
  if (position.kind === 'source' && sourcePath !== undefined) {
    return position.ply === 0
      ? sourcePath.root
      : (sourcePath.steps[position.ply - 1]?.after ?? sourcePath.root);
  }
  return position.ply === 0
    ? playoutRoot
    : (steps[position.ply - 1]?.after ?? playoutRoot);
}

function StatusBadge({
  status,
  busy,
  saved,
}: {
  readonly status: NonNullable<
    ReadyState['playout']
  >['draft']['status']['kind'];
  readonly busy: boolean;
  readonly saved: boolean;
}) {
  return (
    <span className={styles.statusBadge} role="status">
      {busy && (
        <RefreshCw className={styles.spinning} aria-hidden="true" size={13} />
      )}
      <FormattedMessage
        id={
          saved
            ? 'playout.saved'
            : `playout.status.${busy ? 'waiting' : status}`
        }
      />
    </span>
  );
}

function PlayoutActions({
  state,
  store,
  draft,
  saved,
  isBusy,
  atCurrentPosition,
  onReturnToGame,
}: {
  readonly state: ReadyState;
  readonly store: PlysmithApplicationStore;
  readonly draft: NonNullable<ReadyState['playout']>['draft'];
  readonly saved: boolean;
  readonly isBusy: boolean;
  readonly atCurrentPosition: boolean;
  readonly onReturnToGame: () => void;
}) {
  const intl = useIntl();
  const [title, setTitle] = useState(
    state.pendingPlayoutCompletion?.request.displayName ?? '',
  );
  const [addToContext, setAddToContext] = useState(
    state.pendingPlayoutCompletion === undefined
      ? state.scope.kind === 'context'
      : state.pendingPlayoutCompletion.request.targetContextId !== undefined,
  );
  const [manualResult, setManualResult] = useState<
    NonNullable<CompletePlayoutRequestDto['manualResult']>
  >(state.pendingPlayoutCompletion?.request.manualResult ?? 'unfinished');
  const completed =
    draft.status.kind === 'stopped' || draft.status.kind === 'terminal';
  const completionPending = state.pendingPlayoutCompletion !== undefined;

  if (saved) {
    const canOpen =
      state.completedPlayout !== undefined &&
      store.canWorkWithInventoryItem(state.completedPlayout.itemId);
    return (
      <div className={styles.savedActions}>
        <Button
          className={styles.primaryButton!}
          isDisabled={isBusy}
          onPress={() =>
            canOpen
              ? void store.openCompletedPlayout()
              : store.setActivity('manage')
          }
        >
          <ArrowRight aria-hidden="true" size={16} />
          <FormattedMessage
            id={canOpen ? 'activity.analyze' : 'activity.manage'}
          />
        </Button>
      </div>
    );
  }

  if (completed) {
    return (
      <div className={styles.reviewActions}>
        <div className={styles.reviewHeading}>
          <strong>
            <FormattedMessage id="playout.review" />
          </strong>
        </div>
        <label>
          <span>
            <FormattedMessage id="playout.gameTitle" />
          </span>
          <input
            disabled={isBusy || completionPending}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            placeholder={intl.formatMessage({
              id: 'playout.gameTitlePlaceholder',
            })}
          />
        </label>
        {draft.status.kind === 'stopped' ? (
          <label>
            <span>
              <FormattedMessage id="inventory.content.outcome" />
            </span>
            <select
              value={manualResult}
              disabled={isBusy || completionPending}
              onChange={(event) =>
                setManualResult(event.target.value as typeof manualResult)
              }
            >
              <option value="unfinished">
                {intl.formatMessage({ id: 'playout.result.unfinished' })}
              </option>
              <option value="white_win">
                {intl.formatMessage(
                  { id: 'playout.result.win' },
                  { side: sideName('white', state.preferences.uiLocale) },
                )}
              </option>
              <option value="black_win">
                {intl.formatMessage(
                  { id: 'playout.result.win' },
                  { side: sideName('black', state.preferences.uiLocale) },
                )}
              </option>
              <option value="draw">
                {intl.formatMessage({ id: 'playout.result.draw' })}
              </option>
            </select>
          </label>
        ) : draft.status.kind === 'terminal' ? (
          <div className={styles.providerLine}>
            <span>
              <FormattedMessage id="inventory.content.outcome" />
            </span>
            <strong>
              <GameOutcomeLabel outcome={draft.status.outcome} />
            </strong>
          </div>
        ) : null}
        {state.scope.kind === 'context' && (
          <label className={styles.contextChoice}>
            <input
              type="checkbox"
              disabled={isBusy || completionPending}
              checked={addToContext}
              onChange={(event) => setAddToContext(event.target.checked)}
            />
            <span>
              <FormattedMessage id="playout.addToContext" />
            </span>
          </label>
        )}
        <Button
          className={styles.primaryButton!}
          isDisabled={isBusy || (!completionPending && title.trim() === '')}
          onPress={() =>
            void store.completePlayout(
              title,
              addToContext,
              draft.status.kind === 'stopped' ? manualResult : undefined,
            )
          }
        >
          <Save aria-hidden="true" size={16} />
          <FormattedMessage
            id={completionPending ? 'playout.retryCompletion' : 'playout.save'}
          />
        </Button>
        {draft.status.kind === 'stopped' && (
          <Button
            className={styles.secondaryButton!}
            isDisabled={isBusy || completionPending}
            onPress={() => void store.cancelPlayoutCompletion()}
          >
            <ArrowLeft aria-hidden="true" size={16} />
            <FormattedMessage id="playout.cancelCompletion" />
          </Button>
        )}
        <Button
          className={styles.dangerButton!}
          isDisabled={isBusy || completionPending}
          onPress={() => void store.discardPlayout()}
        >
          <Trash2 aria-hidden="true" size={16} />
          <FormattedMessage id="playout.discard" />
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.runningActions}>
      {!atCurrentPosition && (
        <Button className={styles.secondaryButton!} onPress={onReturnToGame}>
          <FormattedMessage id="playout.returnToGame" />
        </Button>
      )}
      {draft.status.kind === 'paused' ? (
        <Button
          className={styles.primaryButton!}
          isDisabled={isBusy}
          onPress={() => void store.resumePlayout()}
        >
          <Play aria-hidden="true" size={16} />
          <FormattedMessage id="playout.resume" />
        </Button>
      ) : draft.status.kind === 'awaiting_policy' ? (
        <Button
          className={styles.primaryButton!}
          isDisabled={isBusy}
          onPress={() => void store.retryPlayout()}
        >
          <RefreshCw aria-hidden="true" size={16} />
          <FormattedMessage id="playout.retry" />
        </Button>
      ) : (
        <Button
          className={styles.primaryButton!}
          isDisabled={isBusy}
          onPress={() => void store.pausePlayout()}
        >
          <Pause aria-hidden="true" size={16} />
          <FormattedMessage id="playout.pause" />
        </Button>
      )}
      <Button
        className={styles.primaryButton!}
        isDisabled={isBusy}
        onPress={() => void store.stopPlayout()}
      >
        <CircleStop aria-hidden="true" size={16} />
        <FormattedMessage id="playout.stop" />
      </Button>
    </div>
  );
}
