import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  parseDesktopPaths,
  selectDesktopArguments,
} from '../../../app/bootstrap/desktop/desktop-paths.ts';

test('desktop selects its options after Electron and Playwright arguments', () => {
  const desktopArguments = [
    '--application-home',
    'application data',
    '--install-root',
    'install root',
  ];
  assert.deepEqual(
    selectDesktopArguments([
      'electron.exe',
      '--inspect=0',
      '--remote-debugging-port=0',
      'build/desktop/main.mjs',
      ...desktopArguments,
    ]),
    desktopArguments,
  );
  assert.deepEqual(parseDesktopPaths(desktopArguments), {
    applicationHome: path.resolve('application data'),
    installRoot: path.resolve('install root'),
  });
});

test('desktop path parser keeps defaults and rejects malformed own options', () => {
  assert.deepEqual(
    parseDesktopPaths(selectDesktopArguments(['electron.exe'])),
    {
      applicationHome: path.resolve('.'),
      installRoot: path.resolve('.'),
    },
  );
  for (const arguments_ of [
    ['--application-home'],
    ['--install-root', '--application-home'],
    ['--application-home', 'one', '--unknown', 'two'],
  ]) {
    assert.throws(() => parseDesktopPaths(arguments_));
  }
});
