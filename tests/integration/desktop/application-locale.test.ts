import assert from 'node:assert/strict';
import path from 'node:path';
import test, { before } from 'node:test';
import { build } from 'esbuild';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let Application: ComponentType<{ store: unknown }>;

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
