import { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { Button } from 'react-aria-components';
import { FormattedMessage } from 'react-intl';

import { InventoryContentPreview } from './inventory-content-preview.tsx';
import type {
  InventoryDetailsRead,
  InventoryItem,
  PlysmithApplicationStore,
} from './plysmith-application-store.ts';
import styles from './manage-view.module.css';

export function InventoryDetailsView({
  item,
  store,
}: {
  readonly item: InventoryItem;
  readonly store: PlysmithApplicationStore;
}) {
  const [result, setResult] = useState<InventoryDetailsRead>();
  const [attempt, setAttempt] = useState(0);
  const { itemId, currentRevisionId } = item;

  useEffect(() => {
    let active = true;
    void store
      .readInventoryDetails({ itemId, currentRevisionId })
      .then((read) => {
        if (active) setResult(read);
      });
    return () => {
      active = false;
    };
  }, [store, itemId, currentRevisionId, attempt]);

  if (result?.kind === 'completed')
    return <InventoryContentPreview record={result.record} />;
  if (result === undefined || result.kind === 'cancelled')
    return (
      <p role="status" className={styles.previewStatus}>
        <FormattedMessage id="manage.previewLoading" />
      </p>
    );
  return (
    <div className={styles.previewStatus} role="status">
      <p>
        <FormattedMessage
          id={
            result.errorCode === 'inventory.item_not_found'
              ? 'manage.previewUnavailable'
              : 'manage.previewFailed'
          }
        />
      </p>
      <Button
        className={styles.secondaryButton!}
        onPress={() => {
          setResult(undefined);
          setAttempt((current) => current + 1);
        }}
      >
        <RotateCw size={16} aria-hidden="true" />
        <FormattedMessage id="action.retry" />
      </Button>
    </div>
  );
}
