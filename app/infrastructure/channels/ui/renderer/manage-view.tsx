import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  BookOpen,
  Boxes,
  FileSearch,
  FolderPlus,
  Library,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { Button, Radio, RadioGroup } from 'react-aria-components';
import { FormattedDate, FormattedMessage, useIntl } from 'react-intl';

import {
  type InventoryItem,
  type PlysmithApplicationState,
  type PlysmithApplicationStore,
} from './plysmith-application-store.ts';
import styles from './manage-view.module.css';

type ReadyState = Extract<PlysmithApplicationState, { phase: 'ready' }>;

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
  const selectedItem = state.inventory.items.find(
    (item) => item.itemId === state.selectedInventoryItemId,
  );
  const activeContextId =
    state.scope.kind === 'context' ? state.scope.contextId : undefined;
  const activeContext = state.contexts.contexts.find(
    (context) => context.contextId === activeContextId,
  );

  useEffect(() => setQuery(state.inventoryQuery), [state.inventoryQuery]);

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    await store.searchInventory(query);
  }

  return (
    <main className={styles.manageView}>
      <header className={styles.viewHeader}>
        <div>
          <span className={styles.eyebrow}>
            <FormattedMessage id="manage.eyebrow" />
          </span>
          <h1>
            <FormattedMessage id="manage.title" />
          </h1>
        </div>
        <span className={styles.inventoryCount}>
          <FormattedMessage
            id="manage.resultCount"
            values={{ count: state.inventory.items.length }}
          />
        </span>
      </header>

      <div className={styles.manageGrid}>
        <aside className={styles.contextPanel} aria-labelledby="contexts-title">
          <div className={styles.panelHeading}>
            <div>
              <span className={styles.panelLabel}>
                <FormattedMessage id="manage.workScope" />
              </span>
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
              onPress={() => void store.setScope({ kind: 'free' })}
            >
              <Library aria-hidden="true" size={17} />
              <span>
                <strong>
                  <FormattedMessage id="scope.free" />
                </strong>
                <small>
                  <FormattedMessage id="manage.allInventory" />
                </small>
              </span>
            </Button>
            {state.contexts.contexts.map((context) => (
              <Button
                key={context.contextId}
                className={`${styles.contextButton!} ${state.scope.kind === 'context' && state.scope.contextId === context.contextId ? styles.activeContext : ''}`}
                onPress={() =>
                  void store.setScope({
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

        <section
          className={styles.inventoryPanel}
          aria-labelledby="inventory-title"
        >
          <div className={styles.inventoryToolbar}>
            <div>
              <span className={styles.panelLabel}>
                <FormattedMessage id="manage.inventory" />
              </span>
              <h2 id="inventory-title">
                {activeContext?.displayName ?? (
                  <FormattedMessage id="manage.allInventory" />
                )}
              </h2>
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
                <FormattedMessage id="manage.noResults" />
              </strong>
              <p>
                <FormattedMessage id="manage.noResultsDetail" />
              </p>
            </div>
          ) : (
            <div className={styles.inventoryList}>
              {state.inventory.items.map((item) => (
                <InventoryRow
                  key={item.itemId}
                  item={item}
                  {...(activeContextId === undefined
                    ? {}
                    : { activeContextId })}
                  isSelected={item.itemId === state.selectedInventoryItemId}
                  onSelect={() => void store.selectInventoryItem(item)}
                />
              ))}
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
              <span className={styles.panelLabel}>
                <FormattedMessage id="manage.selection" />
              </span>
              <h2 id="inspector-title">
                <FormattedMessage id="manage.details" />
              </h2>
            </div>
          </div>
          {selectedItem === undefined ? (
            <ContextSummary state={state} />
          ) : (
            <ItemInspector item={selectedItem} state={state} store={store} />
          )}
        </aside>
      </div>
    </main>
  );
}

function InventoryRow({
  item,
  activeContextId,
  isSelected,
  onSelect,
}: {
  readonly item: InventoryItem;
  readonly activeContextId?: string;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <Button
      className={`${styles.inventoryRow!} ${isSelected ? styles.selectedItem : ''}`}
      onPress={onSelect}
    >
      <span className={styles.itemIcon}>
        <BookOpen aria-hidden="true" size={18} />
      </span>
      <span className={styles.itemMain}>
        <strong>{item.displayName}</strong>
        <small>
          <FormattedMessage id={`itemType.${item.itemType}`} />
          <span aria-hidden="true"> · </span>
          <FormattedDate value={item.updatedAt} />
        </small>
      </span>
      <span
        className={
          activeContextId !== undefined &&
          item.contextIds.includes(activeContextId)
            ? styles.contextMember
            : styles.inventoryOnly
        }
      >
        <FormattedMessage
          id={
            activeContextId !== undefined &&
            item.contextIds.includes(activeContextId)
              ? 'manage.inContext'
              : 'manage.inventoryOnly'
          }
        />
      </span>
    </Button>
  );
}

function ItemInspector({
  item,
  state,
  store,
}: {
  readonly item: InventoryItem;
  readonly state: ReadyState;
  readonly store: PlysmithApplicationStore;
}) {
  const contextId =
    state.scope.kind === 'context' ? state.scope.contextId : undefined;
  const isContextMember =
    contextId !== undefined && item.contextIds.includes(contextId);
  const isBusy = state.busyCommand !== undefined;
  return (
    <div className={styles.inspectorBody}>
      <div className={styles.inspectorTitle}>
        <span className={styles.itemIcon}>
          <BookOpen aria-hidden="true" size={19} />
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
        <div>
          <dt>
            <FormattedMessage id="manage.language" />
          </dt>
          <dd>{item.languageTag}</dd>
        </div>
        <div>
          <dt>
            <FormattedMessage id="manage.revision" />
          </dt>
          <dd>r{item.currentRevisionId}</dd>
        </div>
      </dl>
      <div className={styles.inspectorActions}>
        <Button
          className={styles.primaryButton!}
          onPress={() => void store.openInventoryItem(item)}
          isDisabled={isBusy}
        >
          <ArrowRight aria-hidden="true" size={16} />
          <FormattedMessage id="manage.openAnalysis" />
        </Button>
        {contextId !== undefined && !isContextMember && (
          <Button
            className={styles.secondaryButton!}
            onPress={() => void store.addInventoryItemToCurrentContext(item)}
            isDisabled={isBusy}
          >
            <Plus aria-hidden="true" size={16} />
            <FormattedMessage id="manage.useInContext" />
          </Button>
        )}
      </div>
    </div>
  );
}

function ContextSummary({ state }: { readonly state: ReadyState }) {
  if (state.scope.kind === 'free') {
    return (
      <div className={styles.contextSummary}>
        <Library aria-hidden="true" size={24} />
        <strong>
          <FormattedMessage id="scope.free" />
        </strong>
        <p>
          <FormattedMessage id="manage.freeSummary" />
        </p>
      </div>
    );
  }
  const workspace = state.contextWorkspace;
  return (
    <div className={styles.contextSummary}>
      <Boxes aria-hidden="true" size={24} />
      <strong>{workspace?.context.displayName}</strong>
      {workspace?.context.purpose !== undefined && (
        <p>{workspace.context.purpose}</p>
      )}
      {workspace?.context.nextStep !== undefined && (
        <div className={styles.nextStep}>
          <span>
            <FormattedMessage id="manage.nextStep" />
          </span>
          {workspace.context.nextStep}
        </div>
      )}
      <span className={styles.referenceSummary}>
        <FormattedMessage
          id="manage.referenceCount"
          values={{ count: workspace?.references.length ?? 0 }}
        />
      </span>
    </div>
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
    readonly purpose?: string;
    readonly nextStep?: string;
  }) => Promise<boolean>;
}) {
  const [displayName, setDisplayName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [nextStep, setNextStep] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (displayName.trim() === '') return;
    await onCreate({
      displayName: displayName.trim(),
      ...(purpose.trim() === '' ? {} : { purpose: purpose.trim() }),
      ...(nextStep.trim() === '' ? {} : { nextStep: nextStep.trim() }),
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
        onChange={(event) => setDisplayName(event.target.value)}
        autoFocus
      />
      <label htmlFor="context-purpose">
        <FormattedMessage id="manage.contextPurpose" />
      </label>
      <textarea
        id="context-purpose"
        value={purpose}
        onChange={(event) => setPurpose(event.target.value)}
        rows={2}
      />
      <label htmlFor="context-next-step">
        <FormattedMessage id="manage.nextStep" />
      </label>
      <input
        id="context-next-step"
        value={nextStep}
        onChange={(event) => setNextStep(event.target.value)}
      />
      <div className={styles.formActions}>
        <Button className={styles.tertiaryButton!} onPress={onCancel}>
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
