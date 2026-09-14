import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  Bug,
  CheckCircle2,
  FileArchive,
  Languages,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  Button,
  Dialog,
  Modal,
  ModalOverlay,
  Radio,
  RadioGroup,
} from 'react-aria-components';
import { FormattedMessage, useIntl } from 'react-intl';

import {
  type PlysmithApplicationState,
  type PlysmithApplicationStore,
} from './plysmith-application-store.ts';
import type { UiLocale } from './messages.ts';
import styles from './settings-view.module.css';

type ReadyState = Extract<PlysmithApplicationState, { phase: 'ready' }>;

export function SettingsView({
  state,
  store,
}: {
  readonly state: ReadyState;
  readonly store: PlysmithApplicationStore;
}) {
  const intl = useIntl();
  const [draftLocale, setDraftLocale] = useState<UiLocale>(
    state.preferences.uiLocale,
  );
  const [draftDiagnosticLevel, setDraftDiagnosticLevel] = useState(
    state.diagnostics.configuredLevel,
  );
  const [reportReviewOpen, setReportReviewOpen] = useState(false);
  useEffect(() => {
    setDraftLocale(state.preferences.uiLocale);
  }, [state.preferences.uiLocale]);
  useEffect(() => {
    setDraftDiagnosticLevel(state.diagnostics.configuredLevel);
  }, [state.diagnostics.configuredLevel]);

  const saving = state.busyCommand === 'set_language';
  const savingDiagnostics = state.busyCommand === 'set_diagnostic_log_level';
  const creatingReport = state.busyCommand === 'create_diagnostic_report';
  return (
    <main className={styles.settingsView}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>
            <FormattedMessage id="settings.eyebrow" />
          </span>
          <h1>
            <FormattedMessage id="settings.title" />
          </h1>
        </div>
        <span className={styles.stateBadge}>
          <span className={styles.statusDotReady} />
          {intl.formatMessage({ id: `state.${state.status.state}` })}
        </span>
      </header>

      <section
        className={styles.settingsSection}
        aria-labelledby="language-title"
      >
        <div className={styles.sectionHeading}>
          <span className={styles.sectionIcon}>
            <Languages aria-hidden="true" size={19} />
          </span>
          <div>
            <h2 id="language-title">
              <FormattedMessage id="language.title" />
            </h2>
            <p>
              <FormattedMessage id="language.description" />
            </p>
          </div>
        </div>
        <div className={styles.controlRow}>
          <RadioGroup
            aria-label={intl.formatMessage({ id: 'language.controlLabel' })}
            className={styles.segmentedControl!}
            value={draftLocale}
            onChange={(value) => setDraftLocale(value as UiLocale)}
            orientation="horizontal"
          >
            <Radio className={styles.segment!} value="de-DE">
              <FormattedMessage id="language.german" />
            </Radio>
            <Radio className={styles.segment!} value="en-GB">
              <FormattedMessage id="language.english" />
            </Radio>
          </RadioGroup>
          <Button
            className={styles.primaryButton!}
            isDisabled={saving || draftLocale === state.preferences.uiLocale}
            onPress={() => void store.setUiLanguage(draftLocale)}
          >
            {saving ? (
              <RefreshCw
                aria-hidden="true"
                className={styles.spinning}
                size={16}
              />
            ) : (
              <CheckCircle2 aria-hidden="true" size={16} />
            )}
            <FormattedMessage id={saving ? 'state.saving' : 'action.apply'} />
          </Button>
        </div>
      </section>

      <section
        className={styles.settingsSection}
        aria-labelledby="diagnostics-title"
      >
        <div className={styles.sectionHeading}>
          <span className={`${styles.sectionIcon} ${styles.diagnosticsIcon}`}>
            <Bug aria-hidden="true" size={19} />
          </span>
          <div>
            <h2 id="diagnostics-title">
              <FormattedMessage id="diagnostics.title" />
            </h2>
            <p>
              <FormattedMessage id="diagnostics.description" />
            </p>
          </div>
        </div>

        <div className={styles.diagnosticsControl}>
          <div className={styles.controlRow}>
            <RadioGroup
              aria-label={intl.formatMessage({
                id: 'diagnostics.levelControlLabel',
              })}
              className={`${styles.segmentedControl!} ${styles.diagnosticSegments!}`}
              value={draftDiagnosticLevel}
              onChange={(value) =>
                setDraftDiagnosticLevel(
                  value as ReadyState['diagnostics']['configuredLevel'],
                )
              }
              orientation="horizontal"
            >
              {(['off', 'error', 'info', 'debug'] as const).map((level) => (
                <Radio className={styles.segment!} value={level} key={level}>
                  <FormattedMessage id={`diagnostics.level.${level}`} />
                </Radio>
              ))}
            </RadioGroup>
            <Button
              className={styles.primaryButton!}
              isDisabled={
                savingDiagnostics ||
                draftDiagnosticLevel === state.diagnostics.configuredLevel
              }
              onPress={() =>
                void store.setDiagnosticLogLevel(draftDiagnosticLevel)
              }
            >
              {savingDiagnostics ? (
                <RefreshCw
                  aria-hidden="true"
                  className={styles.spinning}
                  size={16}
                />
              ) : (
                <CheckCircle2 aria-hidden="true" size={16} />
              )}
              <FormattedMessage
                id={savingDiagnostics ? 'state.saving' : 'action.apply'}
              />
            </Button>
          </div>
          <p className={styles.activeLevel}>
            <FormattedMessage
              id="diagnostics.activeLevel"
              values={{
                level: intl.formatMessage({
                  id: `diagnostics.level.${state.diagnostics.activeLevel}`,
                }),
              }}
            />
          </p>
          {state.diagnostics.restartRequired && (
            <p className={styles.restartNotice} role="status">
              <RefreshCw aria-hidden="true" size={15} />
              <FormattedMessage id="diagnostics.restartRequired" />
            </p>
          )}
        </div>

        <div className={styles.reportRow}>
          <div>
            <strong>
              <FormattedMessage id="diagnostics.reportTitle" />
            </strong>
            <p>
              <FormattedMessage id="diagnostics.reportDescription" />
            </p>
          </div>
          <Button
            className={styles.secondaryButton!}
            isDisabled={creatingReport}
            onPress={() => setReportReviewOpen(true)}
          >
            <FileArchive aria-hidden="true" size={16} />
            <FormattedMessage id="diagnostics.reviewReport" />
          </Button>
        </div>
      </section>

      <section
        className={styles.settingsSection}
        aria-labelledby="system-title"
      >
        <div className={styles.sectionHeading}>
          <span className={`${styles.sectionIcon} ${styles.systemIcon}`}>
            <Activity aria-hidden="true" size={19} />
          </span>
          <div>
            <h2 id="system-title">
              <FormattedMessage id="system.title" />
            </h2>
            <p>
              <FormattedMessage id="system.description" />
            </p>
          </div>
        </div>
        <div className={styles.systemOverview}>
          <div>
            <span className={styles.metadataLabel}>
              <FormattedMessage id="system.persistence" />
            </span>
            <strong>
              <FormattedMessage id="system.connected" />
            </strong>
          </div>
          <span className={styles.revision}>
            r{state.status.persistence.dataRevision}
          </span>
        </div>
        <details className={styles.technicalDetails}>
          <summary>
            <FormattedMessage id="system.details" />
          </summary>
          <dl>
            <DetailRow
              label="system.release"
              value={state.status.productRelease}
            />
            <DetailRow
              label="system.schema"
              value={String(state.status.persistence.schemaVersion)}
            />
            <DetailRow
              label="system.revision"
              value={String(state.status.persistence.dataRevision)}
            />
            <DetailRow
              label="system.contract"
              value={shortFingerprint(state.status.contractFingerprint)}
            />
          </dl>
        </details>
      </section>

      <ModalOverlay
        className={styles.reportOverlay!}
        isOpen={reportReviewOpen}
        isDismissable={!creatingReport}
        onOpenChange={setReportReviewOpen}
      >
        <Modal className={styles.reportModal!}>
          <Dialog
            className={styles.reportDialog!}
            aria-labelledby="diagnostic-report-title"
          >
            <div className={styles.reportDialogHeader}>
              <div>
                <h2 id="diagnostic-report-title">
                  <FormattedMessage id="diagnostics.reportReviewTitle" />
                </h2>
                <p>
                  <FormattedMessage id="diagnostics.reportReviewDescription" />
                </p>
              </div>
              <Button
                className={styles.iconButton!}
                aria-label={intl.formatMessage({ id: 'action.cancel' })}
                isDisabled={creatingReport}
                onPress={() => setReportReviewOpen(false)}
              >
                <X aria-hidden="true" size={18} />
              </Button>
            </div>

            <div className={styles.reportCategories}>
              <ReportCategoryList
                title="diagnostics.included"
                categories={state.diagnosticReportManifest.includedCategories}
                icon={<CheckCircle2 aria-hidden="true" size={17} />}
              />
              <ReportCategoryList
                title="diagnostics.excluded"
                categories={state.diagnosticReportManifest.excludedCategories}
                icon={<ShieldCheck aria-hidden="true" size={17} />}
              />
            </div>

            <div className={styles.reportDialogActions}>
              <Button
                className={styles.secondaryButton!}
                isDisabled={creatingReport}
                onPress={() => setReportReviewOpen(false)}
              >
                <FormattedMessage id="action.cancel" />
              </Button>
              <Button
                className={styles.primaryButton!}
                isDisabled={creatingReport}
                onPress={() =>
                  void store.createDiagnosticReport().then((created) => {
                    if (created) setReportReviewOpen(false);
                  })
                }
              >
                {creatingReport ? (
                  <RefreshCw
                    aria-hidden="true"
                    className={styles.spinning}
                    size={16}
                  />
                ) : (
                  <FileArchive aria-hidden="true" size={16} />
                )}
                <FormattedMessage
                  id={
                    creatingReport
                      ? 'diagnostics.creatingReport'
                      : 'diagnostics.createReport'
                  }
                />
              </Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </main>
  );
}

function ReportCategoryList({
  title,
  categories,
  icon,
}: {
  readonly title: string;
  readonly categories: readonly string[];
  readonly icon: ReactNode;
}) {
  return (
    <section>
      <h3>
        {icon}
        <FormattedMessage id={title} />
      </h3>
      <ul>
        {categories.map((category) => (
          <li key={category}>
            <FormattedMessage id={`diagnostics.category.${category}`} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>
        <FormattedMessage id={label} />
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

function shortFingerprint(value: string): string {
  return value.length > 24 ? `${value.slice(0, 21)}...` : value;
}
