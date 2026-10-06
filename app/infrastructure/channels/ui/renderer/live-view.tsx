import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Flag,
  Handshake,
  Radio,
  RefreshCw,
  Save,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import {
  Button,
  Dialog,
  Modal,
  ModalOverlay,
  Switch,
} from 'react-aria-components';
import { FormattedMessage, useIntl } from 'react-intl';
import type {
  AnalysisWorkspaceDto,
  LiveStateDto,
} from '../../host_client/index.ts';
import { ChessBoard } from './chess-board.tsx';
import { ErrorNotice } from './error-notice.tsx';
import {
  InventoryFolderField,
  InventoryNameSuggestion,
} from './inventory-save-fields.tsx';
import { inventoryDefaultFolder } from './inventory-folder-presentation.ts';
import { AnalysisPanelLayout } from './analysis-panel-layout.tsx';
import { PositionAnalysisPanel } from './position-analysis-panel.tsx';
import { playoutMoveRows } from './playout-presentation.ts';
import { liveClockDisplay } from './live-clock-presentation.ts';
import type {
  PlysmithApplicationState,
  PlysmithApplicationStore,
} from './plysmith-application-store.ts';
import styles from './playout-view.module.css';
import liveStyles from './live-view.module.css';

type ReadyState = Extract<PlysmithApplicationState, { phase: 'ready' }>;
type Session = NonNullable<LiveStateDto['session']>;

function playerLabel(name: string, rating: number | undefined): string {
  return rating === undefined ? name : `${name} (${rating})`;
}

export function LiveView({
  state,
  store,
}: {
  readonly state: ReadyState;
  readonly store: PlysmithApplicationStore;
}) {
  const intl = useIntl();
  const [url, setUrl] = useState('');
  const live = state.live;
  const busy = state.busyCommand !== undefined;
  return (
    <main className={styles.playoutView}>
      <header className={`${styles.viewHeader} ${liveStyles.header}`}>
        <h1>
          <FormattedMessage id="live.title" />
        </h1>
        <span role="status">
          <FormattedMessage
            id={`live.connection.${live?.connection ?? 'connecting'}`}
          />
          {live?.accountName && ` · ${live.accountName}`}
        </span>
        {live?.configured && (
          <Switch
            className={liveStyles.connectionSwitch!}
            aria-label={intl.formatMessage({ id: 'live.connectionMode' })}
            isSelected={live.online}
            isDisabled={busy}
            onChange={(online) =>
              void (online
                ? store.refreshLiveGame()
                : store.disconnectLiveGame())
            }
          >
            <span className={liveStyles.switchTrack} aria-hidden="true">
              <span />
            </span>
            <FormattedMessage
              id={live.online ? 'live.online' : 'live.offline'}
            />
          </Switch>
        )}
      </header>
      {live?.problemCode && <ErrorNotice errorCode={live.problemCode} />}
      {live?.configured === false ? (
        <Button
          className={styles.secondaryButton!}
          onPress={() => store.setActivity('settings')}
        >
          <Settings size={16} aria-hidden="true" />
          <FormattedMessage id="live.configure" />
        </Button>
      ) : (
        <>
          <LiveGames state={state} store={store} />
          {live?.online &&
            live?.session === undefined &&
            live?.connection === 'failed' && (
              <Button
                className={styles.secondaryButton!}
                isDisabled={busy}
                onPress={() => void store.refreshLiveGame()}
              >
                <RefreshCw size={16} aria-hidden="true" />
                <FormattedMessage id="live.refresh" />
              </Button>
            )}
          {live?.session === undefined && live?.connection === 'connected' && (
            <form
              className={liveStyles.urlForm}
              onSubmit={(event) => {
                event.preventDefault();
                void store.observeLiveGame(url.trim());
              }}
            >
              <label htmlFor="live-game-url">
                <FormattedMessage id="live.url" />
              </label>
              <input
                id="live-game-url"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                required
                maxLength={256}
                disabled={busy}
                autoComplete="off"
              />
              <Button
                className={styles.primaryButton!}
                type="submit"
                isDisabled={
                  busy || live?.connection !== 'connected' || !url.trim()
                }
              >
                <Radio size={16} aria-hidden="true" />
                <FormattedMessage id="live.observe" />
              </Button>
            </form>
          )}
        </>
      )}
      {live?.session !== undefined && (
        <LiveSession
          key={live.session.gameId}
          state={state}
          store={store}
          session={live.session}
        />
      )}
    </main>
  );
}

