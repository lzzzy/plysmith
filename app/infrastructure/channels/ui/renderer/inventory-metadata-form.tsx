import { useState, type FormEvent } from 'react';
import { Save, X } from 'lucide-react';
import { FormattedMessage } from 'react-intl';
import type { PlysmithApplicationStore } from './plysmith-application-store.ts';
import { InventoryNameSuggestion } from './inventory-save-fields.tsx';

import styles from './inventory-metadata-form.module.css';

export function InventoryMetadataForm({
  displayName,
  summary,
  isBusy,
  saveBlocked,
  onCancel,
  onPrepare,
  store,
  itemId,
}: {
  readonly displayName: string;
  readonly summary: string | undefined;
  readonly isBusy: boolean;
  readonly saveBlocked: boolean;
  readonly onCancel: () => void;
  readonly onPrepare: (displayName: string, summary: string | null) => void;
  readonly store: PlysmithApplicationStore;
  readonly itemId: string;
}) {
  const [draft, setDraft] = useState({
    itemId,
    displayName,
    summary,
    nextDisplayName: displayName,
    nextSummary: summary ?? '',
  });
  let current = draft;
  if (
    draft.itemId !== itemId ||
    draft.displayName !== displayName ||
    draft.summary !== summary
  ) {
    current = {
      itemId,
      displayName,
      summary,
      nextDisplayName:
        draft.itemId !== itemId || draft.nextDisplayName === draft.displayName
          ? displayName
          : draft.nextDisplayName,
      nextSummary:
        draft.itemId !== itemId || draft.nextSummary === (draft.summary ?? '')
          ? (summary ?? '')
          : draft.nextSummary,
    };
    setDraft(current);
  }
  const { nextDisplayName, nextSummary } = current;
  const setNextDisplayName = (value: string) =>
    setDraft((previous) => ({ ...previous, nextDisplayName: value }));
  const setNextSummary = (value: string) =>
    setDraft((previous) => ({ ...previous, nextSummary: value }));

  function submit(event: FormEvent) {
    event.preventDefault();
    const normalizedName = nextDisplayName.trim();
    if (normalizedName === '') return;
    const normalizedSummary = nextSummary.trim();
    onPrepare(
      normalizedName,
      normalizedSummary === '' ? null : normalizedSummary,
    );
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label>
        <FormattedMessage id="inventory.displayName" />
        <input
          value={nextDisplayName}
          onChange={(event) => setNextDisplayName(event.target.value)}
          maxLength={160}
          disabled={isBusy}
          autoFocus
        />
      </label>
      <InventoryNameSuggestion
        name={nextDisplayName}
        store={store}
        excludingItemId={itemId}
        onChoose={setNextDisplayName}
        disabled={isBusy}
      />
      <label>
        <FormattedMessage id="inventory.summary" />
        <textarea
          value={nextSummary}
          onChange={(event) => setNextSummary(event.target.value)}
          maxLength={2000}
          rows={3}
          disabled={isBusy}
        />
      </label>
      <div className={styles.actions}>
        <button type="button" onClick={onCancel} disabled={isBusy}>
          <X aria-hidden="true" size={15} />
          <FormattedMessage id="action.cancel" />
        </button>
        <button
          type="submit"
          className={styles.primary}
          disabled={isBusy || saveBlocked || nextDisplayName.trim() === ''}
        >
          <Save aria-hidden="true" size={15} />
          <FormattedMessage id="inventory.saveRevision" />
        </button>
      </div>
    </form>
  );
}
