import assert from 'node:assert/strict';
import path from 'node:path';
import test, { before } from 'node:test';
import { build } from 'esbuild';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LiveStateDto } from '../../../app/infrastructure/channels/host_client/index.ts';

let Application: ComponentType<{ store: unknown }>;

const blockedLive = {
  revision: 1,
  configured: true,
  online: true,
  connection: 'connected',
  fairPlayBlocked: true,
  games: [],
} satisfies LiveStateDto;
const ownGames: LiveStateDto['games'] = [
  {
    gameId: 'abcdefgh',
    displayName: 'Opponent',
    playerSide: 'white',
    standard: true,
    boardCompatible: true,
  },
];
const ownSession = {
  role: 'play',
  status: 'ongoing',
  connected: true,
} satisfies Pick<
  NonNullable<LiveStateDto['session']>,
  'role' | 'status' | 'connected'
>;

before(async () => {
  const bundle = await build({
    entryPoints: [
      path.resolve(
        'app/infrastructure/channels/ui/renderer/application-shell.tsx',
      ),
    ],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    jsx: 'automatic',
    loader: { '.module.css': 'empty' },
    plugins: [
      {
        name: 'locale-probe',
        setup(builder) {
          builder.onLoad({ filter: /settings-view\.tsx$/ }, () => ({
            contents: `
import { useLocale } from 'react-aria-components';
export function SettingsView() {
  return <output data-control-locale={useLocale().locale} />;
}`,
            loader: 'tsx',
          }));
          builder.onResolve({ filter: /^[^./]/ }, (args) =>
            path.isAbsolute(args.path)
              ? undefined
              : { path: import.meta.resolve(args.path), external: true },
          );
        },
      },
    ],
  });
  const component = await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
  );
  Application = component.PlysmithApplication;
});

