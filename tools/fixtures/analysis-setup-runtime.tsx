import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { IntlProvider } from 'react-intl';

import { AnalysisSetupDialog } from '../../app/infrastructure/channels/ui/renderer/analysis-setup-dialog.tsx';
import { PlayoutView } from '../../app/infrastructure/channels/ui/renderer/playout-view.tsx';
import { messages } from '../../app/infrastructure/channels/ui/renderer/messages.ts';
import type {
  PlysmithApplicationState,
  PlysmithApplicationStore,
} from '../../app/infrastructure/channels/ui/renderer/plysmith-application-store.ts';
import { pausedPlayoutDto } from '../../tests/contract/playout-fixtures.ts';
import '../../app/infrastructure/channels/ui/renderer/tokens.css';

type Operation = 'discard' | 'start' | 'complete';
const originalScratch = Object.freeze({
  id: 'fixture-scratch',
  revision: 7,
  moves: ['e2e4', 'e7e5'],
  note: 'Keep this existing analysis',
});
let state = {
  view: 'setup' as 'setup' | 'saved-playout' | 'review-playout',
  locale: 'en-GB' as 'en-GB' | 'de-DE',
  savedName: '',
  result: 'unfinished' as 'white_win' | 'black_win' | 'draw' | 'unfinished',
  generation: 0,
  open: false,
  requestedStart: 'initial' as 'initial' | 'setup',
  applicationBusy: false,
  pendingCompletion: false,
  scratch: originalScratch as typeof originalScratch | undefined,
};
const listeners = new Set<() => void>();
const calls: string[] = [];
const alerts: string[] = [];
const closeRequests: boolean[] = [];
const pending = new Map<Operation, (success: boolean) => void>();

function publish(update: Partial<typeof state>) {
  state = { ...state, ...update };
  listeners.forEach((listener) => listener());
}

function command(operation: Operation): Promise<boolean> {
  if (pending.has(operation)) throw new Error(`Duplicate ${operation}`);
  calls.push(operation);
  publish({ applicationBusy: true });
  return new Promise((resolve) => {
    pending.set(operation, (success) => {
      pending.delete(operation);
      publish({
        applicationBusy: false,
        ...(success
          ? { scratch: operation === 'discard' ? undefined : originalScratch }
          : {}),
      });
      resolve(success);
    });
  });
}

// Only the dialog's store boundary is fake; React hooks, portals and events are real.
const store = {
  canWorkWithInventoryItem: () => true,
  openCompletedPlayout: async () => {
    calls.push('openCompletedPlayout');
  },
  completePlayout: async (
    name: string,
    _add: boolean,
    result: typeof state.result,
  ) => {
    calls.push(`result:${result}`);
    const success = await command('complete');
    if (success)
      publish({
        savedName: name,
        result,
        view: 'saved-playout',
        pendingCompletion: false,
      });
    return success;
  },
  discardAnalysisScratch: () => command('discard'),
  startScratchAtInitialPosition: () => command('start'),
  setActivity: (activity: string) => calls.push(`activity:${activity}`),
  validateAnalysisSetup: () => {
    calls.push('validate');
    throw new Error('Unexpected validation during local setup editing');
  },
  startScratchAtSetup: () => {
    calls.push('startSetup');
    throw new Error('Unexpected domain write during local setup editing');
  },
} as unknown as PlysmithApplicationStore;

