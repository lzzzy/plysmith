import { useEffect, useState, type DragEvent, type FormEvent } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Minus,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { Button, Dialog, Modal, ModalOverlay } from 'react-aria-components';
import { FormattedMessage, useIntl } from 'react-intl';
import type {
  ContextFolderRemovalPreview,
  InventoryItem,
  InventoryOrganizationChange,
  PlysmithApplicationState,
  PlysmithApplicationStore,
} from './plysmith-application-store.ts';
import {
  inventoryFolderGroups,
  inventoryFolderSubtreeHasItems,
  type InventoryFolderGroup,
} from './inventory-folder-presentation.ts';
import { InventoryTypeIcon } from './inventory-type-icon.tsx';
import {
  InventoryActions,
  type InventoryAction,
} from './inventory-actions.tsx';
import {
  InventoryItemActions,
  type InventoryItemCommand,
} from './inventory-item-actions.tsx';
import { LossSummary } from './loss-summary.tsx';
import { hasContentLoss } from './work-loss-presentation.ts';
import styles from './inventory-folder-view.module.css';

type ReadyState = Extract<PlysmithApplicationState, { phase: 'ready' }>;
export type FolderDialog =
  | { readonly kind: 'create'; readonly parentId?: string }
  | {
      readonly kind: 'rename' | 'delete' | 'include';
      readonly folderId: string;
    }
  | { readonly kind: 'remove'; readonly preview: ContextFolderRemovalPreview };
type DragPayload =
  | { readonly kind: 'folder'; readonly folderId: string }
  | { readonly kind: 'items'; readonly itemIds: readonly string[] };
const dragType = 'application/x-plysmith-inventory';

