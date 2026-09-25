import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { FormattedMessage } from 'react-intl';

import styles from './inventory-metadata-form.module.css';

export function InventoryMetadataForm({
  displayName,
  summary,
  isBusy,
  onCancel,
  onPrepare,
}: {
  readonly displayName: string;
  readonly summary: string | undefined;
  readonly isBusy: boolean;
  readonly onCancel: () => void;
  readonly onPrepare: (displayName: string, summary: string | null) => void;
}) {
  const [nextDisplayName, setNextDisplayName] = useState(displayName);
  const [nextSummary, setNextSummary] = useState(summary ?? '');

  useEffect(() => {
    setNextDisplayName(displayName);
    setNextSummary(summary ?? '');
  }, [displayName, summary]);

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
          disabled={isBusy || nextDisplayName.trim() === ''}
        >
          <ArrowRight aria-hidden="true" size={15} />
          <FormattedMessage id="draft.reviewChange" />
        </button>
      </div>
    </form>
  );
}
