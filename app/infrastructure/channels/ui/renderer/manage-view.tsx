import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  ChevronDown,
  ChevronRight,
  FileSearch,
  FilePlus2,
  FolderPlus,
  Library,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  Button,
  Dialog,
  Modal,
  ModalOverlay,
  Radio,
  RadioGroup,
} from 'react-aria-components';
import { FormattedDate, FormattedMessage, useIntl } from 'react-intl';

import {
  type InventoryItem,
  type PlysmithApplicationState,
  type PlysmithApplicationStore,
} from './plysmith-application-store.ts';
import { AnalysisSetupDialog } from './analysis-setup-dialog.tsx';
import { InventoryMetadataForm } from './inventory-metadata-form.tsx';
import { InventoryTypeIcon } from './inventory-type-icon.tsx';
import { InventoryDetailsView } from './inventory-details-view.tsx';
import { ChessPieceGlyph } from './chess-board-surface.tsx';
import {
  inventoryFamilyPresentation,
  type InventoryFamilyNode,
} from './inventory-family-presentation.ts';
import styles from './manage-view.module.css';
import { RevisionImpactResolutionPanel } from './revision-impact-view.tsx';
import { RevisionLineComparison } from './revision-line-comparison.tsx';
import { RevisionFollowingContexts } from './revision-following-contexts.tsx';
import { LossSummary, contextRemovalSummary } from './loss-summary.tsx';

type ReadyState = Extract<PlysmithApplicationState, { phase: 'ready' }>;
type RevisionImpactSummary = NonNullable<
  ReadyState['contextWorkspace']
>['pendingRevisionImpacts'][number];

