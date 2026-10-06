import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  Bug,
  CheckCircle2,
  Cpu,
  FileArchive,
  FolderOpen,
  Languages,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Undo2,
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
import { LiveSettings } from './live-settings.tsx';
import {
  type EngineConfigurationDraft,
  type EngineConfigurationField,
} from './engine-configuration-drafts.ts';
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

      <EngineSettings state={state} store={store} />
      <LiveSettings state={state} store={store} />

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
            className={styles.primaryButton!}
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

function EngineSettings({
  state,
  store,
}: {
  readonly state: ReadyState;
  readonly store: PlysmithApplicationStore;
}) {
  const intl = useIntl();
  const { entries, selectedKey } = state.engineConfigurationDrafts;
  const selected = entries.find((entry) => entry.key === selectedKey);
  const configuredEngine =
    selected?.baseline === null
      ? undefined
      : state.engineProviders.providers.find(
          (provider) => provider.instanceId === selected?.form.instanceId,
        );
  const busy =
    state.busyCommand === 'preview_engine_provider' ||
    state.busyCommand === 'save_engine_provider' ||
    state.busyCommand === 'remove_engine_provider';
  const update = (field: EngineConfigurationField, value: string) => {
    if (selected !== undefined)
      store.updateEngineConfigurationDraft(selected.key, { [field]: value });
  };
  const fieldAttributes = (field: EngineConfigurationField) => ({
    id: `engine-${field}`,
    'aria-invalid':
      selected?.issues.some((issue) => issue.field === field) || undefined,
    'aria-describedby': selected?.issues.some((issue) => issue.field === field)
      ? `engine-${field}-error`
      : undefined,
  });
  return (
    <section className={styles.settingsSection} aria-labelledby="engine-title">
      <div className={styles.sectionHeading}>
        <span className={`${styles.sectionIcon} ${styles.engineIcon}`}>
          <Cpu aria-hidden="true" size={19} />
        </span>
        <div>
          <h2 id="engine-title">
            <FormattedMessage id="engines.title" />
          </h2>
          <p>
            <FormattedMessage id="engines.description" />
          </p>
        </div>
      </div>
      <div className={styles.engineForm}>
        <div className={styles.engineChooser}>
          <label>
            <span>
              <FormattedMessage id="engines.configuration" />
            </span>
            <select
              value={selectedKey ?? ''}
              disabled={busy}
              onChange={(event) =>
                store.selectEngineConfiguration(event.target.value)
              }
            >
              {entries.length === 0 && (
                <option value="">
                  {intl.formatMessage({ id: 'engines.noneConfigured' })}
                </option>
              )}
              {entries.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.form.displayName ||
                    (entry.form.providerType === 'stockfish-uci'
                      ? 'Stockfish'
                      : 'Maia Chess')}
                  {entry.baseline === null
                    ? ` (${intl.formatMessage({ id: 'engines.newDraft' })})`
                    : ''}
                  {entry.dirty
                    ? ` * ${intl.formatMessage({ id: 'engines.unsaved' })}`
                    : ''}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.engineCreateActions}>
            <Button
              className={styles.primaryButton!}
              isDisabled={busy}
              onPress={() =>
                store.createEngineConfigurationDraft('stockfish-uci')
              }
            >
              <Plus aria-hidden="true" size={16} />
              <FormattedMessage id="engines.addStockfish" />
            </Button>
            <Button
              className={styles.primaryButton!}
              isDisabled={busy}
              onPress={() => store.createEngineConfigurationDraft('maia-chess')}
            >
              <Plus aria-hidden="true" size={16} />
              <FormattedMessage id="engines.addMaia" />
            </Button>
          </div>
        </div>
        {selected !== undefined && (
          <>
            <div className={styles.wideField}>
              <label htmlFor="engine-executablePath">
                <FormattedMessage id="engines.executable" />
              </label>
              <div className={styles.pathRow}>
                <input
                  {...fieldAttributes('executablePath')}
                  value={selected.form.executablePath}
                  readOnly
                />
                <Button
                  className={styles.primaryButton!}
                  isDisabled={busy}
                  onPress={() => {
                    const key = selected.key;
                    void store.chooseEngineExecutable().then((path) => {
                      if (path !== undefined)
                        store.updateEngineConfigurationDraft(key, {
                          executablePath: path,
                        });
                    });
                  }}
                >
                  <FolderOpen aria-hidden="true" size={16} />
                  <FormattedMessage id="engines.choose" />
                </Button>
              </div>
              <EngineFieldError draft={selected} field="executablePath" />
            </div>
            <div className={styles.engineField}>
              <label htmlFor="engine-displayName">
                <FormattedMessage id="engines.displayName" />
              </label>
              <input
                {...fieldAttributes('displayName')}
                disabled={busy}
                value={selected.form.displayName}
                onChange={(event) => update('displayName', event.target.value)}
              />
              <EngineFieldError draft={selected} field="displayName" />
            </div>
            {selected.form.providerType === 'stockfish-uci' ? (
              <>
                {(
                  [
                    'threads',
                    'hashMb',
                    'fast',
                    'thorough',
                    'very_deep',
                  ] as const
                ).map((field) => (
                  <div className={styles.engineField} key={field}>
                    <label htmlFor={`engine-${field}`}>
                      <FormattedMessage
                        id={
                          field === 'hashMb'
                            ? 'engines.hash'
                            : field === 'threads'
                              ? 'engines.threads'
                              : `engines.detailLevel.${field}`
                        }
                      />
                    </label>
                    <input
                      {...fieldAttributes(field)}
                      type="text"
                      inputMode="numeric"
                      disabled={busy}
                      value={
                        selected.form.providerType === 'stockfish-uci'
                          ? field === 'threads' || field === 'hashMb'
                            ? selected.form[field]
                            : selected.form.detailLevels[field]
                          : ''
                      }
                      onChange={(event) => update(field, event.target.value)}
                    />
                    <EngineFieldError draft={selected} field={field} />
                  </div>
                ))}
                <div className={styles.engineField}>
                  <label htmlFor="engine-playoutBudget">
                    <FormattedMessage id="engines.playoutBudget" />
                  </label>
                  <select
                    {...fieldAttributes('playoutBudget')}
                    disabled={busy}
                    value={selected.form.playoutBudget}
                    onChange={(event) =>
                      update('playoutBudget', event.target.value)
                    }
                  >
                    {(['fast', 'thorough', 'very_deep'] as const).map(
                      (budget) => (
                        <option key={budget} value={budget}>
                          {intl.formatMessage({
                            id: `positionAnalysis.budget.${budget}`,
                          })}
                        </option>
                      ),
                    )}
                  </select>
                </div>
              </>
            ) : (
              <div className={styles.wideField}>
                <label htmlFor="engine-weightsPath">
                  <FormattedMessage id="engines.maiaWeights" />
                </label>
                <div className={styles.pathRow}>
                  <input
                    {...fieldAttributes('weightsPath')}
                    value={selected.form.weightsPath}
                    readOnly
                  />
                  <Button
                    className={styles.primaryButton!}
                    isDisabled={busy}
                    onPress={() => {
                      const key = selected.key;
                      void store.chooseEngineWeights().then((path) => {
                        if (path !== undefined)
                          store.updateEngineConfigurationDraft(key, {
                            weightsPath: path,
                          });
                      });
                    }}
                  >
                    <FolderOpen aria-hidden="true" size={16} />
                    <FormattedMessage id="engines.choose" />
                  </Button>
                </div>
                <EngineFieldError draft={selected} field="weightsPath" />
              </div>
            )}
            {selected.issues
              .filter((issue) => issue.field === undefined)
              .map((issue, index) => (
                <p key={index} className={styles.engineError} role="alert">
                  <FormattedMessage
                    id={issue.messageId}
                    values={issue.values ?? {}}
                  />
                </p>
              ))}
            {configuredEngine?.restartRequired && (
              <p className={styles.restartNotice} role="status">
                <RefreshCw aria-hidden="true" size={15} />
                <FormattedMessage id="engines.restartRequired" />
              </p>
            )}
            <div className={styles.engineActions}>
              {selected.dirty && (
                <span className={styles.draftStatus} role="status">
                  <FormattedMessage id="engines.unsaved" />
                </span>
              )}
              {configuredEngine !== undefined && (
                <Button
                  className={styles.dangerButton!}
                  isDisabled={busy}
                  onPress={() =>
                    void store.removeEngineProviderConfiguration(
                      configuredEngine,
                    )
                  }
                >
                  <Trash2 aria-hidden="true" size={16} />
                  <FormattedMessage id="engines.remove" />
                </Button>
              )}
              <Button
                className={styles.secondaryButton!}
                isDisabled={busy || !selected.dirty}
                onPress={() =>
                  store.discardEngineConfigurationDraft(selected.key)
                }
              >
                <Undo2 aria-hidden="true" size={16} />
                <FormattedMessage id="engines.discard" />
              </Button>
              <Button
                className={styles.primaryButton!}
                isDisabled={busy || !selected.dirty}
                onPress={() =>
                  void store.saveEngineConfigurationDraft(selected.key)
                }
              >
                {busy ? (
                  <RefreshCw
                    aria-hidden="true"
                    className={styles.spinning}
                    size={16}
                  />
                ) : (
                  <CheckCircle2 aria-hidden="true" size={16} />
                )}
                <FormattedMessage id={busy ? 'state.saving' : 'engines.save'} />
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function EngineFieldError({
  draft,
  field,
}: {
  readonly draft: EngineConfigurationDraft;
  readonly field: EngineConfigurationField;
}) {
  const issues = draft.issues.filter((issue) => issue.field === field);
  return issues.length === 0 ? null : (
    <span
      id={`engine-${field}-error`}
      className={styles.fieldError}
      role="alert"
    >
      {issues.map((issue, index) => (
        <span key={index}>
          <FormattedMessage id={issue.messageId} values={issue.values ?? {}} />
        </span>
      ))}
    </span>
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
