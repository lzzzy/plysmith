import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  Trash2,
  X,
} from 'lucide-react';
import { Button, Dialog, Modal, ModalOverlay } from 'react-aria-components';
import { FormattedMessage, useIntl } from 'react-intl';

import type {
  PlysmithApplicationStore,
  RevisionImpactDetails,
} from './plysmith-application-store.ts';
import { RevisionLineComparison } from './revision-line-comparison.tsx';
import styles from './revision-impact-view.module.css';

export function RevisionImpactView({
  details,
  store,
  isBusy,
}: {
  readonly details: RevisionImpactDetails;
  readonly store: PlysmithApplicationStore;
  readonly isBusy: boolean;
}) {
  const intl = useIntl();
  return (
    <ModalOverlay
      className={styles.overlay!}
      isOpen
      isDismissable={!isBusy}
      onOpenChange={(open) => {
        if (!open) store.closeRevisionImpact();
      }}
    >
      <Modal className={styles.modal!}>
        <Dialog
          className={styles.dialog!}
          aria-labelledby="revision-impact-title"
        >
          <header className={styles.header}>
            <div className={styles.titleIcon}>
              <AlertTriangle aria-hidden="true" size={20} />
            </div>
            <div>
              <span className={styles.eyebrow}>
                <FormattedMessage id="revisionImpact.eyebrow" />
              </span>
              <h2 id="revision-impact-title">
                <FormattedMessage id="revisionImpact.title" />
              </h2>
              <p>
                <FormattedMessage
                  id="revisionImpact.intro"
                  values={{
                    name: details.targetRevision.displayName,
                    revision: details.pinnedRevision.revisionNumber,
                  }}
                />
              </p>
            </div>
            <Button
              className={styles.closeButton!}
              aria-label={intl.formatMessage({ id: 'analysis.cancel' })}
              onPress={() => store.closeRevisionImpact()}
              isDisabled={isBusy}
            >
              <X aria-hidden="true" size={18} />
            </Button>
          </header>
          <RevisionImpactResolutionPanel
            details={details}
            store={store}
            isBusy={isBusy}
          />
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

export function RevisionImpactResolutionPanel({
  details,
  store,
  isBusy,
}: {
  readonly details: RevisionImpactDetails;
  readonly store: PlysmithApplicationStore;
  readonly isBusy: boolean;
}) {
  const intl = useIntl();
  const [copyName, setCopyName] = useState('');

  useEffect(() => {
    setCopyName(
      intl.formatMessage(
        { id: 'revisionImpact.copyName' },
        { name: details.pinnedRevision.displayName },
      ),
    );
  }, [details.impact.impactId, details.impact.impactVersion, intl]);

  const resolve = (
    resolution:
      | { readonly kind: 'use_target' }
      | { readonly kind: 'keep_copy'; readonly displayName: string }
      | { readonly kind: 'remove_from_context' },
  ) =>
    store.resolveRevisionImpact({
      expectedImpactVersion: details.impact.impactVersion,
      resolution,
    });

  async function keepCopy(event: FormEvent) {
    event.preventDefault();
    const displayName = copyName.trim();
    if (displayName === '') return;
    await resolve({ kind: 'keep_copy', displayName });
  }

  return (
    <div className={styles.resolutionPanel}>
      <div className={styles.revisionRoute}>
        <span>
          <FormattedMessage
            id="revisionImpact.oldRevision"
            values={{ revision: details.pinnedRevision.revisionNumber }}
          />
        </span>
        <ArrowRight aria-hidden="true" size={17} />
        <strong>
          <FormattedMessage
            id="revisionImpact.newRevision"
            values={{ revision: details.targetRevision.revisionNumber }}
          />
        </strong>
      </div>

      <RevisionLineComparison
        previous={details.pinnedRevision}
        next={details.targetRevision}
      />

      <section
        className={styles.choices}
        aria-labelledby="revision-impact-choices"
      >
        <div className={styles.choiceHeading}>
          <strong id="revision-impact-choices">
            <FormattedMessage id="revisionImpact.choose" />
          </strong>
          <p>
            <FormattedMessage id="revisionImpact.chooseDetail" />
          </p>
        </div>

        <div className={styles.choice}>
          <div>
            <strong>
              <FormattedMessage id="revisionImpact.useTarget" />
            </strong>
            <p>
              <FormattedMessage id="revisionImpact.useTargetDetail" />
            </p>
          </div>
          <Button
            className={styles.primaryButton!}
            onPress={() => void resolve({ kind: 'use_target' })}
            isDisabled={isBusy}
          >
            <Check aria-hidden="true" size={16} />
            <FormattedMessage id="revisionImpact.useTargetAction" />
          </Button>
        </div>

        <form className={styles.choice} onSubmit={keepCopy}>
          <div>
            <strong>
              <FormattedMessage id="revisionImpact.keepCopy" />
            </strong>
            <p>
              <FormattedMessage id="revisionImpact.keepCopyDetail" />
            </p>
            <label className={styles.copyName}>
              <span>
                <FormattedMessage id="revisionImpact.copyNameLabel" />
              </span>
              <input
                value={copyName}
                onChange={(event) => setCopyName(event.target.value)}
                disabled={isBusy}
                maxLength={200}
              />
            </label>
          </div>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={isBusy || copyName.trim() === ''}
          >
            <Copy aria-hidden="true" size={16} />
            <FormattedMessage id="revisionImpact.keepCopyAction" />
          </button>
        </form>

        <div className={`${styles.choice} ${styles.removeChoice}`}>
          <div>
            <strong>
              <FormattedMessage id="revisionImpact.remove" />
            </strong>
            <p>
              <FormattedMessage id="revisionImpact.removeDetail" />
            </p>
          </div>
          <Button
            className={styles.removeButton!}
            onPress={() => void resolve({ kind: 'remove_from_context' })}
            isDisabled={isBusy}
          >
            <Trash2 aria-hidden="true" size={16} />
            <FormattedMessage id="revisionImpact.removeAction" />
          </Button>
        </div>
      </section>
    </div>
  );
}