export function InventoryFolderView({
  state,
  store,
  items,
  onItemCommand,
}: {
  readonly state: ReadyState;
  readonly store: PlysmithApplicationStore;
  readonly items: readonly InventoryItem[];
  readonly onItemCommand: (
    item: InventoryItem,
    command: InventoryItemCommand,
  ) => void;
}) {
  const intl = useIntl();
  const contextOnly =
    state.scope.kind === 'context' && state.inventoryContextOnly;
  const contextId =
    state.scope.kind === 'context' ? state.scope.contextId : undefined;
  const groups = inventoryFolderGroups(
    state.inventoryOrganization,
    items,
    contextOnly,
    intl.locale,
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const [dialog, setDialog] = useState<FolderDialog>();
  const [dropTarget, setDropTarget] = useState<string>();
  const visibleGroups = groups.filter((entry) => {
    if (contextOnly) return true;
    let parentId = entry.parentFolderId;
    while (parentId !== undefined) {
      if (collapsed.has(parentId)) return false;
      parentId = state.inventoryOrganization.folders.find(
        (folder) => folder.folderId === parentId,
      )?.parentFolderId;
    }
    return true;
  });
  const busy = state.busyCommand !== undefined || state.refreshing;
  const scopeKey = `${contextId ?? 'free'}:${contextOnly}:${state.inventoryQuery}`;
  useEffect(() => {
    setCollapsed(new Set());
    setChecked(new Set());
    setDialog(undefined);
  }, [scopeKey]);
  useEffect(() => {
    const available = new Set(items.map((item) => item.itemId));
    setChecked(
      (previous) => new Set([...previous].filter((id) => available.has(id))),
    );
  }, [items]);

  async function removeFolder(folderId: string) {
    const preview = await store.previewContextFolderRemoval(folderId);
    if (preview === undefined) return;
    if (hasContentLoss(preview.loss)) {
      setDialog({ kind: 'remove', preview });
    } else {
      await store.changeInventoryOrganization(
        {
          kind: 'remove_context_folder',
          folderId,
          contextId: preview.contextId,
        },
        preview.dataRevision,
      );
    }
  }

  function includeFolder(folderId: string) {
    if (contextId === undefined || busy) return;
    if (inventoryFolderSubtreeHasItems(state.inventoryOrganization, folderId)) {
      setDialog({ kind: 'include', folderId });
    } else {
      void store.changeInventoryOrganization(
        {
          kind: 'include_folder',
          folderId,
          contextId,
          includeItems: true,
        },
        state.inventoryOrganization.dataRevision,
      );
    }
  }

  function deleteFolder(folderId: string) {
    if (busy) return;
    const folder = state.inventoryOrganization.folders.find(
      (entry) => entry.folderId === folderId,
    );
    if (
      folder?.itemCount === 0 &&
      folder.contextLinkCount === 0 &&
      !state.inventoryOrganization.folders.some(
        (entry) => entry.parentFolderId === folderId,
      )
    ) {
      void store.changeInventoryOrganization(
        { kind: 'delete_folder', folderId },
        state.inventoryOrganization.dataRevision,
      );
    } else {
      setDialog({ kind: 'delete', folderId });
    }
  }

  async function drop(event: DragEvent, folderId?: string) {
    event.preventDefault();
    setDropTarget(undefined);
    if (busy) return;
    let payload: unknown;
    try {
      payload = JSON.parse(event.dataTransfer.getData(dragType));
    } catch {
      return;
    }
    if (typeof payload !== 'object' || payload === null || !('kind' in payload))
      return;
    if (
      payload.kind === 'folder' &&
      'folderId' in payload &&
      typeof payload.folderId === 'string' &&
      !contextOnly
    ) {
      if (payload.folderId === folderId) return;
      await store.changeInventoryOrganization({
        kind: 'move_folder',
        folderId: payload.folderId,
        ...(folderId === undefined ? {} : { parentFolderId: folderId }),
      });
    } else if (
      payload.kind === 'items' &&
      'itemIds' in payload &&
      Array.isArray(payload.itemIds) &&
      payload.itemIds.every(
        (id) =>
          typeof id === 'string' && items.some((item) => item.itemId === id),
      )
    ) {
      await store.changeInventoryOrganization({
        kind: 'move_items',
        itemIds: payload.itemIds,
        ...(folderId === undefined ? {} : { folderId }),
        ...(contextOnly && contextId !== undefined
          ? { workContextId: contextId }
          : {}),
      });
    }
  }

  function beginDrag(event: DragEvent, payload: DragPayload) {
    if (busy) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData(dragType, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'move';
  }

  function row(item: InventoryItem) {
    return (
      <li
        key={item.itemId}
        className={styles.itemRow}
        draggable={!busy}
        onDragStart={(event) =>
          beginDrag(event, {
            kind: 'items',
            itemIds: checked.has(item.itemId) ? [...checked] : [item.itemId],
          })
        }
      >
        <input
          type="checkbox"
          checked={checked.has(item.itemId)}
          disabled={busy}
          aria-label={intl.formatMessage(
            { id: 'folders.selectItem' },
            { name: item.displayName },
          )}
          onChange={(event) =>
            setChecked((previous) => {
              const next = new Set(previous);
              if (event.target.checked) next.add(item.itemId);
              else next.delete(item.itemId);
              return next;
            })
          }
        />
        <Button
          className={styles.itemButton!}
          aria-pressed={state.selectedInventoryItemId === item.itemId}
          onPress={() => void store.selectInventoryItem(item)}
          isDisabled={busy}
        >
          <InventoryTypeIcon itemType={item.itemType} size={17} />
          <span>
            <strong>{item.displayName}</strong>
            <small>
              <FormattedMessage id={`itemType.${item.itemType}`} />
            </small>
          </span>
          {contextId !== undefined && (
            <small
              className={
                item.contextIds.includes(contextId)
                  ? styles.member
                  : styles.nonmember
              }
            >
              <FormattedMessage
                id={
                  item.contextIds.includes(contextId)
                    ? 'manage.inContext'
                    : 'manage.inventoryOnly'
                }
              />
            </small>
          )}
        </Button>
        <InventoryItemActions
          item={item}
          state={state}
          onCommand={onItemCommand}
        />
      </li>
    );
  }

  function group(group: InventoryFolderGroup) {
    const key = group.folderId ?? 'unfiled';
    const folder = state.inventoryOrganization.folders.find(
      (entry) => entry.folderId === group.folderId,
    );
    const inContext =
      group.folderId !== undefined &&
      (state.inventoryOrganization.linkedFolderIds.includes(group.folderId) ||
        (folder?.contextItemCount ?? 0) > 0);
    const name =
      group.folderId === undefined
        ? intl.formatMessage({ id: 'folders.unfiled' })
        : contextOnly
          ? group.path
          : folder!.displayName;
    const isCollapsed = collapsed.has(key);
    const actions: InventoryAction[] = [];
    function add(
      id: string,
      icon: React.ReactNode,
      onPress: () => void,
      destructive = false,
    ) {
      actions.push({
        id,
        label: intl.formatMessage({ id }),
        icon,
        onPress,
        destructive,
      });
    }
    if (group.folderId !== undefined) {
      const folderId = group.folderId;
      if (!contextOnly) {
        add('folders.newChild', <FolderPlus size={16} />, () =>
          setDialog({ kind: 'create', parentId: folderId }),
        );
        add('inventory.rename', <Pencil size={16} />, () =>
          setDialog({ kind: 'rename', folderId }),
        );
      }
      if (contextId !== undefined)
        add(
          inContext ? 'folders.removeContext' : 'folders.include',
          inContext ? <Minus size={16} /> : <Plus size={16} />,
          () =>
            inContext ? void removeFolder(folderId) : includeFolder(folderId),
          inContext,
        );
      if (!contextOnly)
        add(
          'folders.delete',
          <Trash2 size={16} />,
          () => deleteFolder(folderId),
          true,
        );
    }
    return (
      <section
        key={key}
        className={`${styles.group} ${dropTarget === key ? styles.dropTarget : ''}`}
        style={{ marginInlineStart: group.depth * 14 }}
        data-folder-id={group.folderId ?? ''}
        onDragOver={(event) => {
          if (!busy && event.dataTransfer.types.includes(dragType)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setDropTarget(key);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDropTarget(undefined);
        }}
        onDrop={(event) => void drop(event, group.folderId)}
      >
        <div className={styles.groupHeading}>
          <button
            type="button"
            className={styles.iconButton}
            aria-expanded={!isCollapsed}
            aria-label={intl.formatMessage(
              { id: isCollapsed ? 'folders.expand' : 'folders.collapse' },
              { name },
            )}
            onClick={() =>
              setCollapsed((previous) => {
                const next = new Set(previous);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
          >
            {isCollapsed ? (
              <ChevronRight size={16} />
            ) : (
              <ChevronDown size={16} />
            )}
          </button>
          <button
            type="button"
            className={styles.folderButton!}
            aria-pressed={
              state.inspectedInventoryFolderId === (group.folderId ?? null)
            }
            disabled={busy}
            draggable={!contextOnly && group.folderId !== undefined}
            onDragStart={(event) => {
              if (group.folderId !== undefined)
                beginDrag(event, { kind: 'folder', folderId: group.folderId });
            }}
            onClick={() => void store.selectInventoryFolder(group.folderId)}
          >
            <Folder aria-hidden="true" size={18} />
            <span>{name}</span>
            <small>{group.itemCount}</small>
          </button>
          <InventoryActions
            actions={actions}
            disabled={busy}
            label={intl.formatMessage({ id: 'manage.actionsFor' }, { name })}
          />
        </div>
        {!isCollapsed && (
          <ul className={styles.items}>
            {group.items.map(row)}
            {group.items.length === 0 && (
              <li className={styles.empty}>
                <FormattedMessage
                  id={
                    state.inventoryQuery === ''
                      ? group.itemCount > 0
                        ? 'folders.notLoaded'
                        : 'folders.empty'
                      : 'folders.noMatches'
                  }
                />
              </li>
            )}
          </ul>
        )}
      </section>
    );
  }

  return (
    <div className={styles.folderView}>
      <div className={styles.toolbar}>
        {!contextOnly && (
          <Button
            className={styles.command!}
            isDisabled={busy}
            onPress={() => setDialog({ kind: 'create' })}
          >
            <FolderPlus size={17} />
            <FormattedMessage id="folders.new" />
          </Button>
        )}
        {checked.size > 0 && (
          <div className={styles.selection}>
            <span role="status">
              <FormattedMessage
                id="manage.selectedCount"
                values={{ count: checked.size }}
              />
            </span>
            <InventoryActions
              disabled={busy}
              label={intl.formatMessage({ id: 'manage.selectionActions' })}
              actions={[
                {
                  id: 'clear',
                  label: intl.formatMessage({ id: 'manage.clearSelection' }),
                  icon: <X size={16} />,
                  onPress: () => setChecked(new Set()),
                },
              ]}
            />
          </div>
        )}
      </div>
      <div
        className={styles.groups}
        role="region"
        aria-labelledby="inventory-title"
        tabIndex={0}
      >
        {visibleGroups.map(group)}
      </div>
      {dialog !== undefined && (
        <FolderActionDialog
          key={`${dialog.kind}:${'folderId' in dialog ? dialog.folderId : scopeKey}`}
          dialog={dialog}
          state={state}
          store={store}
          onClose={() => setDialog(undefined)}
        />
      )}
    </div>
  );
}

function IconAction({
  id,
  icon,
  disabled,
  onPress,
}: {
  readonly id: string;
  readonly icon: React.ReactNode;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const intl = useIntl();
  const label = intl.formatMessage({ id });
  return (
    <button
      type="button"
      className={styles.iconButton!}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onPress}
    >
      {icon}
    </button>
  );
}

export function FolderActionDialog({
  dialog,
  state,
  store,
  onClose,
}: {
  readonly dialog: FolderDialog;
  readonly state: ReadyState;
  readonly store: PlysmithApplicationStore;
  readonly onClose: () => void;
}) {
  const folder =
    'folderId' in dialog
      ? state.inventoryOrganization.folders.find(
          (entry) => entry.folderId === dialog.folderId,
        )
      : undefined;
  const [name, setName] = useState(folder?.displayName ?? '');
  const [includeItems, setIncludeItems] = useState(true);
  const [revision] = useState(
    dialog.kind === 'remove'
      ? dialog.preview.dataRevision
      : state.inventoryOrganization.dataRevision,
  );
  const [failed, setFailed] = useState(false);
  const busy = state.busyCommand !== undefined;
  const stale = revision !== state.inventoryOrganization.dataRevision;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || stale) return;
    let change: InventoryOrganizationChange;
    switch (dialog.kind) {
      case 'create':
        change = {
          kind: 'create_folder',
          displayName: name.trim(),
          ...(dialog.parentId === undefined
            ? {}
            : { parentFolderId: dialog.parentId }),
        };
        break;
      case 'rename':
        change = {
          kind: 'rename_folder',
          folderId: dialog.folderId,
          displayName: name.trim(),
        };
        break;
      case 'delete':
        change = { kind: 'delete_folder', folderId: dialog.folderId };
        break;
      case 'include':
        if (state.scope.kind !== 'context') return;
        change = {
          kind: 'include_folder',
          folderId: dialog.folderId,
          contextId: state.scope.contextId,
          includeItems,
        };
        break;
      case 'remove':
        change = {
          kind: 'remove_context_folder',
          folderId: dialog.preview.folderId,
          contextId: dialog.preview.contextId,
        };
        break;
    }
    if (await store.changeInventoryOrganization(change, revision)) onClose();
    else setFailed(true);
  }

  return (
    <ModalOverlay
      className={styles.overlay!}
      isOpen
      isDismissable={!busy}
      isKeyboardDismissDisabled={busy}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal className={styles.modal!}>
        <Dialog
          className={styles.dialog!}
          aria-labelledby="folder-dialog-title"
        >
          <header>
            <h2 id="folder-dialog-title">
              <FormattedMessage
                id={
                  dialog.kind === 'create' && dialog.parentId !== undefined
                    ? 'folders.newChild'
                    : `folders.dialog.${dialog.kind}`
                }
              />
            </h2>
            <IconAction
              id="action.cancel"
              icon={<X size={18} />}
              disabled={busy}
              onPress={onClose}
            />
          </header>
          <form onSubmit={(event) => void submit(event)}>
            {folder !== undefined && (
              <p className={styles.folderName}>{folder.displayName}</p>
            )}
            {(dialog.kind === 'create' || dialog.kind === 'rename') && (
              <label>
                <FormattedMessage id="folders.name" />
                <input
                  autoFocus
                  required
                  maxLength={200}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={busy}
                />
              </label>
            )}
            {dialog.kind === 'include' && (
              <>
                <p>
                  <FormattedMessage id="folders.includeDetail" />
                </p>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={includeItems}
                    onChange={(event) => setIncludeItems(event.target.checked)}
                    disabled={busy}
                  />
                  <FormattedMessage id="folders.includeItems" />
                </label>
              </>
            )}
            {dialog.kind === 'delete' && (
              <p>
                <FormattedMessage id="folders.deleteDetail" />
              </p>
            )}
            {dialog.kind === 'remove' && (
              <>
                <p>
                  <FormattedMessage id="folders.removeDetail" />
                </p>
                <LossSummary summary={dialog.preview.loss} />
              </>
            )}
            {(failed || stale) && (
              <p role="alert">
                <FormattedMessage
                  id={stale ? 'destructive.stale' : 'folders.failed'}
                />
              </p>
            )}
            <footer>
              <Button
                className={styles.command!}
                isDisabled={busy}
                onPress={onClose}
              >
                <FormattedMessage id="action.cancel" />
              </Button>
              <button
                type="submit"
                className={styles.primary}
                disabled={
                  busy ||
                  stale ||
                  ((dialog.kind === 'create' || dialog.kind === 'rename') &&
                    name.trim() === '')
                }
              >
                <FormattedMessage id={`folders.confirm.${dialog.kind}`} />
              </button>
            </footer>
          </form>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
