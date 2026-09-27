import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  RefreshCw,
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
import { LossSummary } from './loss-summary.tsx';
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
      isKeyboardDismissDisabled={isBusy}
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
  const [choice, setChoice] = useState<{
    readonly impactId: string;
    readonly impactVersion: number;
    readonly dataRevision: number;
    readonly kind: 'use_target' | 'remove_from_context';
  }>();
  const [submitting, setSubmitting] = useState(false);
  const [failedDetails, setFailedDetails] = useState<RevisionImpactDetails>();
  const needsReload = failedDetails === details;
  const pending = useRef(false);
  const busy = isBusy || submitting;
  const activeChoice =
    choice?.impactId === details.impact.impactId &&
    choice.impactVersion === details.impact.impactVersion &&
    choice.dataRevision === details.impact.dataRevision
      ? choice.kind
      : undefined;

  useEffect(() => {
    setCopyName(
      intl.formatMessage(
        { id: 'revisionImpact.copyName' },
        { name: details.pinnedRevision.displayName },
      ),
    );
  }, [details.impact.impactId, details.impact.impactVersion, intl]);

  const resolve = async (
    resolution:
      | { readonly kind: 'use_target' }
      | { readonly kind: 'keep_copy'; readonly displayName: string }
      | { readonly kind: 'remove_from_context' },
  ) => {
    if (busy || pending.current || needsReload) return;
    const current = store.getSnapshot();
    if (
      current.phase !== 'ready' ||
      current.revisionImpact?.impact.impactId !== details.impact.impactId ||
      current.revisionImpact.impact.impactVersion !==
        details.impact.impactVersion ||
      current.revisionImpact.impact.dataRevision !== details.impact.dataRevision
    )
      return;
    pending.current = true;
    setSubmitting(true);
    setFailedDetails(undefined);
    try {
      const resolved = await store.resolveRevisionImpact({
        expectedImpactVersion: details.impact.impactVersion,
        expectedDataRevision: details.impact.dataRevision,
        resolution,
      });
      if (!resolved) setFailedDetails(details);
    } finally {
      pending.current = false;
      setSubmitting(false);
      setChoice(undefined);
    }
  };

  function choose(kind: 'use_target' | 'remove_from_context') {
    if (busy || needsReload) return;
    setChoice({
      impactId: details.impact.impactId,
      impactVersion: details.impact.impactVersion,
      dataRevision: details.impact.dataRevision,
      kind,
    });
  }

  async function keepCopy(event: FormEvent) {
    event.preventDefault();
    const displayName = copyName.trim();
    if (displayName === '' || busy || activeChoice !== undefined) return;
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
              <FormattedMessage id="revisionImpact.useTargetConsequences" />
            </p>
            <LossSummary summary={details.impact.useTargetLoss} />
          </div>
          <Button
            className={styles.primaryButton!}
            onPress={() => choose('use_target')}
            isDisabled={busy || needsReload || activeChoice !== undefined}
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
              <FormattedMessage id="revisionImpact.keepCopyConsequences" />
            </p>
            <LossSummary summary={details.impact.removeFromContextLoss} />
            <label className={styles.copyName}>
              <span>
                <FormattedMessage id="revisionImpact.copyNameLabel" />
              </span>
              <input
                value={copyName}
                onChange={(event) => setCopyName(event.target.value)}
                disabled={busy || needsReload || activeChoice !== undefined}
                maxLength={200}
              />
            </label>
          </div>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={
              busy ||
              needsReload ||
              activeChoice !== undefined ||
              copyName.trim() === ''
            }
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
              <FormattedMessage id="revisionImpact.removeConsequences" />
            </p>
            <LossSummary summary={details.impact.removeFromContextLoss} />
          </div>
          <Button
            className={styles.removeButton!}
            onPress={() => choose('remove_from_context')}
            isDisabled={busy || needsReload || activeChoice !== undefined}
          >
            <Trash2 aria-hidden="true" size={16} />
            <FormattedMessage id="revisionImpact.removeAction" />
          </Button>
        </div>
        {needsReload && (
          <div>
            <p role="alert">
              <FormattedMessage id="revisionImpact.resolveFailed" />
            </p>
            <Button
              className={styles.secondaryButton!}
              isDisabled={busy}
              onPress={() =>
                void store.openRevisionImpact(details.impact.impactId)
              }
            >
              <RefreshCw aria-hidden="true" size={16} />
              <FormattedMessage id="destructive.retry" />
            </Button>
          </div>
        )}
        {activeChoice !== undefined && (
          <section
            className={styles.confirmation}
            aria-labelledby="revision-confirmation-title"
          >
            <strong id="revision-confirmation-title">
              <FormattedMessage
                id={
                  activeChoice === 'use_target'
                    ? 'revisionImpact.useTarget'
                    : 'revisionImpact.remove'
                }
              />
            </strong>
            <p>
              <FormattedMessage id="revisionImpact.confirmDetail" />
            </p>
            <div className={styles.confirmationActions}>
              <Button
                className={styles.secondaryButton!}
                autoFocus
                isDisabled={busy}
                onPress={() => setChoice(undefined)}
              >
                <X aria-hidden="true" size={16} />
                <FormattedMessage id="action.cancel" />
              </Button>
              <Button
                className={styles.removeButton!}
                isDisabled={busy}
                onPress={() => void resolve({ kind: activeChoice })}
              >
                <Check aria-hidden="true" size={16} />
                <FormattedMessage id="revisionImpact.confirm" />
              </Button>
            </div>
          </section>
        )}
      </section>
    </div>
  );
}