export function LiveGames({
  state,
  store,
}: {
  readonly state: ReadyState;
  readonly store: PlysmithApplicationStore;
}) {
  return (
    <div className={liveStyles.games} aria-live="polite">
      {state.live?.games.map((game) => (
        <div className={liveStyles.game} key={game.gameId}>
          <div>
            <strong>
              <FormattedMessage id="live.gameStarted" />
            </strong>
            <span>{playerLabel(game.displayName, game.opponentRating)}</span>
          </div>
          {game.standard && game.boardCompatible ? (
            <Button
              className={styles.secondaryButton!}
              isDisabled={
                state.busyCommand !== undefined ||
                state.live?.connection !== 'connected'
              }
              onPress={() => void store.playLiveGame(game.gameId)}
            >
              <ArrowRight aria-hidden="true" size={16} />
              <FormattedMessage id="live.play" />
            </Button>
          ) : (
            <span>
              <FormattedMessage id="live.browserOnly" />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function LiveSession({
  state,
  store,
  session,
}: {
  readonly state: ReadyState;
  readonly store: PlysmithApplicationStore;
  readonly session: Session;
}) {
  const intl = useIntl();
  const activeMove = useRef<HTMLDivElement>(null);
  const [confirmAction, setConfirmAction] = useState<'resign' | 'abort'>();
  const busy = state.busyCommand !== undefined;
  const canReview = session.role === 'observe' || session.status === 'ended';
  const canMove =
    session.role === 'play' &&
    session.status === 'ongoing' &&
    session.connected &&
    !session.pendingMove &&
    session.current.position.sideToMove === session.playerSide;
  const workspace: AnalysisWorkspaceDto = {
    scope: state.scope,
    dataRevision: state.status.persistence.dataRevision,
    currentState: session.current,
    scratchHasChanges: false,
    allowedActions: [],
    legalMoves: canMove ? session.legalMoves : [],
  };
  const rows = playoutMoveRows(
    session.root,
    session.steps,
    state.preferences.uiLocale,
  );
  const opponentDraw =
    session.playerSide === 'white'
      ? session.blackDrawOffer
      : session.whiteDrawOffer;
  const ownDraw =
    session.playerSide === 'white'
      ? session.whiteDrawOffer
      : session.blackDrawOffer;
  useEffect(() => {
    activeMove.current?.scrollIntoView({ block: 'nearest' });
  }, [session.selectedPly]);
  const engine =
    state.live?.fairPlayBlocked === false &&
    session.focus !== undefined &&
    (session.role === 'observe' || session.status === 'ended') ? (
      <PositionAnalysisPanel
        focus={session.focus}
        work={{
          kind: 'live',
          revision: session.analysisRevision,
          ply: session.selectedPly,
        }}
        locale={state.preferences.uiLocale}
        providers={state.analysisProviders}
        store={store}
        stretch
      />
    ) : undefined;
  function moveCell(
    move: { readonly notation: string; readonly ply: number } | undefined,
  ) {
    if (move === undefined) return <span />;
    const current = move.ply === session.selectedPly;
    return (
      <div ref={current ? activeMove : undefined}>
        {canReview ? (
          <Button
            className={`${styles.moveButton} ${current ? styles.currentMove : ''}`}
            aria-current={current ? 'step' : false}
            isDisabled={busy}
            onPress={() => void store.selectLivePosition(move.ply)}
          >
            {move.notation}
          </Button>
        ) : (
          <span
            className={`${styles.moveButton} ${current ? styles.currentMove : ''}`}
          >
            {move.notation}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className={`${styles.workspaceGrid} ${liveStyles.workspace}`}>
      <ChessBoard
        workspace={workspace}
        locale={state.preferences.uiLocale}
        isBusy={busy}
        canMove={canMove}
        initialOrientation={session.playerSide ?? 'white'}
        onMove={(from, to, promotion) =>
          void store.submitLiveMove(from, to, promotion)
        }
      />
      <AnalysisPanelLayout engine={engine}>
        <div className={liveStyles.sessionPane}>
          <section className={styles.sidePanel}>
            <div className={styles.panelHeading}>
              <h2>
                {playerLabel(session.white.name, session.white.rating)} –{' '}
                {playerLabel(session.black.name, session.black.rating)}
              </h2>
              <span className={styles.statusBadge}>
                <FormattedMessage id={`live.${session.status}`} />
              </span>
            </div>
            <LiveClocks session={session} />
            {state.live?.online &&
              !session.connected &&
              session.status !== 'ended' && (
                <p className={liveStyles.status} role="status">
                  <FormattedMessage id="live.disconnected" />
                </p>
              )}
            {session.pendingMove && (
              <p className={liveStyles.status} role="status">
                <FormattedMessage id="live.pendingMove" />
              </p>
            )}
            {session.problemCode && (
              <ErrorNotice
                className={liveStyles.status}
                errorCode={session.problemCode}
              />
            )}
            <div className={liveStyles.navigation}>
              {canReview ? (
                <Button
                  className={styles.rootMove!}
                  isDisabled={busy}
                  onPress={() => void store.selectLivePosition(0)}
                >
                  <FormattedMessage id="analysis.path" />
                </Button>
              ) : (
                <span>
                  <FormattedMessage id="playout.moves" />
                </span>
              )}
              {canReview && (
                <>
                  <Button
                    className={styles.secondaryButton!}
                    aria-label={intl.formatMessage({
                      id: 'analysis.previousMove',
                    })}
                    isDisabled={busy || session.selectedPly === 0}
                    onPress={() =>
                      void store.selectLivePosition(session.selectedPly - 1)
                    }
                  >
                    <ChevronLeft size={18} />
                  </Button>
                  <Button
                    className={styles.secondaryButton!}
                    aria-label={intl.formatMessage({ id: 'analysis.nextMove' })}
                    isDisabled={
                      busy || session.selectedPly >= session.steps.length
                    }
                    onPress={() =>
                      void store.selectLivePosition(session.selectedPly + 1)
                    }
                  >
                    <ChevronRight size={18} />
                  </Button>
                </>
              )}
            </div>
            <div
              className={styles.moveList}
              tabIndex={0}
              aria-label={intl.formatMessage({ id: 'playout.moves' })}
            >
              {rows.map((row) => (
                <div key={row.moveNumber} className={styles.moveRow}>
                  <span>
                    {row.moveNumber}
                    {row.white ? '.' : '…'}
                  </span>
                  {moveCell(row.white)}
                  {moveCell(row.black)}
                </div>
              ))}
            </div>
            {session.status !== 'ended' && (
              <div className={styles.runningActions}>
                {session.role === 'play' && session.status === 'ongoing' && (
                  <>
                    {opponentDraw ? (
                      <>
                        <Button
                          className={styles.secondaryButton!}
                          isDisabled={busy || !session.connected}
                          onPress={() => void store.actLiveGame('accept_draw')}
                        >
                          <Handshake size={16} />
                          <FormattedMessage id="live.accept_draw" />
                        </Button>
                        <Button
                          className={styles.secondaryButton!}
                          isDisabled={busy || !session.connected}
                          onPress={() => void store.actLiveGame('decline_draw')}
                        >
                          <X size={16} />
                          <FormattedMessage id="live.decline_draw" />
                        </Button>
                      </>
                    ) : (
                      <Button
                        className={styles.secondaryButton!}
                        isDisabled={
                          busy || !session.connected || ownDraw === true
                        }
                        onPress={() => void store.actLiveGame('offer_draw')}
                      >
                        <Handshake size={16} />
                        <FormattedMessage
                          id={ownDraw ? 'live.drawOffered' : 'live.offer_draw'}
                        />
                      </Button>
                    )}
                    {session.steps.length < 2 && (
                      <Button
                        className={styles.secondaryButton!}
                        isDisabled={busy || !session.connected}
                        onPress={() => setConfirmAction('abort')}
                      >
                        <X size={16} />
                        <FormattedMessage id="live.abort" />
                      </Button>
                    )}
                    <Button
                      className={styles.dangerButton!}
                      isDisabled={busy || !session.connected}
                      onPress={() => setConfirmAction('resign')}
                    >
                      <Flag size={16} />
                      <FormattedMessage id="live.resign" />
                    </Button>
                  </>
                )}
                {state.live?.online &&
                  (!session.connected ||
                    session.problemCode !== undefined ||
                    session.pendingMove) && (
                    <Button
                      className={styles.secondaryButton!}
                      isDisabled={busy}
                      onPress={() => void store.refreshLiveGame()}
                    >
                      <RefreshCw size={16} />
                      <FormattedMessage id="live.refresh" />
                    </Button>
                  )}
              </div>
            )}
            {session.status === 'ended' && (
              <LiveSaveForm state={state} store={store} session={session} />
            )}
            <div className={styles.runningActions}>
              <Button
                className={styles.dangerButton!}
                isDisabled={busy}
                onPress={() => store.discardLiveGame()}
              >
                <Trash2 size={16} />
                <FormattedMessage id="live.discard" />
              </Button>
            </div>
          </section>
        </div>
      </AnalysisPanelLayout>
      <ModalOverlay
        className={styles.modalOverlay!}
        isOpen={confirmAction !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(undefined);
        }}
        isDismissable={!busy}
      >
        <Modal className={styles.confirmationModal!}>
          <Dialog
            className={styles.confirmationDialog!}
            aria-labelledby="live-action-title"
          >
            <h2 id="live-action-title">
              <FormattedMessage
                id={
                  confirmAction === 'abort'
                    ? 'live.confirmAbort'
                    : 'live.confirmResign'
                }
              />
            </h2>
            <div className={styles.confirmationActions}>
              <Button
                className={styles.secondaryButton!}
                isDisabled={busy}
                onPress={() => setConfirmAction(undefined)}
              >
                <FormattedMessage id="action.cancel" />
              </Button>
              <Button
                className={styles.destructiveButton!}
                isDisabled={busy}
                onPress={() => {
                  if (confirmAction) void store.actLiveGame(confirmAction);
                  setConfirmAction(undefined);
                }}
              >
                <Flag size={16} />
                <FormattedMessage
                  id={confirmAction === 'abort' ? 'live.abort' : 'live.resign'}
                />
              </Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  );
}

function LiveSaveForm({
  state,
  store,
  session,
}: {
  readonly state: ReadyState;
  readonly store: PlysmithApplicationStore;
  readonly session: Session;
}) {
  const [name, setName] = useState(
    `${session.white.name} – ${session.black.name}`,
  );
  const [folderId, setFolderId] = useState<string | null | undefined>(() =>
    inventoryDefaultFolder(
      state.inventoryOrganization,
      state.selectedInventoryFolderId,
      state.scope.kind === 'context',
    ),
  );
  const busy = state.busyCommand !== undefined;
  return (
    <form
      className={styles.reviewActions}
      onSubmit={(event) => {
        event.preventDefault();
        void store.saveLiveGame(name.trim(), folderId ?? undefined);
      }}
    >
      <strong>
        <FormattedMessage id={`live.${session.outcome}`} />
      </strong>
      <label>
        <span>
          <FormattedMessage id="live.name" />
        </span>
        <input
          value={name}
          maxLength={160}
          required
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <InventoryNameSuggestion
        name={name}
        store={store}
        onChoose={setName}
        disabled={busy}
      />
      <InventoryFolderField
        state={state}
        value={folderId}
        onChange={setFolderId}
        contextOnly={state.scope.kind === 'context'}
        disabled={busy}
        canInherit={false}
      />
      <Button
        className={styles.primaryButton!}
        type="submit"
        isDisabled={busy || !name.trim()}
      >
        <Save size={16} />
        <FormattedMessage id="live.save" />
      </Button>
    </form>
  );
}

export function LiveNavigationDialog({
  state,
  store,
}: {
  readonly state: ReadyState;
  readonly store: PlysmithApplicationStore;
}) {
  const busy = state.busyCommand !== undefined;
  return (
    <ModalOverlay
      className={styles.modalOverlay!}
      isOpen={state.pendingLiveNavigation !== undefined}
      isDismissable={!busy}
      onOpenChange={(open) => {
        if (!open) store.cancelLiveNavigation();
      }}
    >
      <Modal className={styles.confirmationModal!}>
        <Dialog
          className={styles.confirmationDialog!}
          aria-labelledby="live-leave-title"
        >
          <div>
            <h2 id="live-leave-title">
              <FormattedMessage id="live.leave.title" />
            </h2>
            <p>
              <FormattedMessage
                id={
                  state.live?.session?.role === 'play' &&
                  state.live.session.status !== 'ended'
                    ? 'live.leave.play'
                    : 'live.leave.detail'
                }
              />
            </p>
          </div>
          <div className={styles.confirmationActions}>
            <Button
              className={styles.secondaryButton!}
              isDisabled={busy}
              onPress={() => store.cancelLiveNavigation()}
            >
              <FormattedMessage id="action.cancel" />
            </Button>
            <Button
              className={styles.destructiveButton!}
              isDisabled={busy}
              onPress={() => void store.confirmLiveNavigation()}
            >
              <Trash2 size={16} />
              <FormattedMessage id="live.discard" />
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function LiveClocks({ session }: { readonly session: Session }) {
  const [now, setNow] = useState(Date.now);
  const clocks = liveClockDisplay(session, now);
  useEffect(() => {
    if (!clocks.running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [clocks.running, session.clockUpdatedAt]);
  return (
    <>
      <p id="live-clock-caption" className={liveStyles.clockCaption}>
        <FormattedMessage
          id={clocks.running ? 'live.clockEstimate' : 'live.clockSnapshot'}
        />
      </p>
      <dl className={liveStyles.clocks} aria-labelledby="live-clock-caption">
        <div>
          <dt>
            <FormattedMessage id="side.white" />
          </dt>
          <dd>{formatClock(clocks.whiteClockMs)}</dd>
        </div>
        <div>
          <dt>
            <FormattedMessage id="side.black" />
          </dt>
          <dd>{formatClock(clocks.blackClockMs)}</dd>
        </div>
      </dl>
    </>
  );
}

function formatClock(milliseconds: number | undefined): string {
  if (milliseconds === undefined) return '–';
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
