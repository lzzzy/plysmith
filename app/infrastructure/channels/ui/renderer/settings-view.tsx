import { useEffect, useState } from 'react';
import { Activity, CheckCircle2, Languages, RefreshCw } from 'lucide-react';
import { Button, Radio, RadioGroup } from 'react-aria-components';
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
  useEffect(() => {
    setDraftLocale(state.preferences.uiLocale);
  }, [state.preferences.uiLocale]);

  const saving = state.busyCommand === 'set_language';
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
    </main>
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
