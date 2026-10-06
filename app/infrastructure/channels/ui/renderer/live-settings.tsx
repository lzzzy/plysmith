import { useEffect, useRef, useState } from 'react';
import { Radio, Save } from 'lucide-react';
import { Button } from 'react-aria-components';
import { FormattedMessage } from 'react-intl';
import type {
  PlysmithApplicationState,
  PlysmithApplicationStore,
} from './plysmith-application-store.ts';
import styles from './settings-view.module.css';

export function LiveSettings({
  state,
  store,
}: {
  readonly state: Extract<PlysmithApplicationState, { phase: 'ready' }>;
  readonly store: PlysmithApplicationStore;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [hasValue, setHasValue] = useState(false);
  const configuration = state.liveProviderConfiguration;
  useEffect(() => {
    const element = input.current;
    return () => {
      if (element) element.value = '';
    };
  }, []);
  return (
    <section
      className={styles.settingsSection}
      aria-labelledby="lichess-settings-title"
    >
      <div className={styles.sectionHeading}>
        <span className={styles.sectionIcon}>
          <Radio size={19} aria-hidden="true" />
        </span>
        <h2 id="lichess-settings-title">
          <FormattedMessage id="live.settings" />
        </h2>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const token = input.current?.value ?? '';
          if (input.current) input.current.value = '';
          setHasValue(false);
          if (token) void store.saveLiveProviderConfiguration(token);
        }}
      >
        <div className={styles.liveTokenForm}>
          <label>
            <span>
              <FormattedMessage id="live.token" />
            </span>
            <input
              ref={input}
              type="password"
              name="lichess-token"
              autoComplete="off"
              spellCheck={false}
              maxLength={512}
              required
              disabled={state.busyCommand !== undefined}
              onChange={(event) =>
                setHasValue(event.currentTarget.value.length > 0)
              }
            />
          </label>
          <Button
            type="submit"
            className={styles.primaryButton!}
            isDisabled={
              !hasValue ||
              configuration === undefined ||
              state.busyCommand !== undefined
            }
          >
            <Save size={16} aria-hidden="true" />
            <FormattedMessage id="live.saveToken" />
          </Button>
        </div>
      </form>
      <p role="status">
        <FormattedMessage
          id={
            configuration?.tokenConfigured
              ? 'live.tokenConfigured'
              : 'live.tokenMissing'
          }
        />
      </p>
      {configuration?.restartRequired && (
        <p role="status">
          <FormattedMessage id="live.restartRequired" />
        </p>
      )}
    </section>
  );
}