function Fixture() {
  const snapshot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
  const savedState = {
    phase: 'ready',
    scope: { kind: 'free' },
    preferences: { uiLocale: snapshot.locale },
    refreshing: false,
    ...(snapshot.applicationBusy ? { busyCommand: 'complete_playout' } : {}),
    ...(snapshot.pendingCompletion
      ? {
          pendingPlayoutCompletion: {
            request: {
              scope: { kind: 'free' },
              draftId: '7',
              expectedDraftRevision: 4,
              completionId: 'frozen-completion',
              displayName: snapshot.savedName,
              languageTag: snapshot.locale,
              manualResult: snapshot.result,
            },
            view: {
              ...pausedPlayoutDto,
              draft: {
                ...pausedPlayoutDto.draft,
                status: { kind: 'stopped', outcome: { kind: 'unfinished' } },
              },
            },
          },
        }
      : {}),
    playout:
      snapshot.view === 'review-playout'
        ? {
            ...pausedPlayoutDto,
            draft: {
              ...pausedPlayoutDto.draft,
              status: { kind: 'stopped', outcome: { kind: 'unfinished' } },
            },
          }
        : null,
    completedPlayout:
      snapshot.view === 'saved-playout'
        ? {
            itemId: '9',
            displayName: snapshot.savedName,
            outcome:
              snapshot.result === 'draw'
                ? { kind: 'draw' }
                : snapshot.result === 'unfinished'
                  ? { kind: 'unfinished' }
                  : {
                      kind: 'win',
                      winner:
                        snapshot.result === 'white_win' ? 'white' : 'black',
                    },
            outcomeSource: 'manual',
          }
        : undefined,
    completedPlayoutView:
      snapshot.view === 'saved-playout'
        ? {
            ...pausedPlayoutDto,
            draft: {
              ...pausedPlayoutDto.draft,
              status: { kind: 'stopped', outcome: { kind: 'unfinished' } },
            },
          }
        : undefined,
  } as unknown as Extract<PlysmithApplicationState, { phase: 'ready' }>;
  return (
    <IntlProvider locale={snapshot.locale} messages={messages[snapshot.locale]}>
      {snapshot.view !== 'setup' ? (
        <PlayoutView
          key={snapshot.generation}
          state={savedState}
          store={store}
        />
      ) : (
        <AnalysisSetupDialog
          key={snapshot.generation}
          isOpen={snapshot.open}
          requestedStart={snapshot.requestedStart}
          hasScratch={snapshot.scratch !== undefined}
          isBusy={snapshot.applicationBusy}
          store={store}
          onOpenChange={(open) => {
            closeRequests.push(open);
            publish({ open });
          }}
        />
      )}
    </IntlProvider>
  );
}

function recordAlert(node: Node) {
  if (!(node instanceof Element)) return;
  const elements = [
    ...(node.matches('[role="alert"]') ? [node] : []),
    ...node.querySelectorAll('[role="alert"]'),
  ];
  for (const element of elements) {
    const text = element.textContent?.trim();
    if (text) alerts.push(text);
  }
}

// Keep even transient alerts that disappear before a Playwright assertion runs.
new MutationObserver((records) => {
  for (const record of records) {
    record.addedNodes.forEach(recordAlert);
    if (record.target instanceof Element) {
      const alert = record.target.closest('[role="alert"]');
      if (alert) recordAlert(alert);
    }
  }
}).observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true,
});

Object.assign(globalThis, {
  analysisSetupRuntime: {
    showSavedPlayout(locale: 'de-DE' | 'en-GB', savedName: string) {
      calls.length = 0;
      document.documentElement.lang = locale;
      publish({
        view: 'saved-playout',
        locale,
        savedName,
        result: 'unfinished',
        open: false,
        generation: state.generation + 1,
      });
    },
    showPlayoutReview(locale: 'de-DE' | 'en-GB') {
      calls.length = 0;
      document.documentElement.lang = locale;
      publish({
        view: 'review-playout',
        locale,
        applicationBusy: false,
        pendingCompletion: false,
        generation: state.generation + 1,
      });
    },
    showPendingCompletion(locale: 'de-DE' | 'en-GB') {
      calls.length = 0;
      document.documentElement.lang = locale;
      publish({
        view: 'review-playout',
        locale,
        applicationBusy: false,
        pendingCompletion: true,
        savedName: 'Frozen completion',
        result: 'draw',
        generation: state.generation + 1,
      });
    },
    open(requestedStart: 'initial' | 'setup', hasScratch: boolean) {
      if (pending.size > 0) throw new Error('Previous command still pending');
      calls.length = 0;
      alerts.length = 0;
      closeRequests.length = 0;
      publish({
        view: 'setup',
        generation: state.generation + 1,
        open: true,
        requestedStart,
        applicationBusy: false,
        scratch: hasScratch ? originalScratch : undefined,
      });
    },
    settle(operation: Operation, success: boolean) {
      const resolve = pending.get(operation);
      if (!resolve) throw new Error(`No pending ${operation}`);
      resolve(success);
    },
    releaseApplicationBusy() {
      publish({ applicationBusy: false });
    },
    snapshot() {
      return {
        ...state,
        calls: [...calls],
        alerts: [...alerts],
        closeRequests: [...closeRequests],
        pending: [...pending.keys()],
      };
    },
  },
});

createRoot(document.getElementById('root')!).render(<Fixture />);