export function ManageView({
  state,
  store,
}: {
  readonly state: ReadyState;
  readonly store: PlysmithApplicationStore;
}) {
  const intl = useIntl();
  const [query, setQuery] = useState(state.inventoryQuery);
  const [showCreateContext, setShowCreateContext] = useState(false);
  const [analysisStart, setAnalysisStart] = useState<'initial' | 'setup'>();
  const [collapsedFamilies, setCollapsedFamilies] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const visibleItems = state.inventory.items.map((item) =>
    inventoryItemForScope(item, state),
  );
  const selectedItem = visibleItems.find(
    (item) => item.itemId === state.selectedInventoryItemId,
  );
  const selectedImpact =
    selectedItem === undefined
      ? undefined
      : state.contextWorkspace?.pendingRevisionImpacts.find(
          (impact) => impact.itemId === selectedItem.itemId,
        );
  const activeContextId =
    state.scope.kind === 'context' ? state.scope.contextId : undefined;
  const activeContext = state.contexts.contexts.find(
    (context) => context.contextId === activeContextId,
  );
  const families = inventoryFamilyPresentation({
    ...state.inventory,
    items: visibleItems,
  });
  const emptyInventoryKind =
    state.inventoryQuery.trim().length > 0
      ? 'search'
      : state.scope.kind === 'context' && state.inventoryContextOnly
        ? 'context'
        : 'inventory';

  useEffect(() => setQuery(state.inventoryQuery), [state.inventoryQuery]);
  useEffect(() => {
    setCollapsedFamilies(new Set());
  }, [activeContextId, state.inventoryQuery, state.inventoryContextOnly]);
  useEffect(() => {
    if (selectedImpact === undefined) {
      if (state.revisionImpact !== undefined) store.closeRevisionImpact();
      return;
    }
    if (
      state.revisionImpact?.impact.impactId !== selectedImpact.impactId &&
      state.busyCommand === undefined
    ) {
      void store.openRevisionImpact(selectedImpact.impactId);
    }
  }, [
    selectedImpact?.impactId,
    state.busyCommand,
    state.revisionImpact?.impact.impactId,
    store,
  ]);

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    await store.searchInventory(query);
  }

  return (
    <main className={styles.manageView}>
      <header className={styles.viewHeader}>
        <div className={styles.headerActions}>
          <span className={styles.inventoryCount}>
            <FormattedMessage
              id="manage.resultCount"
              values={{ count: state.inventory.items.length }}
            />
          </span>
          <Button
            className={styles.primaryButton!}
            isDisabled={state.busyCommand !== undefined || state.refreshing}
            onPress={() => void store.openNewPlayout()}
          >
            <Play aria-hidden="true" size={16} />
            <FormattedMessage id="manage.newGame" />
          </Button>
          <Button
            className={styles.primaryButton!}
            isDisabled={state.busyCommand !== undefined || state.refreshing}
            onPress={() => {
              if (state.analysis.scratch !== undefined)
                setAnalysisStart('initial');
              else void store.startScratchAtInitialPosition();
            }}
          >
            <FilePlus2 aria-hidden="true" size={16} />
            <FormattedMessage id="manage.newAnalysis" />
          </Button>
          <Button
            className={styles.secondaryButton!}
            isDisabled={state.busyCommand !== undefined || state.refreshing}
            onPress={() => setAnalysisStart('setup')}
          >
            <ChessPieceGlyph className={styles.setupGlyph!} symbol="♔" />
            <FormattedMessage id="analysisSetup.buildPosition" />
          </Button>
        </div>
      </header>

      <div
        className={`${styles.manageGrid} ${selectedImpact === undefined ? '' : styles.impactLayout}`}
      >
        <aside className={styles.contextPanel} aria-labelledby="contexts-title">
          <div className={styles.panelHeading}>
            <div>
              <h2 id="contexts-title">
                <FormattedMessage id="manage.contexts" />
              </h2>
            </div>
            <Button
              className={styles.iconButton!}
              aria-label={intl.formatMessage({ id: 'manage.createContext' })}
              onPress={() => setShowCreateContext((visible) => !visible)}
            >
              {showCreateContext ? (
                <X aria-hidden="true" size={17} />
              ) : (
                <Plus aria-hidden="true" size={17} />
              )}
            </Button>
          </div>

          {showCreateContext && (
            <CreateContextForm
              isBusy={state.busyCommand !== undefined}
              onCancel={() => setShowCreateContext(false)}
              onCreate={async (request) => {
                const created = await store.createWorkingContext(request);
                if (created) setShowCreateContext(false);
                return created;
              }}
            />
          )}

          <div className={styles.contextList}>
            <Button
              className={`${styles.contextButton!} ${state.scope.kind === 'free' ? styles.activeContext : ''}`}
              onPress={() => void store.selectManagementScope({ kind: 'free' })}
            >
              <Library aria-hidden="true" size={17} />
              <span>
                <strong>
                  <FormattedMessage id="scope.free" />
                </strong>
              </span>
            </Button>
            {state.contexts.contexts.map((context) => (
              <Button
                key={context.contextId}
                className={`${styles.contextButton!} ${state.scope.kind === 'context' && state.scope.contextId === context.contextId ? styles.activeContext : ''}`}
                onPress={() =>
                  void store.selectManagementScope({
                    kind: 'context',
                    contextId: context.contextId,
                  })
                }
              >
                <Boxes aria-hidden="true" size={17} />
                <span>
                  <strong>{context.displayName}</strong>
                  <small>
                    <FormattedMessage
                      id="manage.referenceCount"
                      values={{ count: context.referenceCount }}
                    />
                  </small>
                </span>
                {context.pendingRevisionImpactCount > 0 && (
                  <span
                    className={styles.impactBadge}
                    aria-label={intl.formatMessage(
                      { id: 'revisionImpact.badge' },
                      { count: context.pendingRevisionImpactCount },
                    )}
                  >
                    {context.pendingRevisionImpactCount}
                  </span>
                )}
              </Button>
            ))}
            {state.contexts.nextCursor !== undefined && (
              <Button
                className={styles.loadMoreButton!}
                onPress={() => void store.loadMoreContexts()}
                isDisabled={state.busyCommand !== undefined}
              >
                <FormattedMessage id="manage.loadMoreContexts" />
              </Button>
            )}
          </div>
        </aside>

        <section className={styles.inventoryPanel}>
          <div className={styles.inventoryToolbar}>
            <div>
              <h1 id="inventory-title">
                {activeContext?.displayName ?? (
                  <FormattedMessage id="manage.allInventory" />
                )}
              </h1>
            </div>
            <form className={styles.searchForm} onSubmit={submitSearch}>
              <label
                className={styles.visuallyHidden}
                htmlFor="inventory-search"
              >
                <FormattedMessage id="manage.search" />
              </label>
              <Search aria-hidden="true" size={16} />
              <input
                id="inventory-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={intl.formatMessage({
                  id: 'manage.searchPlaceholder',
                })}
              />
              <button type="submit">
                <FormattedMessage id="manage.searchAction" />
              </button>
            </form>
          </div>

          {state.scope.kind === 'context' && (
            <RadioGroup
              className={styles.inventoryScope!}
              value={state.inventoryContextOnly ? 'context' : 'all'}
              onChange={(value) =>
                void store.setInventoryContextOnly(value === 'context')
              }
              orientation="horizontal"
              aria-label={intl.formatMessage({ id: 'manage.inventoryScope' })}
            >
              <Radio value="context" className={styles.scopeOption!}>
                <FormattedMessage id="manage.inContext" />
              </Radio>
              <Radio value="all" className={styles.scopeOption!}>
                <FormattedMessage id="manage.allInventory" />
              </Radio>
            </RadioGroup>
          )}

          {state.inventory.items.length === 0 ? (
            <div className={styles.emptyInventory}>
              <FileSearch aria-hidden="true" size={25} />
              <strong>
                <FormattedMessage id={`manage.empty.${emptyInventoryKind}`} />
              </strong>
              {emptyInventoryKind === 'search' && (
                <Button
                  className={styles.secondaryButton!}
                  onPress={() => {
                    setQuery('');
                    void store.searchInventory('');
                  }}
                  isDisabled={
                    state.busyCommand !== undefined || state.refreshing
                  }
                >
                  <X aria-hidden="true" size={16} />
                  <FormattedMessage id="manage.clearSearch" />
                </Button>
              )}
              {emptyInventoryKind === 'context' && (
                <Button
                  className={styles.secondaryButton!}
                  onPress={() => void store.setInventoryContextOnly(false)}
                  isDisabled={
                    state.busyCommand !== undefined || state.refreshing
                  }
                >
                  <Library aria-hidden="true" size={16} />
                  <FormattedMessage id="manage.showAllInventory" />
                </Button>
              )}
            </div>
          ) : (
            <div className={styles.inventoryList}>
              <div
                className={styles.familyViewport}
                role="region"
                aria-labelledby="inventory-title"
                tabIndex={0}
              >
                <ul className={styles.familyList}>
                  {families.map((family) => (
                    <InventoryFamily
                      key={family.item.itemId}
                      node={family}
                      depth={0}
                      state={state}
                      store={store}
                      collapsedFamilies={collapsedFamilies}
                      onToggle={(itemId) => {
                        setCollapsedFamilies((previous) => {
                          const next = new Set(previous);
                          if (next.has(itemId)) next.delete(itemId);
                          else next.add(itemId);
                          return next;
                        });
                      }}
                    />
                  ))}
                </ul>
              </div>
              {state.inventory.nextCursor !== undefined && (
                <Button
                  className={styles.loadMoreButton!}
                  onPress={() => void store.loadMoreInventory()}
                  isDisabled={state.busyCommand !== undefined}
                >
                  <FormattedMessage id="manage.loadMoreInventory" />
                </Button>
              )}
            </div>
          )}
        </section>

        <aside className={styles.inspector} aria-labelledby="inspector-title">
          <div className={styles.panelHeading}>
            <div>
              <h2 id="inspector-title">
                <FormattedMessage id="manage.details" />
              </h2>
            </div>
          </div>
          {selectedItem === undefined ? (
            <ContextSummary
              key={activeContextId ?? 'free'}
              state={state}
              store={store}
            />
          ) : (
            <ItemInspector
              item={selectedItem}
              state={state}
              store={store}
              {...(selectedImpact === undefined
                ? {}
                : { revisionImpact: selectedImpact })}
            />
          )}
        </aside>
      </div>
      {analysisStart !== undefined && (
        <AnalysisSetupDialog
          key={`${state.scope.kind === 'context' ? state.scope.contextId : 'free'}-${analysisStart}`}
          isOpen
          requestedStart={analysisStart}
          hasScratch={state.analysis.scratch !== undefined}
          isBusy={state.busyCommand !== undefined}
          store={store}
          onOpenChange={(open) => {
            if (!open) setAnalysisStart(undefined);
          }}
        />
      )}
      {state.destructiveAction !== undefined && (
        <DestructiveActionDialog state={state} store={store} />
      )}
    </main>
  );
}

