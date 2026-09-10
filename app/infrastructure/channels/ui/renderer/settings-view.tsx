import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Languages,
  RefreshCw,
  Settings,
} from 'lucide-react';
import { Button, Radio, RadioGroup } from 'react-aria-components';
import { FormattedMessage, IntlProvider, useIntl } from 'react-intl';

import type {
  HostReadModelState,
  HostReadModelStore,
} from './host-read-model-store.ts';
import { messages, type UiLocale } from './messages.ts';
import styles from './settings-view.module.css';

export function SettingsApplication({ store }: { store: HostReadModelStore }) {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const locale = state.phase === 'ready' ? state.preferences.uiLocale : 'de-DE';

  useEffect(() => {
    void store.start();
    return () => store.close();
  }, [store]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <IntlProvider locale={locale} messages={messages[locale]}>
      <SettingsView state={state} store={store} />
    </IntlProvider>
  );
}

function SettingsView({
  state,
  store,
}: {
  state: HostReadModelState;
  store: HostReadModelStore;
}) {
  return (
    <div className={styles.applicationFrame}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>P</span>
          <span>Plysmith</span>
        </div>
        <nav aria-label="Plysmith">
          <div className={styles.activeNavigationItem}>
            <Settings aria-hidden="true" size={18} />
            <FormattedMessage id="app.settings" />
          </div>
        </nav>
        <ConnectionSummary state={state} />
      </aside>

      <main className={styles.main}>
        <header className={styles.pageHeader}>
          <div>
            <h1>
              <FormattedMessage id="settings.title" />
            </h1>
            <p>
              <FormattedMessage id="settings.subtitle" />
            </p>
          </div>
          <StateBadge state={state} />
        </header>

        {state.phase === 'loading' && <LoadingState />}
        {state.phase === 'unavailable' && (
          <UnavailableState onRetry={() => void store.start()} />
        )}
        {state.phase === 'ready' && (
          <ReadySettings state={state} store={store} />
        )}
      </main>
    </div>
  );
}

function ReadySettings({
  state,
  store,
}: {
  state: Extract<HostReadModelState, { phase: 'ready' }>;
  store: HostReadModelStore;
}) {
  const intl = useIntl();
  const [draftLocale, setDraftLocale] = useState<UiLocale>(
    state.preferences.uiLocale,
  );
  useEffect(() => {
    setDraftLocale(state.preferences.uiLocale);
  }, [state.preferences.uiLocale]);

  return (
    <div className={styles.contentStack}>
      {state.errorCode !== undefined && (
        <ErrorNotice errorCode={state.errorCode} />
      )}

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
            isDisabled={
              state.saving || draftLocale === state.preferences.uiLocale
            }
            onPress={() => void store.setUiLanguage(draftLocale)}
          >
            {state.saving ? (
              <RefreshCw
                aria-hidden="true"
                className={styles.spinning}
                size={16}
              />
            ) : (
              <CheckCircle2 aria-hidden="true" size={16} />
            )}
            <FormattedMessage
              id={state.saving ? 'state.saving' : 'action.apply'}
            />
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
    </div>
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

function ConnectionSummary({ state }: { state: HostReadModelState }) {
  return (
    <div className={styles.connectionSummary}>
      <span
        className={
          state.phase === 'ready'
            ? styles.statusDotReady
            : styles.statusDotMuted
        }
      />
      <span>
        <FormattedMessage
          id={
            state.phase === 'ready'
              ? 'system.connected'
              : state.phase === 'loading'
                ? 'system.loading'
                : 'system.unavailable'
          }
        />
      </span>
    </div>
  );
}

function StateBadge({ state }: { state: HostReadModelState }) {
  const intl = useIntl();
  if (state.phase !== 'ready') {
    return null;
  }
  return (
    <span className={styles.stateBadge}>
      <span className={styles.statusDotReady} />
      {intl.formatMessage({ id: `state.${state.status.state}` })}
    </span>
  );
}

function LoadingState() {
  return (
    <div className={styles.centeredState} role="status">
      <RefreshCw aria-hidden="true" className={styles.spinning} size={24} />
      <p>
        <FormattedMessage id="system.loading" />
      </p>
    </div>
  );
}

function UnavailableState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={styles.centeredState}>
      <span className={styles.warningIcon}>
        <AlertTriangle aria-hidden="true" size={23} />
      </span>
      <h2>
        <FormattedMessage id="system.unavailable" />
      </h2>
      <p>
        <FormattedMessage id="system.unavailableDetail" />
      </p>
      <Button className={styles.secondaryButton!} onPress={onRetry}>
        <RefreshCw aria-hidden="true" size={16} />
        <FormattedMessage id="action.retry" />
      </Button>
    </div>
  );
}

function ErrorNotice({ errorCode }: { errorCode: string }) {
  const messageId =
    errorCode === 'preference.revision_conflict'
      ? 'error.revision'
      : errorCode === 'host.unavailable'
        ? 'error.unavailable'
        : 'error.generic';
  return (
    <div className={styles.errorNotice} role="alert">
      <AlertTriangle aria-hidden="true" size={17} />
      <FormattedMessage id={messageId} />
    </div>
  );
}

function shortFingerprint(value: string): string {
  return value.length > 24 ? `${value.slice(0, 21)}...` : value;
}