for (const locale of ['de-DE', 'en-GB']) {
  test(`a blocked command does not claim an ongoing own game in ${locale}`, () => {
    const markup = renderToStaticMarkup(
      createElement(Application, {
        store: {
          subscribe: () => () => undefined,
          getSnapshot: () => ({
            phase: 'ready',
            activity: 'settings',
            scope: { kind: 'free' },
            preferences: { uiLocale: locale },
            contexts: { contexts: [] },
            fairPlayBlocked: true,
            live: { ...blockedLive, connection: 'reconnecting' },
            errorCode: 'live.fair_play_blocked',
          }),
        },
      }),
    );
    const alert = markup.match(
      /<div\b[^>]*role="alert"[^>]*>(.*?)<\/div>/s,
    )?.[1];
    assert.ok(alert);
    assert.ok(
      alert.includes(
        locale === 'de-DE'
          ? 'Analysehilfe ist durch den Fair-Play-Schutz gesperrt.'
          : 'Analysis assistance is disabled by fair-play protection.',
      ),
    );
    assert.doesNotMatch(alert, /eigenen Onlinepartie|during your online game/);
  });

  for (const [name, live, confirmedOwnGame] of [
    ['initial pending read', undefined, false],
    [
      'pending read after an unblocked snapshot',
      { ...blockedLive, fairPlayBlocked: false },
      false,
    ],
    ['unknown blocked account', blockedLive, false],
    [
      'disconnected account with stale own games',
      { ...blockedLive, connection: 'disconnected', games: ownGames },
      false,
    ],
    [
      'reconnecting account with a stale own session',
      { ...blockedLive, connection: 'reconnecting', session: ownSession },
      false,
    ],
    [
      'failed account verification',
      { ...blockedLive, connection: 'failed', games: ownGames },
      false,
    ],
    [
      'offline persisted guard',
      { ...blockedLive, online: false, connection: 'disconnected' },
      false,
    ],
    ['confirmed own game', { ...blockedLive, games: ownGames }, true],
    [
      'confirmed ongoing own session',
      { ...blockedLive, session: ownSession },
      true,
    ],
    [
      'disconnected own session',
      { ...blockedLive, session: { ...ownSession, connected: false } },
      false,
    ],
    [
      'ended own session',
      { ...blockedLive, session: { ...ownSession, status: 'ended' } },
      false,
    ],
    [
      'finalizing own session',
      { ...blockedLive, session: { ...ownSession, status: 'finalizing' } },
      false,
    ],
    [
      'observed session',
      { ...blockedLive, session: { ...ownSession, role: 'observe' } },
      false,
    ],
    [
      'observed session alongside a confirmed own game',
      {
        ...blockedLive,
        games: ownGames,
        session: { ...ownSession, role: 'observe' },
      },
      true,
    ],
  ] as const) {
    test(`fair-play notice explains ${name} in ${locale} without showing assistance`, () => {
      const ownGameNotice =
        locale === 'de-DE'
          ? 'Analysehilfe ist während einer eigenen Onlinepartie gesperrt.'
          : 'Analysis assistance is disabled during your online game.';
      const unconfirmedNotice =
        locale === 'de-DE'
          ? 'Der Lichess-Spielstatus ist nicht bestätigt. Analysehilfe bleibt gesperrt, bis Lichess wieder verbunden und der Spielstatus bestätigt ist.'
          : 'Lichess game status is unconfirmed. Analysis assistance remains disabled until Lichess is connected and the game status is confirmed.';
      for (const activity of ['analyze', 'playout']) {
        const markup = renderToStaticMarkup(
          createElement(Application, {
            store: {
              subscribe: () => () => undefined,
              getSnapshot: () => ({
                phase: 'ready',
                activity,
                scope: { kind: 'free' },
                preferences: { uiLocale: locale },
                contexts: { contexts: [] },
                fairPlayBlocked: true,
                live,
              }),
            },
          }),
        );
        const notices = [
          ...markup.matchAll(
            /<section\b[^>]*role="status"[^>]*>(.*?)<\/section>/gs,
          ),
        ];
        assert.equal(notices.length, 1);
        assert.equal(
          notices[0]![1],
          confirmedOwnGame ? ownGameNotice : unconfirmedNotice,
        );
        assert.doesNotMatch(
          markup,
          /<main\b/,
          `${activity} assistance stays hidden`,
        );
      }
    });
  }

  test(`framework controls use the application locale ${locale}`, () => {
    const state = {
      phase: 'ready',
      activity: 'settings',
      scope: { kind: 'free' },
      preferences: { uiLocale: locale },
      contexts: { contexts: [] },
    };
    const markup = renderToStaticMarkup(
      createElement(Application, {
        store: {
          subscribe: () => () => undefined,
          getSnapshot: () => state,
        },
      }),
    );
    assert.ok(markup.includes(`data-control-locale="${locale}"`));
  });

  for (const [name, blocked, extra] of [
    ['idle', [false, false, false, false, false, false], {}],
    [
      'command in progress',
      [true, true, true, true, true, true],
      { busyCommand: 'create_analysis_record' },
    ],
    [
      'pending playout completion',
      [true, true, false, false, false, true],
      { pendingPlayoutCompletion: {} },
    ],
    [
      'pending completion during fair play',
      [true, true, true, false, false, true],
      {
        pendingPlayoutCompletion: {},
        fairPlayBlocked: true,
        live: { fairPlayBlocked: true, games: [] },
      },
    ],
    [
      'pending completion with unverified live state',
      [true, true, true, false, false, true],
      {
        pendingPlayoutCompletion: {},
        fairPlayBlocked: true,
        live: { fairPlayBlocked: false, games: [] },
      },
    ],
    [
      'pending completion while a command is in progress',
      [true, true, true, true, true, true],
      {
        pendingPlayoutCompletion: {},
        busyCommand: 'complete_playout',
      },
    ],
  ] as const) {
    test(`activity navigation reflects ${name} in ${locale}`, () => {
      const markup = renderToStaticMarkup(
        createElement(Application, {
          store: {
            subscribe: () => () => undefined,
            getSnapshot: () => ({
              phase: 'ready',
              activity: 'settings',
              useWorkingContexts: true,
              scope: { kind: 'free' },
              preferences: { uiLocale: locale },
              contexts: { contexts: [] },
              fairPlayBlocked: false,
              ...extra,
            }),
          },
        }),
      );
      const activityRail = markup.match(/<aside\b[^>]*>(.*?)<\/aside>/s)?.[1];
      assert.ok(activityRail);
      const buttons = [...activityRail.matchAll(/<button\b([^>]*)>/g)];
      assert.equal(buttons.length, 5);
      const scope = markup.match(/<select\b([^>]*\bid="work-scope"[^>]*)>/);
      assert.ok(scope);
      assert.deepEqual(
        [...buttons.map(([, attributes]) => attributes!), scope[1]!].map(
          (attributes) => /\bdisabled(?:=|\s|$)/.test(attributes),
        ),
        blocked,
        'manage, analyze, playout, live, settings and scope',
      );
    });
  }
}