function inventoryItemForScope(
  item: InventoryItem,
  state: ReadyState,
): InventoryItem {
  if (state.scope.kind !== 'context') return item;
  const reference = state.contextWorkspace?.references.find(
    (candidate) => candidate.itemId === item.itemId,
  );
  const pinnedRevisionId = state.contextWorkspace?.pendingRevisionImpacts.find(
    (impact) => impact.itemId === item.itemId,
  )?.pinnedRevisionId;
  const effectiveRevisionId =
    reference?.currentRevisionId ?? pinnedRevisionId ?? item.currentRevisionId;
  const effectiveDisplayName = reference?.displayName ?? item.displayName;
  if (
    effectiveRevisionId === item.currentRevisionId &&
    effectiveDisplayName === item.displayName
  ) {
    return item;
  }
  return Object.freeze({
    ...item,
    currentRevisionId: effectiveRevisionId,
    displayName: effectiveDisplayName,
  });
}

export function DestructiveActionDialog({
  state,
  store,
}: {
  readonly state: ReadyState;
  readonly store: PlysmithApplicationStore;
}) {
  const action = state.destructiveAction;
  if (action === undefined) return null;
  const submitting = action.status === 'submitting';
  const item =
    action.kind === 'context'
      ? undefined
      : state.inventory.items.find(
          (candidate) => candidate.itemId === action.itemId,
        );
  const targetAvailable =
    action.kind === 'context'
      ? state.scope.kind === 'context' &&
        state.scope.contextId === action.contextId
      : item !== undefined &&
        item.itemId === state.selectedInventoryItemId &&
        (action.kind === 'inventory' ||
          (state.scope.kind === 'context' &&
            state.scope.contextId === action.contextId));
  const canConfirm =
    action.status === 'ready' &&
    action.preview !== undefined &&
    targetAvailable &&
    !state.refreshing &&
    state.busyCommand === undefined;

  function retry() {
    if (!targetAvailable || action === undefined) return;
    if (action.kind === 'context')
      void store.prepareContextDeletion(action.contextId);
    else if (item !== undefined && action.kind === 'context_item')
      void store.prepareContextItemRemoval(item);
    else if (item !== undefined) void store.prepareInventoryItemDeletion(item);
  }

  return (
    <ModalOverlay
      className={styles.lossOverlay!}
      isOpen
      isDismissable={!submitting}
      isKeyboardDismissDisabled={submitting}
      onOpenChange={(open) => {
        if (!open && !submitting) store.cancelDestructiveAction();
      }}
    >
      <Modal className={styles.lossModal!}>
        <Dialog
          className={styles.lossDialog!}
          aria-labelledby="destructive-action-title"
        >
          <header className={styles.lossHeader}>
            <AlertTriangle aria-hidden="true" size={20} />
            <h2 id="destructive-action-title">
              <FormattedMessage
                id={`destructive.${action.kind}.title`}
                values={{ name: action.displayName }}
              />
            </h2>
          </header>
          <div
            className={styles.lossBody}
            aria-busy={action.status === 'loading' || submitting}
          >
            {action.status === 'loading' && (
              <p role="status">
                <FormattedMessage id="destructive.loading" />
              </p>
            )}
            {submitting && (
              <p role="status">
                <FormattedMessage id="destructive.submitting" />
              </p>
            )}
            {(action.status === 'error' || action.status === 'stale') && (
              <p role="alert">
                <FormattedMessage
                  id={
                    action.status === 'stale'
                      ? 'destructive.stale'
                      : 'destructive.failed'
                  }
                />
              </p>
            )}
            {(action.status === 'ready' || submitting) &&
              action.preview !== undefined &&
              (action.kind === 'inventory' ? (
                <>
                  <p>
                    <FormattedMessage id="destructive.inventory.detail" />
                  </p>
                  <section className={styles.lossSection}>
                    <h3>
                      <FormattedMessage id="scope.free" />
                    </h3>
                    <LossSummary summary={action.preview.global} />
                  </section>
                  {action.preview.contexts.map((context) => (
                    <section
                      className={styles.lossSection}
                      key={context.contextId}
                    >
                      <h3>{context.contextName}</h3>
                      <LossSummary summary={context} />
                    </section>
                  ))}
                  {action.preview.retainedDerivedItemCount > 0 && (
                    <p>
                      <FormattedMessage
                        id="destructive.retainedDerived"
                        values={{
                          count: action.preview.retainedDerivedItemCount,
                        }}
                      />
                    </p>
                  )}
                  {action.preview.retainedPlayoutCount > 0 && (
                    <p>
                      <FormattedMessage
                        id="destructive.retainedPlayouts"
                        values={{ count: action.preview.retainedPlayoutCount }}
                      />
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p>
                    <FormattedMessage
                      id={`destructive.${action.kind}.detail`}
                      values={{ name: action.preview.contextName }}
                    />
                  </p>
                  <LossSummary
                    summary={contextRemovalSummary(action.preview)}
                  />
                  {action.preview.losses.playout !== undefined && (
                    <p>
                      <FormattedMessage
                        id="destructive.lostPlayout"
                        values={{
                          count: Number(
                            action.preview.losses.playout !== undefined,
                          ),
                          moves: action.preview.losses.playout?.moveCount ?? 0,
                        }}
                      />
                    </p>
                  )}
                  <p>
                    <FormattedMessage
                      id="destructive.retainedInventory"
                      values={{ count: action.preview.items.length }}
                    />
                  </p>
                  {action.preview.retainedPlayout !== undefined && (
                    <p>
                      <FormattedMessage
                        id="destructive.retainedPlayout"
                        values={{
                          count: 1,
                          moves: action.preview.retainedPlayout.moveCount,
                        }}
                      />
                    </p>
                  )}
                </>
              ))}
          </div>
          <footer className={styles.lossActions}>
            <Button
              className={styles.secondaryButton!}
              autoFocus
              isDisabled={submitting}
              onPress={() => store.cancelDestructiveAction()}
            >
              <X aria-hidden="true" size={16} />
              <FormattedMessage id="action.cancel" />
            </Button>
            {action.status === 'error' || action.status === 'stale' ? (
              <Button
                className={styles.secondaryButton!}
                isDisabled={
                  !targetAvailable ||
                  state.refreshing ||
                  state.busyCommand !== undefined
                }
                onPress={retry}
              >
                <RefreshCw aria-hidden="true" size={16} />
                <FormattedMessage id="destructive.retry" />
              </Button>
            ) : (
              <Button
                className={styles.destructiveButton!}
                isDisabled={!canConfirm}
                onPress={() => {
                  if (canConfirm) void store.confirmDestructiveAction();
                }}
              >
                <Trash2 aria-hidden="true" size={16} />
                <FormattedMessage id={`destructive.${action.kind}.confirm`} />
              </Button>
            )}
          </footer>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function InventoryFamily({
  node,
  depth,
  state,
  store,
  collapsedFamilies,
  onToggle,
}: {
  readonly node: InventoryFamilyNode;
  readonly depth: number;
  readonly state: ReadyState;
  readonly store: PlysmithApplicationStore;
  readonly collapsedFamilies: ReadonlySet<string>;
  readonly onToggle: (itemId: string) => void;
}) {
  const intl = useIntl();
  const { item } = node;
  const activeContextId =
    state.scope.kind === 'context' ? state.scope.contextId : undefined;
  const isSelected =
    node.isMatch && item.itemId === state.selectedInventoryItemId;
  const requiresResolution =
    node.isMatch &&
    (state.contextWorkspace?.pendingRevisionImpacts.some(
      (impact) => impact.itemId === item.itemId,
    ) ??
      false);
  const isExpanded = !collapsedFamilies.has(item.itemId);
  const statusId =
    item.lifecycle === 'trashed' || item.lifecycle === 'tombstone'
      ? 'manage.deletedSource'
      : !node.isMatch
        ? 'manage.sourceContext'
        : requiresResolution
          ? 'revisionImpact.required'
          : activeContextId === undefined
            ? undefined
            : item.contextIds.includes(activeContextId)
              ? 'manage.inContext'
              : 'manage.outsideContext';
  const content = (
    <>
      <span className={styles.itemIcon}>
        <InventoryTypeIcon itemType={item.itemType} size={18} />
      </span>
      <span className={styles.itemMain}>
        <strong>{item.displayName}</strong>
        <small>
          <FormattedMessage id={`itemType.${item.itemType}`} />
          <span aria-hidden="true"> · </span>
          <FormattedDate value={item.updatedAt} />
        </small>
      </span>
      {statusId !== undefined && (
        <span
          className={
            requiresResolution
              ? styles.resolutionRequired
              : statusId === 'manage.inContext'
                ? styles.contextMember
                : styles.inventoryOnly
          }
        >
          <FormattedMessage id={statusId} />
        </span>
      )}
    </>
  );
  return (
    <li>
      <div
        className={styles.familyRow}
        style={{ marginInlineStart: depth * 14 }}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            className={styles.expandButton}
            aria-expanded={isExpanded}
            aria-label={intl.formatMessage(
              {
                id: isExpanded
                  ? 'manage.collapseFamily'
                  : 'manage.expandFamily',
              },
              { name: item.displayName },
            )}
            title={intl.formatMessage(
              {
                id: isExpanded
                  ? 'manage.collapseFamily'
                  : 'manage.expandFamily',
              },
              { name: item.displayName },
            )}
            onClick={() => onToggle(item.itemId)}
          >
            {isExpanded ? (
              <ChevronDown aria-hidden="true" size={16} />
            ) : (
              <ChevronRight aria-hidden="true" size={16} />
            )}
          </button>
        ) : (
          <span />
        )}
        {node.isMatch ? (
          <Button
            className={`${styles.inventoryRow!} ${isSelected ? styles.selectedItem : ''}`}
            aria-pressed={isSelected}
            onPress={() => void store.selectInventoryItem(item)}
          >
            {content}
          </Button>
        ) : (
          <div className={`${styles.inventoryRow} ${styles.sourceRow}`}>
            {content}
          </div>
        )}
      </div>
      {isExpanded && node.children.length > 0 && (
        <ul className={styles.familyList}>
          {node.children.map((child) => (
            <InventoryFamily
              key={child.item.itemId}
              node={child}
              depth={depth + 1}
              state={state}
              store={store}
              collapsedFamilies={collapsedFamilies}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function ItemInspector({
  item,
  state,
  store,
  revisionImpact,
}: {
  readonly item: InventoryItem;
  readonly state: ReadyState;
  readonly store: PlysmithApplicationStore;
  readonly revisionImpact?: RevisionImpactSummary;
}) {
  const contextId =
    state.scope.kind === 'context' ? state.scope.contextId : undefined;
  const isContextMember =
    contextId !== undefined && item.contextIds.includes(contextId);
  const isBusy = state.busyCommand !== undefined || state.refreshing;
  const [showRename, setShowRename] = useState(false);
  const renameOpen = showRename;
  const [showScratchDecision, setShowScratchDecision] = useState(false);
  const hasOpenAnalysisDraft = state.analysis.scratch !== undefined;
  const renameDraft =
    state.manageInventoryRevisionDraft?.itemId === item.itemId
      ? state.manageInventoryRevisionDraft
      : undefined;
  const renamedRevision =
    renameDraft === undefined
      ? undefined
      : {
          ...renameDraft.previousRevision,
          displayName: renameDraft.preview.displayName,
          ...(renameDraft.preview.summary === undefined
            ? { summary: undefined }
            : { summary: renameDraft.preview.summary }),
          steps: [
            ...renameDraft.previousRevision.steps.slice(
              0,
              renameDraft.preview.preservedMoveCount,
            ),
            ...renameDraft.preview.addedSteps,
          ],
        };

  useEffect(() => {
    setShowRename(false);
    setShowScratchDecision(false);
  }, [item.itemId, item.currentRevisionId]);

  return (
    <div className={styles.inspectorBody}>
      <div className={styles.inspectorTitle}>
        <span className={styles.itemIcon}>
          <InventoryTypeIcon itemType={item.itemType} size={19} />
        </span>
        <div>
          <strong>{item.displayName}</strong>
          <span>
            <FormattedMessage id={`itemType.${item.itemType}`} />
          </span>
        </div>
      </div>
      <dl>
        <div>
          <dt>
            <FormattedMessage id="manage.origin" />
          </dt>
          <dd>
            <FormattedMessage id={`origin.${item.originKind}`} />
          </dd>
        </div>
      </dl>
      <InventoryDetailsView
        key={`${state.scope.kind === 'context' ? state.scope.contextId : 'free'}-${item.itemId}-${item.currentRevisionId}`}
        item={item}
        store={store}
      />
      {revisionImpact === undefined &&
        renameOpen &&
        renameDraft === undefined && (
          <div className={styles.renameForm}>
            <strong>
              <FormattedMessage id="inventory.rename" />
            </strong>
            <InventoryMetadataForm
              displayName={item.displayName}
              summary={item.summary}
              isBusy={isBusy}
              onCancel={() => setShowRename(false)}
              onPrepare={(displayName, summary) =>
                void store.prepareInventoryItemRename(
                  item,
                  displayName,
                  summary,
                )
              }
            />
          </div>
        )}
      {revisionImpact === undefined &&
        renameDraft !== undefined &&
        renamedRevision !== undefined && (
          <section className={styles.managedRevisionDraft}>
            <RevisionLineComparison
              previous={renameDraft.previousRevision}
              next={renamedRevision}
              unchangedCount={renameDraft.preview.preservedMoveCount}
            />
            {renameDraft.preview.affectedContexts.length > 0 && (
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
                    {renameDraft.preview.affectedContexts.map((context) => (
                      <li key={context.contextId}>{context.contextName}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            <RevisionFollowingContexts
              contexts={renameDraft.preview.followingContexts}
              metadataOnly
            />
            <div className={styles.managedRevisionActions}>
              <Button
                className={styles.destructiveButton!}
                onPress={async () => {
                  if (await store.discardManagedInventoryRevision()) {
                    setShowRename(false);
                  }
                }}
                isDisabled={isBusy}
              >
                <Trash2 aria-hidden="true" size={15} />
                <FormattedMessage id="inventory.discardRevision" />
              </Button>
              <Button
                className={styles.primaryButton!}
                onPress={async () => {
                  if (await store.saveManagedInventoryRevision()) {
                    setShowRename(false);
                  }
                }}
                isDisabled={isBusy || renameDraft.preview.noOp}
              >
                <Save aria-hidden="true" size={15} />
                <FormattedMessage id="inventory.saveRevision" />
              </Button>
            </div>
          </section>
        )}
      {revisionImpact === undefined &&
      (contextId === undefined || isContextMember) &&
      showScratchDecision ? (
        <section className={styles.scratchDecision}>
          <div>
            <strong>
              <FormattedMessage id="manage.openAnalysisDraftTitle" />
            </strong>
            <p>
              <FormattedMessage id="manage.openAnalysisDraftDetail" />
            </p>
          </div>
          <div className={styles.scratchDecisionActions}>
            <Button
              className={styles.primaryButton!}
              onPress={() => {
                setShowScratchDecision(false);
                store.setActivity('analyze');
              }}
              isDisabled={isBusy}
            >
              <ArrowRight aria-hidden="true" size={16} />
              <FormattedMessage id="manage.continueAnalysisDraft" />
            </Button>
            <Button
              className={styles.destructiveButton!}
              onPress={async () => {
                if (
                  await store.discardAnalysisScratchAndOpenInventoryItem(item)
                ) {
                  setShowScratchDecision(false);
                }
              }}
              isDisabled={isBusy}
            >
              <Trash2 aria-hidden="true" size={16} />
              <FormattedMessage id="manage.discardDraftAndOpenItem" />
            </Button>
            <Button
              className={styles.secondaryButton!}
              onPress={() => setShowScratchDecision(false)}
              isDisabled={isBusy}
            >
              <X aria-hidden="true" size={16} />
              <FormattedMessage id="action.cancel" />
            </Button>
          </div>
        </section>
      ) : revisionImpact === undefined &&
        !renameOpen &&
        renameDraft === undefined &&
        !showScratchDecision ? (
        <div className={styles.inspectorActions}>
          {(contextId === undefined || isContextMember) && (
            <Button
              className={styles.primaryButton!}
              onPress={() => {
                if (hasOpenAnalysisDraft) {
                  setShowScratchDecision(true);
                  return;
                }
                void store.openInventoryItem(item);
              }}
              isDisabled={isBusy}
            >
              <ArrowRight aria-hidden="true" size={16} />
              <FormattedMessage id="activity.analyze" />
            </Button>
          )}
          <Button
            className={styles.primaryButton!}
            onPress={() => setShowRename((visible) => !visible)}
            isDisabled={isBusy}
          >
            <Pencil aria-hidden="true" size={16} />
            <FormattedMessage id="inventory.rename" />
          </Button>
          {contextId !== undefined && !isContextMember && (
            <Button
              className={styles.primaryButton!}
              onPress={() => void store.addInventoryItemToCurrentContext(item)}
              isDisabled={isBusy}
            >
              <Plus aria-hidden="true" size={16} />
              <FormattedMessage id="manage.useInContext" />
            </Button>
          )}
          {contextId !== undefined && isContextMember && (
            <Button
              className={styles.destructiveButton!}
              onPress={() => {
                setShowRename(false);
                void store.prepareContextItemRemoval(item);
              }}
              isDisabled={isBusy}
            >
              <Trash2 aria-hidden="true" size={16} />
              <FormattedMessage id="manage.removeFromContext" />
            </Button>
          )}
          <Button
            className={styles.destructiveButton!}
            onPress={() => void store.prepareInventoryItemDeletion(item)}
            isDisabled={isBusy}
          >
            <Trash2 aria-hidden="true" size={16} />
            <FormattedMessage id="manage.deleteInventoryItem" />
          </Button>
        </div>
      ) : revisionImpact !== undefined &&
        state.revisionImpact?.impact.impactId === revisionImpact.impactId ? (
        <div className={styles.impactResolution}>
          <RevisionImpactResolutionPanel
            details={state.revisionImpact}
            store={store}
            isBusy={isBusy}
          />
        </div>
      ) : revisionImpact !== undefined ? (
        <div className={styles.impactLoading}>
          <FormattedMessage id="revisionImpact.loading" />
        </div>
      ) : null}
    </div>
  );
}

function ContextSummary({
  state,
  store,
}: {
  readonly state: ReadyState;
  readonly store: PlysmithApplicationStore;
}) {
  if (state.scope.kind === 'free') {
    return (
      <div className={styles.contextSummary}>
        <Library aria-hidden="true" size={24} />
        <strong>
          <FormattedMessage id="scope.free" />
        </strong>
      </div>
    );
  }
  const workspace = state.contextWorkspace;
  return (
    <section className={styles.contextDetails}>
      {workspace !== undefined && (
        <ContextMetadataForm
          context={workspace.context}
          isBusy={state.busyCommand !== undefined || state.refreshing}
          onSave={(request) =>
            store.updateWorkingContextMetadata(
              workspace.context.contextId,
              request,
            )
          }
        />
      )}
      <dl>
        <div>
          <dt>
            <FormattedMessage id="manage.contents" />
          </dt>
          <dd>
            <FormattedMessage
              id="manage.referenceCount"
              values={{ count: workspace?.references.length ?? 0 }}
            />
          </dd>
        </div>
      </dl>
      {workspace !== undefined && (
        <Button
          className={styles.destructiveButton!}
          onPress={() =>
            void store.prepareContextDeletion(workspace.context.contextId)
          }
          isDisabled={state.busyCommand !== undefined || state.refreshing}
        >
          <Trash2 aria-hidden="true" size={16} />
          <FormattedMessage id="manage.deleteContext" />
        </Button>
      )}
    </section>
  );
}

function ContextMetadataForm({
  context,
  isBusy,
  onSave,
}: {
  readonly context: NonNullable<ReadyState['contextWorkspace']>['context'];
  readonly isBusy: boolean;
  readonly onSave: (request: {
    readonly displayName: string;
    readonly purpose: string | null;
    readonly expectedContextVersion: number;
  }) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<{
    readonly base: typeof context;
    readonly displayName: string;
    readonly purpose: string;
  }>();
  const displayName = draft?.displayName ?? context.displayName;
  const purpose = draft?.purpose ?? context.purpose ?? '';
  const hasChanges =
    draft !== undefined &&
    (displayName.trim() !== draft.base.displayName ||
      purpose.trim() !== (draft.base.purpose ?? ''));
  function edit(field: 'displayName' | 'purpose', value: string) {
    setDraft((current) => ({
      base: current?.base ?? context,
      displayName,
      purpose,
      [field]: value,
    }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      isBusy ||
      !hasChanges ||
      displayName.trim() === '' ||
      draft === undefined
    )
      return;
    if (
      await onSave({
        displayName: displayName.trim(),
        purpose: purpose.trim() || null,
        expectedContextVersion: draft.base.contextVersion,
      })
    )
      setDraft(undefined);
  }
  return (
    <form
      className={styles.contextMetadataForm}
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !isBusy) {
          event.preventDefault();
          setDraft(undefined);
        }
      }}
    >
      <label htmlFor="context-edit-name">
        <FormattedMessage id="manage.contextName" />
      </label>
      <input
        id="context-edit-name"
        value={displayName}
        maxLength={160}
        required
        disabled={isBusy}
        onChange={(event) => edit('displayName', event.target.value)}
      />
      <label htmlFor="context-edit-purpose">
        <FormattedMessage id="manage.contextPurpose" />
      </label>
      <textarea
        id="context-edit-purpose"
        value={purpose}
        maxLength={2000}
        rows={4}
        disabled={isBusy}
        onChange={(event) => edit('purpose', event.target.value)}
      />
      <div className={styles.formActions}>
        <Button
          className={styles.tertiaryButton!}
          isDisabled={isBusy || draft === undefined}
          onPress={() => setDraft(undefined)}
        >
          <X aria-hidden="true" size={15} />
          <FormattedMessage id="action.cancel" />
        </Button>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={isBusy || !hasChanges || displayName.trim() === ''}
        >
          <Save aria-hidden="true" size={15} />
          <FormattedMessage id="manage.saveContext" />
        </button>
      </div>
    </form>
  );
}

function CreateContextForm({
  isBusy,
  onCancel,
  onCreate,
}: {
  readonly isBusy: boolean;
  readonly onCancel: () => void;
  readonly onCreate: (request: {
    readonly displayName: string;
  }) => Promise<boolean>;
}) {
  const [displayName, setDisplayName] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (isBusy || displayName.trim() === '') return;
    await onCreate({
      displayName: displayName.trim(),
    });
  }
  return (
    <form className={styles.createContextForm} onSubmit={submit}>
      <div className={styles.formTitle}>
        <FolderPlus aria-hidden="true" size={16} />
        <FormattedMessage id="manage.newContext" />
      </div>
      <label htmlFor="context-name">
        <FormattedMessage id="manage.contextName" />
      </label>
      <input
        id="context-name"
        value={displayName}
        maxLength={160}
        required
        disabled={isBusy}
        onChange={(event) => setDisplayName(event.target.value)}
        autoFocus
      />
      <div className={styles.formActions}>
        <Button
          className={styles.tertiaryButton!}
          onPress={onCancel}
          isDisabled={isBusy}
        >
          <FormattedMessage id="action.cancel" />
        </Button>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={isBusy || displayName.trim() === ''}
        >
          <Plus aria-hidden="true" size={15} />
          <FormattedMessage id="action.create" />
        </button>
      </div>
    </form>
  );
}
