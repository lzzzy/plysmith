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
import { Button } from 'react-aria-components';
import { FormattedMessage, IntlProvider, useIntl } from 'react-intl';

import { AnalysisView } from './analysis-view.tsx';
import { ManageView } from './manage-view.tsx';
import { messages } from './messages.ts';
import {
  type ActivityId,
  type PlysmithApplicationState,
  type PlysmithApplicationStore,
} from './plysmith-application-store.ts';
import { SettingsView } from './settings-view.tsx';
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
      <ApplicationFrame state={state} store={store} />
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
          <Button className={styles.disabledActivity!} isDisabled>
            <Activity aria-hidden="true" size={19} />
            <FormattedMessage id="activity.playout" />
          </Button>
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
            disabled={state.busyCommand !== undefined}
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
          <span className={styles.scopeMeta}>
            {state.scope.kind === 'free' ? (
              <FormattedMessage id="scope.sessionResume" />
            ) : (
              <FormattedMessage id="scope.persistentResume" />
            )}
          </span>
          {state.refreshing && (
            <RefreshCw
              className={styles.spinning}
              aria-label={intl.formatMessage({ id: 'state.refreshing' })}
              size={15}
            />
          )}
        </header>

        {state.errorCode !== undefined && (
          <ErrorNotice errorCode={state.errorCode} />
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
        {state.activity === 'settings' && (
          <SettingsView state={state} store={store} />
        )}
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
  readonly activity: Extract<ActivityId, 'manage' | 'analyze'>;
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

function ErrorNotice({ errorCode }: { readonly errorCode: string }) {
  return (
    <div className={styles.errorNotice} role="alert">
      <AlertTriangle aria-hidden="true" size={16} />
      <FormattedMessage id={errorMessageId(errorCode)} />
    </div>
  );
}

function errorMessageId(errorCode: string): string {
  if (errorCode === 'chess.invalid_fen') return 'error.invalidFen';
  if (errorCode === 'chess.illegal_move') return 'error.illegalMove';
  if (errorCode === 'chess.invalid_move_input') return 'error.invalidMove';
  if (errorCode.endsWith('revision_conflict')) return 'error.revision';
  if (errorCode === 'workspace.reference_exists')
    return 'error.referenceExists';
  if (errorCode === 'host.unavailable') return 'error.unavailable';
  return 'error.generic';
}
