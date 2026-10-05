import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Blocks,
  Radio,
  RefreshCw,
  Settings,
} from 'lucide-react';
import { Button, I18nProvider } from 'react-aria-components';
import { FormattedMessage, IntlProvider, useIntl } from 'react-intl';

import { AnalysisView } from './analysis-view.tsx';
import { ManageView } from './manage-view.tsx';
import { ErrorNotice } from './error-notice.tsx';
import { messages } from './messages.ts';
import {
  type ActivityId,
  type PlysmithApplicationState,
  type PlysmithApplicationStore,
} from './plysmith-application-store.ts';
import { SettingsView } from './settings-view.tsx';
import { PlayoutReplacementDialog, PlayoutView } from './playout-view.tsx';
import styles from './application-shell.module.css';

export function PlysmithApplication({
  store,
}: {
  readonly store: PlysmithApplicationStore;
}) {
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
      <I18nProvider locale={locale}>
        <ApplicationFrame state={state} store={store} />
      </I18nProvider>
    </IntlProvider>
  );
}

function ApplicationFrame({
  state,
  store,
}: {
  readonly state: PlysmithApplicationState;
  readonly store: PlysmithApplicationStore;
}) {
  const intl = useIntl();
  if (state.phase === 'loading') return <LoadingState />;
  if (state.phase === 'unavailable')
    return <UnavailableState onRetry={() => void store.start()} />;

  return (
    <div className={styles.applicationFrame}>
      <aside className={styles.activityRail} aria-label="Plysmith">
        <div className={styles.brand}>
          <img
            src="./branding/plysmith-icon-white-32.png"
            srcSet="./branding/plysmith-icon-white-64.png 2x"
            width="30"
            height="30"
            alt=""
          />
          <span>Plysmith</span>
        </div>
        <nav aria-label="Plysmith">
          <ActivityButton
            activity="manage"
            current={state.activity}
            icon={<Blocks aria-hidden="true" size={19} />}
            onPress={() => store.setActivity('manage')}
          />
          <ActivityButton
            activity="analyze"
            current={state.activity}
            icon={<BarChart3 aria-hidden="true" size={19} />}
            onPress={() => store.setActivity('analyze')}
          />
          <ActivityButton
            activity="playout"
            current={state.activity}
            icon={<Activity aria-hidden="true" size={19} />}
            onPress={() => store.setActivity('playout')}
          />
          <Button className={styles.disabledActivity!} isDisabled>
            <Radio aria-hidden="true" size={19} />
            <FormattedMessage id="activity.live" />
          </Button>
        </nav>
        <Button
          className={`${styles.activityButton!} ${state.activity === 'settings' ? styles.activeActivity : ''}`}
          onPress={() => store.setActivity('settings')}
        >
          <Settings aria-hidden="true" size={19} />
          <FormattedMessage id="activity.settings" />
        </Button>
        <div className={styles.connection}>
          <span />
          <FormattedMessage id="system.connected" />
        </div>
      </aside>

      <div className={styles.applicationSurface}>
        <header className={styles.scopeBar}>
          <label htmlFor="work-scope">
            <FormattedMessage id="scope.label" />
          </label>
          <select
            id="work-scope"
            value={
              state.scope.kind === 'free'
                ? 'free'
                : `context:${state.scope.contextId}`
            }
            onChange={(event) => {
              const value = event.target.value;
              void store.setScope(
                value === 'free'
                  ? { kind: 'free' }
                  : { kind: 'context', contextId: value.slice(8) },
              );
            }}
            disabled={
              state.busyCommand !== undefined ||
              state.pendingPlayoutCompletion !== undefined
            }
          >
            <option value="free">
              {intl.formatMessage({ id: 'scope.free' })}
            </option>
            {state.contexts.contexts.map((context) => (
              <option
                key={context.contextId}
                value={`context:${context.contextId}`}
              >
                {context.displayName}
              </option>
            ))}
          </select>
          {state.refreshing && (
            <RefreshCw
              className={styles.spinning}
              aria-label={intl.formatMessage({ id: 'state.refreshing' })}
              size={15}
            />
          )}
        </header>

        {state.startupNotice !== undefined && (
          <section className={styles.errorNotice} role="status">
            <AlertTriangle aria-hidden="true" size={18} />
            <FormattedMessage
              id={
                state.startupNotice.displayName === undefined
                  ? 'startup.contextUnavailable'
                  : 'startup.namedContextUnavailable'
              }
              values={{ name: state.startupNotice.displayName }}
            />
          </section>
        )}

        {state.errorCode !== undefined && (
          <ErrorNotice
            errorCode={state.errorCode}
            className={styles.errorNotice}
          />
        )}
        <div className={styles.announcement} aria-live="polite">
          {state.announcement !== undefined && (
            <FormattedMessage id={state.announcement} />
          )}
        </div>

        {state.activity === 'manage' && (
          <ManageView state={state} store={store} />
        )}
        {state.activity === 'analyze' && (
          <AnalysisView state={state} store={store} />
        )}
        {state.activity === 'playout' && (
          <PlayoutView state={state} store={store} />
        )}
        {state.activity === 'settings' && (
          <SettingsView state={state} store={store} />
        )}
        <PlayoutReplacementDialog state={state} store={store} />
      </div>
    </div>
  );
}

function ActivityButton({
  activity,
  current,
  icon,
  onPress,
}: {
  readonly activity: Extract<ActivityId, 'manage' | 'analyze' | 'playout'>;
  readonly current: ActivityId;
  readonly icon: ReactNode;
  readonly onPress: () => void;
}) {
  return (
    <Button
      className={`${styles.activityButton!} ${current === activity ? styles.activeActivity : ''}`}
      onPress={onPress}
    >
      {icon}
      <FormattedMessage id={`activity.${activity}`} />
    </Button>
  );
}

function LoadingState() {
  return (
    <div className={styles.centeredState} role="status">
      <img
        src="./branding/plysmith-icon-black-64.png"
        width="52"
        height="52"
        alt=""
      />
      <RefreshCw aria-hidden="true" className={styles.spinning} size={20} />
      <FormattedMessage id="system.loading" />
    </div>
  );
}

function UnavailableState({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div className={styles.centeredState}>
      <AlertTriangle aria-hidden="true" size={28} />
      <h1>
        <FormattedMessage id="system.unavailable" />
      </h1>
      <p>
        <FormattedMessage id="system.unavailableDetail" />
      </p>
      <Button className={styles.retryButton!} onPress={onRetry}>
        <RefreshCw aria-hidden="true" size={16} />
        <FormattedMessage id="action.retry" />
      </Button>
    </div>
  );
}
