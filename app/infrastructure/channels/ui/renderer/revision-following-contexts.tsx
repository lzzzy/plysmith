import { RefreshCw } from 'lucide-react';
import { FormattedMessage } from 'react-intl';

import styles from './revision-following-contexts.module.css';

interface FollowingContext {
  readonly contextId: string;
  readonly contextName: string;
  readonly contributionCount: number;
}

export function RevisionFollowingContexts({
  contexts,
  metadataOnly,
}: {
  readonly contexts: readonly FollowingContext[];
  readonly metadataOnly: boolean;
}) {
  if (contexts.length === 0) return null;

  return (
    <div className={styles.notice}>
      <RefreshCw aria-hidden="true" size={18} />
      <div>
        <strong>
          <FormattedMessage
            id={
              metadataOnly
                ? 'inventory.contextsRenamed'
                : 'inventory.contextsUpdated'
            }
          />
        </strong>
        <p>
          <FormattedMessage
            id={
              metadataOnly
                ? 'inventory.contextsRenamedDetail'
                : 'inventory.contextsUpdatedDetail'
            }
          />
        </p>
        <ul>
          {contexts.map((context) => (
            <li key={context.contextId}>
              {context.contextName}
              {!metadataOnly && context.contributionCount > 0 && (
                <span className={styles.historicalNote}>
                  <FormattedMessage
                    id="inventory.followingContextNotesHistorical"
                    values={{ count: context.contributionCount }}
                  />
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
