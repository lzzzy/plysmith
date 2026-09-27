import { FormattedMessage, useIntl } from 'react-intl';
import type { AnalysisRecordDto } from '../../host_client/index.ts';
import { sideName } from './chess-display.ts';

export function GameOutcomeLabel({
  outcome,
}: {
  readonly outcome: NonNullable<AnalysisRecordDto['game']>['outcome'];
}) {
  const intl = useIntl();
  const locale = intl.locale.startsWith('de') ? 'de-DE' : 'en-GB';
  if (outcome.kind === 'win') {
    return (
      <FormattedMessage
        id="playout.result.win"
        values={{ side: sideName(outcome.winner, locale) }}
      />
    );
  }
  return (
    <FormattedMessage
      id={
        outcome.kind === 'draw'
          ? 'reason' in outcome
            ? `playout.result.draw.${outcome.reason}`
            : 'playout.result.draw'
          : 'playout.result.unfinished'
      }
    />
  );
}
