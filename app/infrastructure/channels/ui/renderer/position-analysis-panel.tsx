import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button, Radio, RadioGroup } from 'react-aria-components';
import { FormattedMessage, useIntl } from 'react-intl';

import type {
  AnalyzePositionRequestDto,
  ListPositionAnalysisProvidersResultDto,
  PositionAnalysisSnapshotDto,
} from '../../host_client/index.ts';
import { localizeSan } from './chess-display.ts';
import type { UiLocale } from './messages.ts';
import type { PlysmithApplicationStore } from './plysmith-application-store.ts';
import styles from './position-analysis-panel.module.css';

type Provider = ListPositionAnalysisProvidersResultDto['providers'][number];
type AnalysisFocus = AnalyzePositionRequestDto['focus'];
type ObjectiveBudget = Extract<
  AnalyzePositionRequestDto['mode'],
  { kind: 'objective' }
>['budget'];
type LaneState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'completed';
      readonly snapshot: PositionAnalysisSnapshotDto;
    }
  | { readonly kind: 'failed'; readonly errorCode: string };

export function PositionAnalysisPanel({
  focus,
  locale,
  providers,
  store,
}: {
  readonly focus: AnalysisFocus;
  readonly locale: UiLocale;
  readonly providers: ListPositionAnalysisProvidersResultDto;
  readonly store: PlysmithApplicationStore;
}) {
  const objectiveProviders = useMemo(
    () =>
      providers.providers.filter(
        (provider) =>
          provider.capability === 'objective_position_analysis' &&
          provider.status === 'available',
      ),
    [providers],
  );
  const humanProviders = useMemo(
    () =>
      providers.providers.filter(
        (provider) =>
          provider.capability === 'human_policy_analysis' &&
          provider.status === 'available',
      ),
    [providers],
  );
  const [objectiveProviderId, setObjectiveProviderId] = useState(
    () => objectiveProviders[0]?.instanceId,
  );
  const [budget, setBudget] = useState<ObjectiveBudget>('fast');
  const [selectedHumanProviderIds, setSelectedHumanProviderIds] = useState(
    () =>
      new Set(
        humanProviders.slice(0, 1).map((provider) => provider.instanceId),
      ),
  );
  const initializedHumanSelection = useRef(humanProviders.length > 0);
  useEffect(() => {
    setObjectiveProviderId((current) =>
      objectiveProviders.some((provider) => provider.instanceId === current)
        ? current
        : objectiveProviders[0]?.instanceId,
    );
  }, [objectiveProviders]);

  useEffect(() => {
    setSelectedHumanProviderIds((current) => {
      const available = new Set(
        humanProviders.map((provider) => provider.instanceId),
      );
      const next = new Set([...current].filter((id) => available.has(id)));
      if (
        !initializedHumanSelection.current &&
        humanProviders[0] !== undefined
      ) {
        next.add(humanProviders[0].instanceId);
        initializedHumanSelection.current = true;
      }
      return sameSet(current, next) ? current : next;
    });
  }, [humanProviders]);

  const objectiveProvider = objectiveProviders.find(
    (provider) => provider.instanceId === objectiveProviderId,
  );

  function toggleHumanProvider(instanceId: string): void {
    setSelectedHumanProviderIds((current) => {
      const next = new Set(current);
      if (next.has(instanceId)) next.delete(instanceId);
      else next.add(instanceId);
      return next;
    });
  }

  return (
    <section
      className={styles.analysisPanel}
      aria-labelledby="engine-analysis-title"
    >
      <header className={styles.analysisHeader}>
        <div>
          <span className={styles.eyebrow}>
            <FormattedMessage id="positionAnalysis.eyebrow" />
          </span>
          <h2 id="engine-analysis-title">
            <FormattedMessage id="positionAnalysis.title" />
          </h2>
        </div>
        <p>
          <FormattedMessage id="positionAnalysis.currentPosition" />
        </p>
      </header>

      <div className={styles.providerGrid}>
        <section
          className={styles.providerArea}
          aria-labelledby="objective-title"
        >
          <div className={styles.providerHeading}>
            <div>
              <span className={styles.providerKind}>
                <FormattedMessage id="positionAnalysis.objective.eyebrow" />
              </span>
              <h3 id="objective-title">
                <FormattedMessage id="positionAnalysis.objective.title" />
              </h3>
            </div>
            {objectiveProviders.length > 1 ? (
              <select
                className={styles.providerSelect}
                aria-label="Stockfish"
                value={objectiveProviderId}
                onChange={(event) => setObjectiveProviderId(event.target.value)}
              >
                {objectiveProviders.map((provider) => (
                  <option key={provider.instanceId} value={provider.instanceId}>
                    {provider.displayName}
                  </option>
                ))}
              </select>
            ) : (
              <span className={styles.providerName}>
                {objectiveProvider?.displayName ?? 'Stockfish'}
              </span>
            )}
          </div>

          <RadioGroup
            className={styles.budgetGroup!}
            value={budget}
            onChange={(value) => setBudget(value as ObjectiveBudget)}
            aria-label="Stockfish"
            orientation="horizontal"
          >
            {(['fast', 'thorough', 'very_deep'] as const).map((value) => (
              <Radio key={value} value={value} className={styles.budgetOption!}>
                <FormattedMessage id={`positionAnalysis.budget.${value}`} />
              </Radio>
            ))}
          </RadioGroup>

          {objectiveProvider === undefined ? (
            <EmptyLane messageId="positionAnalysis.objective.unavailable" />
          ) : (
            <AnalysisLane
              focus={focus}
              laneId="objective"
              locale={locale}
              analysisKind="objective"
              budget={budget}
              provider={objectiveProvider}
              store={store}
            />
          )}
        </section>

        <section className={styles.providerArea} aria-labelledby="human-title">
          <div className={styles.providerHeading}>
            <div>
              <span className={styles.providerKind}>
                <FormattedMessage id="positionAnalysis.human.eyebrow" />
              </span>
              <h3 id="human-title">
                <FormattedMessage id="positionAnalysis.human.title" />
              </h3>
            </div>
          </div>

          {humanProviders.length > 0 && (
            <div className={styles.profileChoices}>
              {humanProviders.map((provider) => (
                <label
                  key={provider.instanceId}
                  className={styles.profileChoice}
                >
                  <input
                    type="checkbox"
                    checked={selectedHumanProviderIds.has(provider.instanceId)}
                    onChange={() => toggleHumanProvider(provider.instanceId)}
                  />
                  <span>{provider.displayName}</span>
                </label>
              ))}
            </div>
          )}

          {humanProviders.length === 0 ? (
            <EmptyLane messageId="positionAnalysis.human.unavailable" />
          ) : selectedHumanProviderIds.size === 0 ? (
            <EmptyLane messageId="positionAnalysis.human.choose" />
          ) : (
            <div className={styles.humanLanes}>
              {humanProviders
                .filter((provider) =>
                  selectedHumanProviderIds.has(provider.instanceId),
                )
                .map((provider) => (
                  <AnalysisLane
                    key={provider.instanceId}
                    focus={focus}
                    laneId={`human-${provider.instanceId}`}
                    locale={locale}
                    analysisKind="human_policy"
                    provider={provider}
                    store={store}
                  />
                ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function AnalysisLane({
  analysisKind,
  budget,
  focus,
  laneId,
  locale,
  provider,
  store,
}: {
  readonly analysisKind: 'objective' | 'human_policy';
  readonly budget?: ObjectiveBudget;
  readonly focus: AnalysisFocus;
  readonly laneId: string;
  readonly locale: UiLocale;
  readonly provider: Provider;
  readonly store: PlysmithApplicationStore;
}) {
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<LaneState>({ kind: 'loading' });

  useEffect(() => {
    let current = true;
    setState({ kind: 'loading' });
    void store
      .analyzePosition({
        laneId,
        providerInstanceId: provider.instanceId,
        candidateCount: 5,
        focus,
        mode:
          analysisKind === 'objective'
            ? { kind: 'objective', budget: budget ?? 'fast' }
            : { kind: 'human_policy' },
      })
      .then((result) => {
        if (!current || result.kind === 'cancelled') return;
        setState(
          result.kind === 'completed'
            ? { kind: 'completed', snapshot: result.snapshot }
            : { kind: 'failed', errorCode: result.errorCode },
        );
      });
    return () => {
      current = false;
    };
  }, [analysisKind, budget, focus, laneId, provider.instanceId, retry, store]);

  if (state.kind === 'loading') {
    return (
      <div className={styles.laneStatus} role="status">
        <RefreshCw aria-hidden="true" size={16} className={styles.spinning} />
        <FormattedMessage id="positionAnalysis.loading" />
      </div>
    );
  }
  if (state.kind === 'failed') {
    return (
      <div className={styles.laneFailure} role="alert">
        <AlertTriangle aria-hidden="true" size={17} />
        <span>
          <FormattedMessage id="positionAnalysis.failed" />
        </span>
        <Button
          className={styles.retryButton!}
          onPress={() => setRetry((value) => value + 1)}
        >
          <RefreshCw aria-hidden="true" size={14} />
          <FormattedMessage id="positionAnalysis.retry" />
        </Button>
      </div>
    );
  }
  return <AnalysisSnapshot locale={locale} snapshot={state.snapshot} />;
}

function AnalysisSnapshot({
  locale,
  snapshot,
}: {
  readonly locale: UiLocale;
  readonly snapshot: PositionAnalysisSnapshotDto;
}) {
  return (
    <div className={styles.snapshot}>
      {snapshot.kind === 'objective' ? (
        <>
          {snapshot.rootWdl !== undefined && (
            <WdlMeter wdl={snapshot.rootWdl} />
          )}
          <ol className={styles.candidates}>
            {snapshot.candidates.map((candidate) => (
              <li
                key={`${candidate.rank}-${candidate.move.from}-${candidate.move.to}`}
              >
                <div className={styles.candidateLine}>
                  <strong>{localizeSan(candidate.move.san, locale)}</strong>
                  <span className={styles.evaluation}>
                    {formatEvaluation(candidate.evaluation)}
                  </span>
                </div>
                {candidate.principalVariation.length > 0 && (
                  <div className={styles.principalVariation}>
                    {candidate.principalVariation
                      .map((move) => localizeSan(move.san, locale))
                      .join(' ')}
                  </div>
                )}
                {candidate.wdl !== undefined && (
                  <WdlMeter compact wdl={candidate.wdl} />
                )}
              </li>
            ))}
          </ol>
          <div className={styles.metrics}>
            <span>
              <FormattedMessage
                id="positionAnalysis.depth"
                values={{ depth: snapshot.search.depth ?? '-' }}
              />
            </span>
            <span>
              <FormattedMessage
                id="positionAnalysis.time"
                values={{ milliseconds: snapshot.search.limiter.value }}
              />
            </span>
          </div>
        </>
      ) : (
        <>
          {snapshot.rootWdl !== undefined && (
            <WdlMeter wdl={snapshot.rootWdl} />
          )}
          <ol className={styles.candidates}>
            {snapshot.candidates.map((candidate) => (
              <li
                key={`${candidate.rank}-${candidate.move.from}-${candidate.move.to}`}
              >
                <div className={styles.candidateLine}>
                  <strong>{localizeSan(candidate.move.san, locale)}</strong>
                  <span className={styles.policy}>
                    {candidate.policyPercent.toLocaleString(locale, {
                      maximumFractionDigits: 1,
                    })}
                    %
                  </span>
                </div>
                <WdlMeter compact wdl={candidate.wdl} />
              </li>
            ))}
          </ol>
        </>
      )}
      {snapshot.historyCompleteness !== 'complete' && (
        <p className={styles.historyNotice}>
          <FormattedMessage id="positionAnalysis.partialHistory" />
        </p>
      )}
    </div>
  );
}

function WdlMeter({
  compact = false,
  wdl,
}: {
  readonly compact?: boolean;
  readonly wdl: NonNullable<
    Extract<PositionAnalysisSnapshotDto, { kind: 'human_policy' }>['rootWdl']
  >;
}) {
  const intl = useIntl();
  const total = Math.max(1, wdl.wins + wdl.draws + wdl.losses);
  const values = [wdl.wins, wdl.draws, wdl.losses].map(
    (value) => (value / total) * 100,
  );
  const label = intl.formatMessage(
    { id: 'positionAnalysis.wdlLabel' },
    {
      side: intl.formatMessage({ id: `side.${wdl.perspective}` }),
      wins: values[0]!.toLocaleString(intl.locale, {
        maximumFractionDigits: 1,
      }),
      draws: values[1]!.toLocaleString(intl.locale, {
        maximumFractionDigits: 1,
      }),
      losses: values[2]!.toLocaleString(intl.locale, {
        maximumFractionDigits: 1,
      }),
    },
  );
  return (
    <div
      className={compact ? styles.compactWdl : styles.wdl}
      aria-label={label}
    >
      <div className={styles.wdlBar} aria-hidden="true">
        <span className={styles.wins} style={{ width: `${values[0]}%` }} />
        <span className={styles.draws} style={{ width: `${values[1]}%` }} />
        <span className={styles.losses} style={{ width: `${values[2]}%` }} />
      </div>
      <div className={styles.wdlValues}>
        <span>{values[0]!.toFixed(0)}%</span>
        <span>{values[1]!.toFixed(0)}%</span>
        <span>{values[2]!.toFixed(0)}%</span>
      </div>
    </div>
  );
}

function EmptyLane({ messageId }: { readonly messageId: string }) {
  return (
    <p className={styles.emptyLane}>
      <FormattedMessage id={messageId} />
    </p>
  );
}

function formatEvaluation(
  evaluation: Extract<
    PositionAnalysisSnapshotDto,
    { kind: 'objective' }
  >['candidates'][number]['evaluation'],
): string {
  if (evaluation.kind === 'unknown') return '-';
  const bound =
    evaluation.bound === 'lower'
      ? '\u2265'
      : evaluation.bound === 'upper'
        ? '\u2264'
        : '';
  if (evaluation.kind === 'mate') return `${bound}#${evaluation.moves}`;
  const pawns = evaluation.value / 100;
  return `${bound}${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

function sameSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}
