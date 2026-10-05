import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FolderInput, Minus, Plus, Trash2, X } from 'lucide-react';
import { Button, Dialog, Modal, ModalOverlay } from 'react-aria-components';
import { FormattedMessage, useIntl } from 'react-intl';
import { InventoryActions } from './inventory-actions.tsx';
import { LossSummary, contextRemovalSummary } from './loss-summary.tsx';
import { contextRemovalHasContentLoss } from './work-loss-presentation.ts';
import { inventoryFolderGroups } from './inventory-folder-presentation.ts';
import type {
  InventoryItem,
  InventorySelectionPreview,
  InventorySelectionResult,
  PlysmithApplicationState,
  PlysmithApplicationStore,
} from './plysmith-application-store.ts';
import styles from './inventory-folder-view.module.css';

type ReadyState = Extract<PlysmithApplicationState, { phase: 'ready' }>;

export function InventorySelectionActions({
  state,
  store,
  items,
  onCompleted,
  onClear,
}: {
  readonly state: ReadyState;
  readonly store: PlysmithApplicationStore;
  readonly items: readonly InventoryItem[];
  readonly onCompleted: (ids: readonly string[]) => void;
  readonly onClear: () => void;
}) {
  const intl = useIntl();
  const [action, setAction] = useState<'move' | 'delete' | 'remove'>();
  const [preview, setPreview] = useState<InventorySelectionPreview>();
  const [folderId, setFolderId] = useState('-');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{
    completed: number;
    remaining: number;
  }>();
  const version = useRef(0);
  const contextId =
    state.scope.kind === 'context' ? state.scope.contextId : undefined;
  const contextOnly = contextId !== undefined && state.inventoryContextOnly;
  const scopeKey = `${contextId ?? 'free'}:${state.inventoryQuery}:${contextOnly}`;
  useEffect(
    () => () => {
      version.current++;
    },
    [scopeKey],
  );
  const busy =
    items.length === 0 ||
    pending ||
    state.busyCommand !== undefined ||
    state.refreshing;
  const members = items.filter(
    (item) => contextId !== undefined && item.contextIds.includes(contextId),
  );
  const nonmembers = items.filter(
    (item) => contextId !== undefined && !item.contextIds.includes(contextId),
  );
  const folders = inventoryFolderGroups(
    state.inventoryOrganization,
    state.inventory.items,
    contextOnly,
    intl.locale,
  ).filter((folder) => folder.folderId !== undefined);
  const stale =
    preview !== undefined &&
    preview.dataRevision !== state.status.persistence.dataRevision;

  function close() {
    if (state.busyCommand !== undefined) return;
    version.current++;
    setPending(false);
    setAction(undefined);
    setPreview(undefined);
  }
  function finish(result: InventorySelectionResult, count: number) {
    onCompleted(result.completedItemIds);
    setFailure(
      result.status === 'failed'
        ? {
            completed: result.completedItemIds.length,
            remaining: count - result.completedItemIds.length,
          }
        : undefined,
    );
    setPending(false);
    setAction(undefined);
    setPreview(undefined);
  }
  async function include() {
    const current = ++version.current;
    setPending(true);
    setFailure(undefined);
    const result = await store.includeInventorySelection(nonmembers);
    if (version.current === current) finish(result, nonmembers.length);
  }
  async function prepare(kind: 'delete' | 'remove') {
    const current = ++version.current;
    setAction(kind);
    setPending(true);
    setPreview(undefined);
    setFailure(undefined);
    const targets = kind === 'remove' ? members : items;
    const prepared = await store.previewInventorySelection(kind, targets);
    if (version.current !== current) return;
    if (prepared === undefined) {
      finish({ status: 'failed', completedItemIds: [] }, targets.length);
      return;
    }
    if (
      prepared.kind === 'remove' &&
      !prepared.entries.some((entry) =>
        contextRemovalHasContentLoss(entry.preview),
      )
    ) {
      const result = await store.applyInventorySelection(prepared);
      if (version.current === current) finish(result, targets.length);
      return;
    }
    setPreview(prepared);
    setPending(false);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || stale) return;
    const current = ++version.current;
    setPending(true);
    if (action === 'move') {
      const available =
        folderId === '' ||
        folders.some((folder) => folder.folderId === folderId);
      if (!available) {
        setPending(false);
        return;
      }
      const moved = await store.changeInventoryOrganization(
        {
          kind: 'move_items',
          itemIds: items.map((item) => item.itemId),
          ...(folderId === '' ? {} : { folderId }),
          ...(contextOnly ? { workContextId: contextId! } : {}),
        },
        state.status.persistence.dataRevision,
      );
      if (version.current === current)
        finish(
          {
            status: moved ? 'completed' : 'failed',
            completedItemIds: moved ? items.map((item) => item.itemId) : [],
          },
          items.length,
        );
    } else if (preview !== undefined) {
      const result = await store.applyInventorySelection(preview);
      if (version.current === current) finish(result, preview.entries.length);
    } else setPending(false);
  }
  return (
    <>
      <InventoryActions
        label={intl.formatMessage({ id: 'manage.selectionActions' })}
        disabled={busy}
        actions={[
          {
            id: 'move',
            label: intl.formatMessage({ id: 'selection.move' }),
            icon: <FolderInput size={16} />,
            onPress: () => {
              setFolderId('-');
              setFailure(undefined);
              setAction('move');
            },
          },
          ...(contextId === undefined
            ? []
            : [
                {
                  id: 'include',
                  label: intl.formatMessage({ id: 'selection.include' }),
                  icon: <Plus size={16} />,
                  disabled: nonmembers.length === 0,
                  onPress: () => void include(),
                },
                {
                  id: 'remove',
                  label: intl.formatMessage({ id: 'selection.remove' }),
                  icon: <Minus size={16} />,
                  destructive: true,
                  disabled: members.length === 0,
                  onPress: () => void prepare('remove'),
                },
              ]),
          {
            id: 'delete',
            label: intl.formatMessage({ id: 'selection.delete' }),
            icon: <Trash2 size={16} />,
            destructive: true,
            onPress: () => void prepare('delete'),
          },
          {
            id: 'clear',
            label: intl.formatMessage({ id: 'manage.clearSelection' }),
            icon: <X size={16} />,
            onPress: onClear,
          },
        ]}
      />
      {failure !== undefined && (
        <p role="alert" className={styles.selectionFailure}>
          <FormattedMessage id="selection.failed" values={failure} />
        </p>
      )}
      {action !== undefined && (
        <ModalOverlay
          className={styles.overlay!}
          isOpen
          isDismissable={!pending}
          isKeyboardDismissDisabled={pending}
          onOpenChange={(open) => {
            if (!open && !pending) close();
          }}
        >
          <Modal className={styles.modal!}>
            <Dialog
              className={styles.dialog!}
              aria-labelledby="selection-title"
            >
              <form onSubmit={(event) => void submit(event)}>
                <header>
                  <h2 id="selection-title">
                    <FormattedMessage id={`selection.${action}`} />
                  </h2>
                </header>
                {pending && (
                  <p role="status">
                    <FormattedMessage id="destructive.loading" />
                  </p>
                )}
                {stale && (
                  <p role="alert">
                    <FormattedMessage id="destructive.stale" />
                  </p>
                )}
                {action === 'move' && (
                  <label>
                    <span>
                      <FormattedMessage id="folders.path" />
                    </span>
                    <select
                      aria-label={intl.formatMessage({ id: 'folders.path' })}
                      value={folderId}
                      disabled={busy}
                      onChange={(event) => setFolderId(event.target.value)}
                    >
                      <option value="-" disabled>
                        {intl.formatMessage({ id: 'selection.chooseFolder' })}
                      </option>
                      <option value="">
                        {intl.formatMessage({ id: 'folders.unfiled' })}
                      </option>
                      {folders.map((folder) => (
                        <option key={folder.folderId} value={folder.folderId}>
                          {folder.path}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {preview?.kind === 'delete' && (
                  <>
                    <p>
                      <FormattedMessage id="selection.delete.detail" />
                    </p>
                    {preview.entries.map(({ item, preview: loss }) => (
                      <section key={item.itemId}>
                        <h3>{item.displayName}</h3>
                        <LossSummary summary={loss.global} />
                        {loss.contexts.map((context) => (
                          <section key={context.contextId}>
                            <h4>{context.contextName}</h4>
                            <LossSummary summary={context} />
                          </section>
                        ))}
                        {loss.retainedPlayoutCount > 0 && (
                          <p>
                            <FormattedMessage
                              id="destructive.retainedPlayouts"
                              values={{ count: loss.retainedPlayoutCount }}
                            />
                          </p>
                        )}
                      </section>
                    ))}
                  </>
                )}
                {preview?.kind === 'remove' && (
                  <>
                    <p>
                      <FormattedMessage
                        id="destructive.context_item.detail"
                        values={{
                          name: preview.entries[0]?.preview.contextName ?? '',
                        }}
                      />
                    </p>
                    {preview.entries
                      .filter((entry) =>
                        contextRemovalHasContentLoss(entry.preview),
                      )
                      .map(({ item, preview: loss }) => (
                        <section key={item.itemId}>
                          <h3>{item.displayName}</h3>
                          <LossSummary summary={contextRemovalSummary(loss)} />
                        </section>
                      ))}
                    <p>
                      <FormattedMessage
                        id="destructive.retainedInventory"
                        values={{ count: preview.entries.length }}
                      />
                    </p>
                  </>
                )}
                <footer>
                  <Button
                    className={styles.command!}
                    isDisabled={pending}
                    onPress={close}
                  >
                    <FormattedMessage id="action.cancel" />
                  </Button>
                  {stale ? (
                    <Button
                      className={styles.command!}
                      isDisabled={busy}
                      onPress={() =>
                        void prepare(action === 'remove' ? 'remove' : 'delete')
                      }
                    >
                      <FormattedMessage id="destructive.retry" />
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      className={styles.primary!}
                      isDisabled={
                        busy ||
                        (action === 'move'
                          ? folderId === '-'
                          : preview === undefined)
                      }
                    >
                      <FormattedMessage
                        id={
                          action === 'move'
                            ? 'selection.move'
                            : action === 'remove'
                              ? 'selection.remove'
                              : 'selection.delete'
                        }
                      />
                    </Button>
                  )}
                </footer>
              </form>
            </Dialog>
          </Modal>
        </ModalOverlay>
      )}
    </>
  );
}
