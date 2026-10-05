import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { FormattedMessage, useIntl } from 'react-intl';

import type {
  AnalyzePositionRequestDto,
  ListPositionAnalysisProvidersResultDto,
} from '../../host_client/index.ts';
import { localizeSan } from './chess-display.ts';
import type { UiLocale } from './messages.ts';
import {
  analysisMoveKey,
  groupAnalysisMoves,
  whiteEvaluation,
  whiteWdl,
  type HumanSnapshot,
  type ObjectiveCandidate,
  type ObjectiveEvaluation,
  type ObjectiveSnapshot,
} from './position-analysis-groups.ts';
import type { PlysmithApplicationStore } from './plysmith-application-store.ts';
import styles from './position-analysis-panel.module.css';

type AnalysisFocus = AnalyzePositionRequestDto['focus'];
type ObjectiveBudget = Extract<
  AnalyzePositionRequestDto['mode'],
  { kind: 'objective' }
>['budget'];
type LaneState<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'completed'; readonly snapshot: T }
  | { readonly kind: 'failed' };

export function PositionAnalysisPanel({
  focus,
  work,
  locale,
  providers,
  store,
  stretch = false,
}: {
  readonly focus: AnalysisFocus;
  readonly work: AnalyzePositionRequestDto['work'];
  readonly locale: UiLocale;
  readonly providers: ListPositionAnalysisProvidersResultDto;
  readonly store: PlysmithApplicationStore;
  readonly stretch?: boolean;
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
    () =>
      objectiveProviders.find(
        (provider) =>
          provider.instanceId === store.getPositionAnalysisObjectiveProvider(),
      )?.instanceId ?? objectiveProviders[0]?.instanceId,
  );
  const [budget, setBudget] = useState<ObjectiveBudget>(() =>
    store.getPositionAnalysisBudget(),
  );
  const [selectedHumanProviderIds, setSelectedHumanProviderIds] = useState(
    () =>
      new Set(
        store.getPositionAnalysisHumanSelection() ??
          humanProviders.slice(0, 1).map((provider) => provider.instanceId),
      ),
  );
  const [sortBy, setSortBy] = useState(() => store.getPositionAnalysisSort());
  const [retry, setRetry] = useState(0);
  const initializedHumanSelection = useRef(
    store.getPositionAnalysisHumanSelection() !== undefined ||
      humanProviders.length > 0,
  );
  const requestRef = useRef({ focus, work });

  useEffect(() => {
    requestRef.current = { focus, work };
  }, [focus, work]);

  useEffect(() => {
    setObjectiveProviderId((current) =>
      objectiveProviders.some((provider) => provider.instanceId === current)
        ? current
        : objectiveProviders[0]?.instanceId,
    );
  }, [objectiveProviders]);
  useEffect(() => {
    if (initializedHumanSelection.current || humanProviders[0] === undefined)
      return;
    initializedHumanSelection.current = true;
    setSelectedHumanProviderIds(new Set([humanProviders[0].instanceId]));
  }, [humanProviders]);

  const objectiveProvider = objectiveProviders.find(
    (provider) => provider.instanceId === objectiveProviderId,
  );
  const effectiveObjectiveProviderId = objectiveProvider?.instanceId;
  const selectedHumanProviders = humanProviders.filter((provider) =>
    selectedHumanProviderIds.has(provider.instanceId),
  );
  const selectedHumanKey = selectedHumanProviders
    .map((provider) => provider.instanceId)
    .sort()
    .join('|');
  const selectedHumanIds = useMemo(
    () => (selectedHumanKey === '' ? [] : selectedHumanKey.split('|')),
    [selectedHumanKey],
  );
  const effectiveSortBy =
    sortBy === 'stockfish' ||
    selectedHumanProviders.some((provider) => provider.instanceId === sortBy)
      ? sortBy
      : 'stockfish';
  const workKey = JSON.stringify(work);
  const objectiveKey = `${workKey}|${focus.focusKey}|${objectiveProvider?.instanceId ?? '-'}|${budget}|${retry}`;
  const humanKey = `${workKey}|${focus.focusKey}|${selectedHumanKey}|${retry}`;
  const extraKey = `${objectiveKey}|${humanKey}`;
  const [objectiveState, setObjectiveState] = useState<{
    readonly key: string;
    readonly value: LaneState<ObjectiveSnapshot>;
  }>({ key: '', value: { kind: 'loading' } });
  const [humanState, setHumanState] = useState<{
    readonly key: string;
    readonly byProvider: ReadonlyMap<string, LaneState<HumanSnapshot>>;
  }>({ key: '', byProvider: new Map() });
  const [extraState, setExtraState] = useState<{
    readonly key: string;
    readonly candidates: readonly ObjectiveCandidate[];
    readonly failed: ReadonlySet<string>;
  }>({ key: '', candidates: [], failed: new Set() });

  useEffect(() => {
    if (effectiveObjectiveProviderId === undefined) return;
    let current = true;
    setObjectiveState({ key: objectiveKey, value: { kind: 'loading' } });
    void store
      .analyzePosition({
        laneId: 'objective',
        providerInstanceId: effectiveObjectiveProviderId,
        candidateCount: 5,
        ...requestRef.current,
        mode: { kind: 'objective', budget },
      })
      .then((result) => {
        if (!current) return;
        setObjectiveState({
          key: objectiveKey,
          value:
            result.kind === 'completed' && result.snapshot.kind === 'objective'
              ? { kind: 'completed', snapshot: result.snapshot }
              : { kind: 'failed' },
        });
      });
    return () => {
      current = false;
    };
  }, [budget, objectiveKey, effectiveObjectiveProviderId, store]);

  useEffect(() => {
    let current = true;
    setHumanState({
      key: humanKey,
      byProvider: new Map(
        selectedHumanIds.map((providerId) => [
          providerId,
          { kind: 'loading' as const },
        ]),
      ),
    });
    for (const providerId of selectedHumanIds) {
      void store
        .analyzePosition({
          laneId: `human-${providerId}`,
          providerInstanceId: providerId,
          candidateCount: 5,
          ...requestRef.current,
          mode: { kind: 'human_policy' },
        })
        .then((result) => {
          if (!current) return;
          setHumanState((previous) => {
            if (previous.key !== humanKey) return previous;
            const next = new Map(previous.byProvider);
            next.set(
              providerId,
              result.kind === 'completed' &&
                result.snapshot.kind === 'human_policy'
                ? { kind: 'completed', snapshot: result.snapshot }
                : { kind: 'failed' },
            );
            return { key: humanKey, byProvider: next };
          });
        });
    }
    return () => {
      current = false;
    };
  }, [humanKey, selectedHumanIds, store]);

  const objectiveValue =
    objectiveState.key === objectiveKey
      ? objectiveState.value
      : { kind: 'loading' as const };
  const objectiveSnapshot =
    objectiveValue.kind === 'completed' ? objectiveValue.snapshot : undefined;
  const currentHumanState =
    humanState.key === humanKey ? humanState.byProvider : new Map();
  const humanReady = selectedHumanProviders.every(
    (provider) =>
      currentHumanState.get(provider.instanceId)?.kind === 'completed' ||
      currentHumanState.get(provider.instanceId)?.kind === 'failed',
  );
  const humanSnapshots = useMemo(() => {
    const snapshots = new Map<string, HumanSnapshot>();
    if (humanState.key !== humanKey) return snapshots;
    for (const [providerId, state] of humanState.byProvider) {
      if (state.kind === 'completed') snapshots.set(providerId, state.snapshot);
    }
    return snapshots;
  }, [humanKey, humanState]);

  useEffect(() => {
    if (
      effectiveObjectiveProviderId === undefined ||
      objectiveSnapshot === undefined ||
      !humanReady
    )
      return;
    let current = true;
    const missing = groupAnalysisMoves(
      objectiveSnapshot,
      [],
      humanSnapshots,
      'stockfish',
    )
      .filter((group) => group.objective === undefined)
      .map((group) => group.move);
    setExtraState({
      key: extraKey,
      candidates: [],
      failed: new Set(),
    });
    void (async () => {
      for (let index = 0; index < missing.length; index += 8) {
        if (!current) return;
        const batch = missing.slice(index, index + 8);
        const result = await store.analyzePosition({
          laneId: 'objective',
          providerInstanceId: effectiveObjectiveProviderId,
          candidateCount: batch.length,
          ...requestRef.current,
          mode: { kind: 'objective', budget, rootMoves: batch },
        });
        if (!current) return;
        setExtraState((previous) => {
          if (previous.key !== extraKey) return previous;
          const candidates =
            result.kind === 'completed' && result.snapshot.kind === 'objective'
              ? result.snapshot.candidates
              : [];
          const delivered = new Set(
            candidates.map((candidate) => analysisMoveKey(candidate.move)),
          );
          const failed = new Set(previous.failed);
          for (const move of batch) {
            const key = analysisMoveKey(move);
            if (!delivered.has(key)) failed.add(key);
          }
          return {
            key: extraKey,
            candidates: [...previous.candidates, ...candidates],
            failed,
          };
        });
      }
    })();
    return () => {
      current = false;
    };
  }, [
    budget,
    extraKey,
    humanReady,
    humanSnapshots,
    effectiveObjectiveProviderId,
    objectiveSnapshot,
    store,
  ]);

  const additional = extraState.key === extraKey ? extraState.candidates : [];
  const failedMoves =
    extraState.key === extraKey ? extraState.failed : new Set<string>();
  const groups = groupAnalysisMoves(
    objectiveSnapshot,
    additional,
    humanSnapshots,
    effectiveSortBy,
  );
  const intl = useIntl();

  function toggleHumanProvider(instanceId: string): void {
    const next = new Set(selectedHumanProviderIds);
    if (next.has(instanceId)) next.delete(instanceId);
    else next.add(instanceId);
    store.setPositionAnalysisHumanSelection(next);
    setSelectedHumanProviderIds(next);
    if (sortBy === instanceId) {
      store.setPositionAnalysisSort('stockfish');
      setSortBy('stockfish');
    }
  }

  function selectBudget(next: ObjectiveBudget): void {
    store.setPositionAnalysisBudget(next);
    setBudget(next);
  }

  return (
    <section
      className={`${styles.analysisPanel!} ${stretch ? styles.stretched : ''}`}
      aria-labelledby="engine-analysis-title"
    >
      <header className={styles.analysisHeader}>
        <h2 id="engine-analysis-title">
          <FormattedMessage id="positionAnalysis.title" />
        </h2>
        <button
          type="button"
          className={styles.retryButton}
          title={intl.formatMessage({ id: 'positionAnalysis.retry' })}
          aria-label={intl.formatMessage({ id: 'positionAnalysis.retry' })}
          onClick={() => setRetry((value) => value + 1)}
        >
          <RefreshCw aria-hidden="true" size={15} />
        </button>
      </header>
      <div className={styles.controls}>
        {objectiveProviders.length > 1 && (
          <select
            className={styles.providerSelect}
            aria-label="Stockfish"
            value={objectiveProviderId}
            onChange={(event) => {
              store.setPositionAnalysisObjectiveProvider(event.target.value);
              setObjectiveProviderId(event.target.value);
            }}
          >
            {objectiveProviders.map((provider) => (
              <option key={provider.instanceId} value={provider.instanceId}>
                {provider.displayName}
              </option>
            ))}
          </select>
        )}
        <select
          className={styles.providerSelect}
          aria-label={intl.formatMessage({ id: 'positionAnalysis.budget' })}
          value={budget}
          onChange={(event) =>
            selectBudget(event.target.value as ObjectiveBudget)
          }
        >
          {(['fast', 'thorough', 'very_deep'] as const).map((value) => (
            <option key={value} value={value}>
              {intl.formatMessage({ id: `positionAnalysis.budget.${value}` })}
            </option>
          ))}
        </select>
        {selectedHumanProviders.length > 0 && (
          <select
            className={styles.providerSelect}
            aria-label={intl.formatMessage({ id: 'positionAnalysis.sort' })}
            value={effectiveSortBy}
            onChange={(event) => {
              store.setPositionAnalysisSort(event.target.value);
              setSortBy(event.target.value);
            }}
          >
            <option value="stockfish">Stockfish</option>
            {selectedHumanProviders.map((provider) => (
              <option key={provider.instanceId} value={provider.instanceId}>
                {provider.displayName}
              </option>
            ))}
          </select>
        )}
      </div>
      {humanProviders.length > 0 && (
        <div className={styles.profileChoices}>
          {humanProviders.map((provider) => (
            <label key={provider.instanceId} className={styles.profileChoice}>
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
      {objectiveProvider === undefined ? (
        <p className={styles.status}>
          <FormattedMessage id="positionAnalysis.objective.unavailable" />
        </p>
      ) : objectiveValue.kind === 'failed' ? (
        <p className={styles.status} role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          <FormattedMessage id="positionAnalysis.failed" />
        </p>
      ) : objectiveValue.kind === 'loading' ? (
        <p className={styles.status} role="status">
          <RefreshCw aria-hidden="true" size={15} className={styles.spinning} />
          <FormattedMessage id="positionAnalysis.loading" />
        </p>
      ) : null}
      {objectiveSnapshot?.rootWdl !== undefined && (
        <div className={styles.positionWdl}>
          <WdlMeter wdl={objectiveSnapshot.rootWdl} />
        </div>
      )}
      {selectedHumanProviders.some(
        (provider) =>
          currentHumanState.get(provider.instanceId)?.kind === 'failed',
      ) && (
        <p className={styles.status} role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          <FormattedMessage id="positionAnalysis.failed" />
        </p>
      )}
      <ol
        className={styles.groups}
        aria-label={intl.formatMessage({ id: 'positionAnalysis.moves' })}
        tabIndex={0}
      >
        {groups.map((group) => (
          <li key={group.key} className={styles.group}>
            <div className={styles.moveHeading}>
              <strong>{localizeSan(group.move.san, locale)}</strong>
              {group.objective !== undefined ? (
                <span className={styles.evaluation}>
                  {formatEvaluation(
                    whiteEvaluation(
                      group.objective.evaluation,
                      objectiveSnapshot?.perspective ??
                        focus.current.position.sideToMove,
                    ),
                  )}
                </span>
              ) : objectiveProvider === undefined ||
                objectiveValue.kind === 'failed' ||
                failedMoves.has(group.key) ? (
                <AlertTriangle
                  className={styles.pendingIcon}
                  aria-label={intl.formatMessage({
                    id: 'positionAnalysis.failed',
                  })}
                  size={15}
                />
              ) : (
                <RefreshCw
                  className={`${styles.pendingIcon} ${styles.spinning}`}
                  aria-label={intl.formatMessage({
                    id: 'positionAnalysis.loading',
                  })}
                  size={15}
                />
              )}
            </div>
            {group.objective !== undefined &&
              group.objective.principalVariation.length > 1 && (
                <div
                  className={styles.principalVariation}
                  title={group.objective.principalVariation
                    .slice(1)
                    .map((move) => localizeSan(move.san, locale))
                    .join(' ')}
                >
                  {group.objective.principalVariation
                    .slice(1)
                    .map((move) => localizeSan(move.san, locale))
                    .join(' ')}
                </div>
              )}
            {group.objective?.wdl !== undefined && (
              <WdlMeter wdl={group.objective.wdl} compact />
            )}
            {selectedHumanProviders.map((provider) => {
              const candidate = group.human.get(provider.instanceId);
              return candidate === undefined ? null : (
                <div key={provider.instanceId} className={styles.policyRow}>
                  {selectedHumanProviders.length > 1 && (
                    <span
                      className={styles.profileName}
                      title={provider.displayName}
                    >
                      {provider.displayName}
                    </span>
                  )}
                  <PolicyMeter
                    profile={provider.displayName}
                    percent={candidate.policyPercent}
                  />
                </div>
              );
            })}
          </li>
        ))}
      </ol>
      {objectiveSnapshot !== undefined && groups.length === 0 && (
        <p className={styles.status}>
          <FormattedMessage id="positionAnalysis.noMoves" />
        </p>
      )}
      {(objectiveSnapshot?.historyCompleteness === 'partial' ||
        objectiveSnapshot?.historyCompleteness === 'unknown' ||
        [...humanSnapshots.values()].some(
          (snapshot) => snapshot.historyCompleteness !== 'complete',
        )) && (
        <p className={styles.historyNotice}>
          <FormattedMessage id="positionAnalysis.partialHistory" />
        </p>
      )}
    </section>
  );
}

function WdlMeter({
  compact = false,
  wdl,
}: {
  readonly compact?: boolean;
  readonly wdl: NonNullable<ObjectiveSnapshot['rootWdl']>;
}) {
  const intl = useIntl();
  const white = whiteWdl(wdl);
  const total = Math.max(1, white.wins + white.draws + white.losses);
  const values = [white.wins, white.draws, white.losses].map(
    (value) => (value / total) * 100,
  );
  const label = intl.formatMessage(
    { id: 'positionAnalysis.whiteWdlLabel' },
    {
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
      role="img"
      aria-label={label}
      title={label}
    >
      <span className={styles.wins} style={{ width: `${values[0]}%` }} />
      <span className={styles.draws} style={{ width: `${values[1]}%` }} />
      <span className={styles.losses} style={{ width: `${values[2]}%` }} />
    </div>
  );
}

function PolicyMeter({
  profile,
  percent,
}: {
  readonly profile: string;
  readonly percent: number;
}) {
  const intl = useIntl();
  const label = intl.formatMessage(
    { id: 'positionAnalysis.policyLabel' },
    {
      profile,
      percent: percent.toLocaleString(intl.locale, {
        maximumFractionDigits: 1,
      }),
    },
  );
  return (
    <div
      className={styles.policyTrack}
      role="img"
      aria-label={label}
      title={label}
    >
      <span className={styles.policyFill} style={{ width: `${percent}%` }} />
    </div>
  );
}

function formatEvaluation(evaluation: ObjectiveEvaluation): string {
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
