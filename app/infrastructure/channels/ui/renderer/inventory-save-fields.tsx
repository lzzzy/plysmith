import { useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import type {
  PlysmithApplicationState,
  PlysmithApplicationStore,
} from './plysmith-application-store.ts';
import { inventoryFolderGroups } from './inventory-folder-presentation.ts';
import styles from './inventory-save-fields.module.css';

type ReadyState = Extract<PlysmithApplicationState, { phase: 'ready' }>;

export function InventoryFolderField({
  state,
  value,
  onChange,
  contextOnly,
  disabled,
  canInherit,
}: {
  readonly state: ReadyState;
  readonly value: string | null | undefined;
  readonly onChange: (value: string | null | undefined) => void;
  readonly contextOnly: boolean;
  readonly disabled: boolean;
  readonly canInherit: boolean;
}) {
  const intl = useIntl();
  const folders = inventoryFolderGroups(
    state.inventoryOrganization,
    state.inventory.items,
    contextOnly,
    intl.locale,
  );
  const unavailable =
    typeof value === 'string' &&
    !folders.some((folder) => folder.folderId === value);
  return (
    <label className={styles.field}>
      <span>
        <FormattedMessage id="folders.saveDestination" />
      </span>
      <select
        value={value === undefined ? 'inherit' : value === null ? '' : value}
        disabled={disabled}
        onChange={(event) =>
          onChange(
            event.target.value === 'inherit'
              ? undefined
              : event.target.value === ''
                ? null
                : event.target.value,
          )
        }
      >
        {canInherit && (
          <option value="inherit">
            {intl.formatMessage({ id: 'folders.inheritDestination' })}
          </option>
        )}
        {unavailable && (
          <option value={value} disabled>
            {intl.formatMessage({ id: 'folders.unavailable' })}
          </option>
        )}
        <option value="">
          {intl.formatMessage({ id: 'folders.unfiled' })}
        </option>
        {folders
          .filter((folder) => folder.folderId !== undefined)
          .map((folder) => (
            <option key={folder.folderId} value={folder.folderId}>
              {folder.path}
            </option>
          ))}
      </select>
      {unavailable && (
        <span role="alert">
          <FormattedMessage id="folders.chooseAvailable" />
        </span>
      )}
    </label>
  );
}

export function InventoryNameSuggestion({
  name,
  store,
  onChoose,
  excludingItemId,
  disabled,
}: {
  readonly name: string;
  readonly store: PlysmithApplicationStore;
  readonly onChoose: (name: string) => void;
  readonly excludingItemId?: string;
  readonly disabled: boolean;
}) {
  const [suggestion, setSuggestion] = useState<string>();
  useEffect(() => {
    let active = true;
    setSuggestion(undefined);
    const timer = setTimeout(() => {
      void store
        .checkInventoryName(name, excludingItemId)
        .then((availability) => {
          if (active && availability?.available === false)
            setSuggestion(availability.suggestedDisplayName);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [name, excludingItemId, store]);
  if (suggestion === undefined) return null;
  return (
    <div className={styles.suggestion} role="status">
      <span>
        <FormattedMessage id="name.suggestion" values={{ name: suggestion }} />
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChoose(suggestion)}
      >
        <FormattedMessage id="name.useSuggestion" />
      </button>
    </div>
  );
}
