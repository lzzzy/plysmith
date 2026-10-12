import { useEffect, useRef } from 'react';
import { Archive, Download, FolderOpen, RotateCcw } from 'lucide-react';
import { Button, Dialog, Modal, ModalOverlay } from 'react-aria-components';
import { FormattedMessage, useIntl } from 'react-intl';
import type { InventoryBackupCountsDto } from '../../host_client/index.ts';
import type {
  PlysmithApplicationState,
  PlysmithApplicationStore,
} from './plysmith-application-store.ts';
import { ErrorNotice } from './error-notice.tsx';
import styles from './settings-view.module.css';

export function InventoryBackupSettings({
  state,
  store,
}: {
  readonly state: Extract<PlysmithApplicationState, { phase: 'ready' }>;
  readonly store: PlysmithApplicationStore;
}) {
  const intl = useIntl();
  const transfer = state.inventoryTransfer ?? { phase: 'idle' as const };
  const preview = transfer.preview;
  const busy = state.busyCommand !== undefined || transfer.phase !== 'idle';
  const publishing = transfer.phase === 'publishing';
  const localDrafts = store.hasInventoryRestoreDrafts();
  const backupButton = useRef<HTMLButtonElement>(null);
  const previousPhase = useRef(transfer.phase);
  useEffect(() => {
    void store.refreshInventoryBackupStatus();
  }, [store]);
  useEffect(() => {
    if (previousPhase.current !== 'idle' && transfer.phase === 'idle')
      backupButton.current?.focus();
    previousPhase.current = transfer.phase;
  }, [transfer.phase]);
  return (
    <section className={styles.settingsSection} aria-labelledby="backup-title">
      <div className={styles.sectionHeading}>
        <span className={styles.sectionIcon}>
          <Archive aria-hidden="true" size={19} />
        </span>
        <div>
          <h2 id="backup-title">
            <FormattedMessage id="backup.title" />
          </h2>
          <p>
            <FormattedMessage id="backup.scope" />
          </p>
        </div>
      </div>
      <div className={styles.backupContent}>
        <p>
          <FormattedMessage id="backup.newFile" />
        </p>
        <Button
          ref={backupButton}
          className={styles.primaryButton!}
          isDisabled={busy}
          onPress={() => void store.createInventoryBackup()}
        >
          <Download aria-hidden="true" size={16} />
          <FormattedMessage id="backup.create" />
        </Button>
        <p id="backup-fresh">
          <FormattedMessage id="backup.fresh" />
        </p>
        <p role="status">
          {localDrafts ? (
            <FormattedMessage id="backup.localDrafts" />
          ) : transfer.status === undefined ? (
            <FormattedMessage id="backup.checking" />
          ) : !transfer.status.canRestore && transfer.phase === 'idle' ? (
            <FormattedMessage id="backup.blocked" />
          ) : null}
        </p>
        {transfer.phase === 'idle' && transfer.status?.canRestore === false && (
          <ul>
            {transfer.status.blockerCodes.map((code) => (
              <li key={code}>
                <FormattedMessage id={`backup.blocker.${code}`} />
              </li>
            ))}
          </ul>
        )}
        <Button
          className={styles.primaryButton!}
          aria-describedby="backup-fresh"
          isDisabled={busy || localDrafts || !transfer.status?.canRestore}
          onPress={() => void store.prepareInventoryRestore()}
        >
          <FolderOpen aria-hidden="true" size={16} />
          <FormattedMessage id="backup.chooseRestore" />
        </Button>
        {transfer.phase !== 'idle' && transfer.phase !== 'prepared' && (
          <p role="status">
            <FormattedMessage
              id={
                publishing
                  ? 'backup.publishing'
                  : transfer.phase === 'preparing'
                    ? 'backup.preparing'
                    : 'backup.busy'
              }
            />
          </p>
        )}
        {(transfer.phase === 'preparing' ||
          transfer.phase === 'choosing_restore' ||
          transfer.phase === 'choosing_backup') && (
          <Button
            className={styles.secondaryButton!}
            onPress={() => void store.cancelInventoryRestore()}
          >
            <FormattedMessage id="action.cancel" />
          </Button>
        )}
        {transfer.errorCode !== undefined && preview === undefined && (
          <ErrorNotice errorCode={transfer.errorCode} />
        )}
        {transfer.created !== undefined && (
          <div role="status">
            <p>
              <FormattedMessage
                id="backup.created"
                values={{ fileName: transfer.created.fileName }}
              />
            </p>
            <BackupCounts counts={transfer.created.counts} />
          </div>
        )}
        {transfer.restored !== undefined && (
          <div role="status">
            <p>
              <FormattedMessage
                id={transfer.restored.noOp ? 'backup.noOp' : 'backup.restored'}
              />
            </p>
            <BackupCounts counts={transfer.restored.counts} />
          </div>
        )}
      </div>
      <ModalOverlay
        className={styles.reportOverlay!}
        isOpen={preview !== undefined}
        isDismissable={!publishing}
        isKeyboardDismissDisabled={publishing}
        onOpenChange={(open) => {
          if (!open) void store.cancelInventoryRestore();
        }}
      >
        <Modal className={styles.reportModal!}>
          <Dialog
            className={styles.reportDialog!}
            aria-labelledby="backup-review-title"
          >
            <div className={styles.reportDialogHeader}>
              <div>
                <h2 id="backup-review-title">
                  <FormattedMessage id="backup.review" />
                </h2>
                <p>
                  <FormattedMessage id="backup.fresh" />
                </p>
              </div>
            </div>
            <div className={styles.backupPreviewContent}>
              {preview !== undefined && (
                <>
                  <BackupCounts counts={preview.counts} />
                  <p>
                    <FormattedMessage
                      id="backup.expires"
                      values={{
                        time: intl.formatTime(new Date(preview.expiresAt)),
                      }}
                    />
                  </p>
                </>
              )}
              {transfer.errorCode !== undefined && (
                <ErrorNotice errorCode={transfer.errorCode} />
              )}
            </div>
            <div className={styles.reportDialogActions}>
              <Button
                autoFocus
                className={styles.secondaryButton!}
                isDisabled={publishing}
                onPress={() => void store.cancelInventoryRestore()}
              >
                <FormattedMessage id="action.cancel" />
              </Button>
              <Button
                className={styles.primaryButton!}
                isDisabled={publishing || localDrafts}
                onPress={() => void store.restoreInventory()}
              >
                <RotateCcw aria-hidden="true" size={16} />
                <FormattedMessage
                  id={publishing ? 'backup.publishing' : 'backup.confirm'}
                />
              </Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </section>
  );
}

function BackupCounts({
  counts,
}: {
  readonly counts: InventoryBackupCountsDto;
}) {
  return (
    <dl className={styles.backupCounts}>
      {(
        [
          'analyses',
          'games',
          'folders',
          'provenanceRecords',
          'contributions',
        ] as const
      ).map((key) => (
        <div key={key}>
          <dt>
            <FormattedMessage id={`backup.count.${key}`} />
          </dt>
          <dd>{counts[key]}</dd>
        </div>
      ))}
    </dl>
  );
}
