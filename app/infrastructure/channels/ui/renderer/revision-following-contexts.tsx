import { TriangleAlert } from 'lucide-react';
import { FormattedMessage } from 'react-intl';

import styles from './revision-following-contexts.module.css';

interface FollowingContext {
  readonly contextId: string;
  readonly contextName: string;
  readonly contributionCount: number;
  readonly changedScratchCount: number;
}

export function RevisionFollowingContexts({
  contexts,
}: {
  readonly contexts: readonly FollowingContext[];
}) {
  const losses = contexts.filter(
    (context) =>
      context.contributionCount > 0 || context.changedScratchCount > 0,
  );
  if (losses.length === 0) return null;

  return (
    <div className={styles.notice}>
      <TriangleAlert aria-hidden="true" size={18} />
      <div>
        <strong>
          <FormattedMessage id="inventory.automaticContextLosses" />
        </strong>
        <ul>
          {losses.map((context) => (
            <li key={context.contextId}>
              {context.contextName}
              {context.contributionCount > 0 && (
                <span className={styles.lossDetail}>
                  <FormattedMessage
                    id="inventory.followingContextNotesHistorical"
                    values={{ count: context.contributionCount }}
                  />
                </span>
              )}
              {context.changedScratchCount > 0 && (
                <span className={styles.lossDetail}>
                  <FormattedMessage
                    id="inventory.followingContextScratchLoss"
                    values={{ count: context.changedScratchCount }}
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
