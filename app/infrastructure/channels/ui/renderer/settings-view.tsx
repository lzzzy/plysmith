import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import type { EngineProviderConfigurationInputDto } from '../../host_client/index.ts';
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
  const [selectedEngineId, setSelectedEngineId] = useState(
    state.engineProviders.providers[0]?.instanceId ?? '',
  );
  const configuredEngine = state.engineProviders.providers.find(
    (provider) => provider.instanceId === selectedEngineId,
  );
  const [engineDraft, setEngineDraft] =
    useState<EngineProviderConfigurationInputDto>(() =>
      engineInput(configuredEngine),
    );
  const loadedEngineRevision = useRef(engineRevision(configuredEngine));
  const [engineIssues, setEngineIssues] = useState<readonly string[]>([]);
  useEffect(() => {
    setDraftLocale(state.preferences.uiLocale);
  }, [state.preferences.uiLocale]);
  useEffect(() => {
    setDraftDiagnosticLevel(state.diagnostics.configuredLevel);
  }, [state.diagnostics.configuredLevel]);
  useEffect(() => {
    const revision = engineRevision(configuredEngine);
    if (
      configuredEngine === undefined ||
      revision === loadedEngineRevision.current
    ) {
      return;
    }
    loadedEngineRevision.current = revision;
    setEngineDraft(engineInput(configuredEngine));
    setEngineIssues([]);
  }, [configuredEngine]);

  const saving = state.busyCommand === 'set_language';
  const savingDiagnostics = state.busyCommand === 'set_diagnostic_log_level';
  const creatingReport = state.busyCommand === 'create_diagnostic_report';
  const savingEngine =
    state.busyCommand === 'preview_engine_provider' ||
    state.busyCommand === 'save_engine_provider' ||
    state.busyCommand === 'remove_engine_provider';
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
        aria-labelledby="engine-title"
      >
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
                value={selectedEngineId}
                disabled={savingEngine}
                onChange={(event) => {
                  const instanceId = event.target.value;
                  const selected = state.engineProviders.providers.find(
                    (provider) => provider.instanceId === instanceId,
                  );
                  if (selected === undefined) return;
                  setSelectedEngineId(instanceId);
                  loadedEngineRevision.current = engineRevision(selected);
                  setEngineDraft(engineInput(selected));
                  setEngineIssues([]);
                }}
              >
                {state.engineProviders.providers.length === 0 && (
                  <option value="">
                    {intl.formatMessage({ id: 'engines.noneConfigured' })}
                  </option>
                )}
                {state.engineProviders.providers.map((provider) => (
                  <option key={provider.instanceId} value={provider.instanceId}>
                    {provider.displayName}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.engineCreateActions}>
              <Button
                className={styles.secondaryButton!}
                isDisabled={savingEngine}
                onPress={() => {
                  const draft = newEngineInput(
                    'stockfish-uci',
                    state.engineProviders.providers.map(
                      (provider) => provider.instanceId,
                    ),
                  );
                  setSelectedEngineId('');
                  loadedEngineRevision.current = undefined;
                  setEngineDraft(draft);
                  setEngineIssues([]);
                }}
              >
                <Plus aria-hidden="true" size={16} />
                <FormattedMessage id="engines.addStockfish" />
              </Button>
              <Button
                className={styles.secondaryButton!}
                isDisabled={savingEngine}
                onPress={() => {
                  const draft = newEngineInput(
                    'maia-chess',
                    state.engineProviders.providers.map(
                      (provider) => provider.instanceId,
                    ),
                  );
                  setSelectedEngineId('');
                  loadedEngineRevision.current = undefined;
                  setEngineDraft(draft);
                  setEngineIssues([]);
                }}
              >
                <Plus aria-hidden="true" size={16} />
                <FormattedMessage id="engines.addMaia" />
              </Button>
            </div>
          </div>
          <label className={styles.wideField}>
            <span>
              <FormattedMessage id="engines.executable" />
            </span>
            <div className={styles.pathRow}>
              <input value={engineDraft.executablePath} readOnly />
              <Button
                className={styles.secondaryButton!}
                isDisabled={savingEngine}
                onPress={() =>
                  void store.chooseEngineExecutable().then((selected) => {
                    if (selected !== undefined) {
                      setEngineDraft((current) => ({
                        ...current,
                        executablePath: selected,
                      }));
                      setEngineIssues([]);
                    }
                  })
                }
              >
                <FolderOpen aria-hidden="true" size={16} />
                <FormattedMessage id="engines.choose" />
              </Button>
            </div>
          </label>
          <label>
            <span>
              <FormattedMessage id="engines.displayName" />
            </span>
            <input
              value={engineDraft.displayName}
              onChange={(event) => {
                const displayName = event.target.value;
                setEngineDraft((current) => ({
                  ...current,
                  displayName,
                  instanceId:
                    configuredEngine === undefined
                      ? engineInstanceId(
                          displayName,
                          current.providerType,
                          state.engineProviders.providers.map(
                            (provider) => provider.instanceId,
                          ),
                        )
                      : current.instanceId,
                }));
              }}
            />
          </label>
          {engineDraft.providerType === 'stockfish-uci' ? (
            <>
              <label>
                <span>
                  <FormattedMessage id="engines.moveTime" />
                </span>
                <input
                  type="number"
                  min={10}
                  max={600000}
                  value={engineDraft.moveTimeMs}
                  onChange={(event) =>
                    setEngineDraft((current) =>
                      current.providerType === 'stockfish-uci'
                        ? {
                            ...current,
                            moveTimeMs: Number(event.target.value),
                          }
                        : current,
                    )
                  }
                />
              </label>
              <label>
                <span>
                  <FormattedMessage id="engines.threads" />
                </span>
                <input
                  type="number"
                  min={1}
                  max={256}
                  value={engineDraft.threads}
                  onChange={(event) =>
                    setEngineDraft((current) =>
                      current.providerType === 'stockfish-uci'
                        ? { ...current, threads: Number(event.target.value) }
                        : current,
                    )
                  }
                />
              </label>
              <label>
                <span>
                  <FormattedMessage id="engines.hash" />
                </span>
                <input
                  type="number"
                  min={1}
                  max={65536}
                  value={engineDraft.hashMb}
                  onChange={(event) =>
                    setEngineDraft((current) =>
                      current.providerType === 'stockfish-uci'
                        ? { ...current, hashMb: Number(event.target.value) }
                        : current,
                    )
                  }
                />
              </label>
            </>
          ) : (
            <>
              <label className={styles.wideField}>
                <span>
                  <FormattedMessage id="engines.maiaWeights" />
                </span>
                <div className={styles.pathRow}>
                  <input value={engineDraft.weightsPath} readOnly />
                  <Button
                    className={styles.secondaryButton!}
                    isDisabled={savingEngine}
                    onPress={() =>
                      void store.chooseEngineWeights().then((selected) => {
                        if (selected !== undefined) {
                          setEngineDraft((current) =>
                            withMaiaWeights(current, selected),
                          );
                          setEngineIssues([]);
                        }
                      })
                    }
                  >
                    <FolderOpen aria-hidden="true" size={16} />
                    <FormattedMessage id="engines.choose" />
                  </Button>
                </div>
              </label>
            </>
          )}
          {engineIssues.length > 0 && (
            <p className={styles.engineError} role="alert">
              <FormattedMessage id={`engines.issue.${engineIssues[0]}`} />
            </p>
          )}
          {configuredEngine?.restartRequired && (
            <p className={styles.restartNotice} role="status">
              <RefreshCw aria-hidden="true" size={15} />
              <FormattedMessage id="engines.restartRequired" />
            </p>
          )}
          <div className={styles.engineActions}>
            {configuredEngine !== undefined && (
              <Button
                className={styles.secondaryButton!}
                isDisabled={savingEngine}
                onPress={() => {
                  const removedInstanceId = configuredEngine.instanceId;
                  void store
                    .removeEngineProviderConfiguration(configuredEngine)
                    .then((removed) => {
                      if (!removed) return;
                      const next = state.engineProviders.providers.find(
                        (provider) => provider.instanceId !== removedInstanceId,
                      );
                      setSelectedEngineId(next?.instanceId ?? '');
                      loadedEngineRevision.current = engineRevision(next);
                      setEngineDraft(engineInput(next));
                      setEngineIssues([]);
                    });
                }}
              >
                <Trash2 aria-hidden="true" size={16} />
                <FormattedMessage id="engines.remove" />
              </Button>
            )}
            <Button
              className={styles.primaryButton!}
              isDisabled={
                savingEngine ||
                engineDraft.executablePath.length === 0 ||
                (engineDraft.providerType === 'maia-chess' &&
                  engineDraft.weightsPath.length === 0) ||
                engineDraft.displayName.trim().length === 0
              }
              onPress={() =>
                void store
                  .previewEngineProviderConfiguration(engineDraft)
                  .then(async (preview) => {
                    if (preview === undefined) return;
                    setEngineIssues(preview.issues);
                    if (!preview.valid) return;
                    const saved = await store.saveEngineProviderConfiguration(
                      engineDraft,
                      configuredEngine?.configurationRevision ?? null,
                    );
                    if (saved) {
                      setSelectedEngineId(engineDraft.instanceId);
                    }
                  })
              }
            >
              {savingEngine ? (
                <RefreshCw
                  aria-hidden="true"
                  className={styles.spinning}
                  size={16}
                />
              ) : (
                <CheckCircle2 aria-hidden="true" size={16} />
              )}
              <FormattedMessage
                id={savingEngine ? 'state.saving' : 'engines.save'}
              />
            </Button>
          </div>
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

function engineRevision(
  configured: ReadyState['engineProviders']['providers'][number] | undefined,
): string | undefined {
  return configured === undefined
    ? undefined
    : `${configured.instanceId}\u0000${configured.configurationRevision}`;
}

function engineInput(
  configured: ReadyState['engineProviders']['providers'][number] | undefined,
): EngineProviderConfigurationInputDto {
  if (configured !== undefined) {
    if (configured.providerType === 'maia-chess') {
      return {
        instanceId: configured.instanceId,
        providerType: configured.providerType,
        displayName: configured.displayName,
        executablePath: configured.executablePath,
        weightsPath: configured.weightsPath,
        startupTimeoutMs: configured.startupTimeoutMs,
        moveTimeoutMs: configured.moveTimeoutMs,
        stopTimeoutMs: configured.stopTimeoutMs,
        maxOutputBytes: configured.maxOutputBytes,
      };
    }
    return {
      instanceId: configured.instanceId,
      providerType: configured.providerType,
      displayName: configured.displayName,
      executablePath: configured.executablePath,
      arguments: [...configured.arguments],
      threads: configured.threads,
      hashMb: configured.hashMb,
      moveTimeMs: configured.moveTimeMs,
      startupTimeoutMs: configured.startupTimeoutMs,
      moveTimeoutMs: configured.moveTimeoutMs,
      stopTimeoutMs: configured.stopTimeoutMs,
      maxOutputBytes: configured.maxOutputBytes,
    };
  }
  return newEngineInput('stockfish-uci');
}

function newEngineInput(
  providerType: 'stockfish-uci' | 'maia-chess',
  usedInstanceIds: readonly string[] = [],
): EngineProviderConfigurationInputDto {
  if (providerType === 'maia-chess') {
    const displayName = 'Maia 1500';
    return {
      instanceId: engineInstanceId(displayName, providerType, usedInstanceIds),
      providerType,
      displayName,
      executablePath: '',
      weightsPath: '',
      startupTimeoutMs: 30_000,
      moveTimeoutMs: 30_000,
      stopTimeoutMs: 1_000,
      maxOutputBytes: 1_048_576,
    };
  }
  const displayName = 'Stockfish';
  return {
    instanceId: engineInstanceId(displayName, providerType, usedInstanceIds),
    providerType,
    displayName,
    executablePath: '',
    arguments: [],
    threads: 1,
    hashMb: 64,
    moveTimeMs: 500,
    startupTimeoutMs: 5_000,
    moveTimeoutMs: 10_000,
    stopTimeoutMs: 1_000,
    maxOutputBytes: 1_048_576,
  };
}

function withMaiaWeights(
  current: EngineProviderConfigurationInputDto,
  weightsPath: string,
): EngineProviderConfigurationInputDto {
  if (current.providerType !== 'maia-chess') return current;
  return {
    ...current,
    weightsPath,
  };
}

function engineInstanceId(
  displayName: string,
  providerType: 'stockfish-uci' | 'maia-chess',
  usedInstanceIds: readonly string[],
): string {
  const base =
    displayName
      .trim()
      .replace(/ß/g, 'ss')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') ||
    (providerType === 'maia-chess' ? 'maia' : 'stockfish');
  if (!usedInstanceIds.includes(base)) return base;
  let suffix = 2;
  while (usedInstanceIds.includes(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
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
