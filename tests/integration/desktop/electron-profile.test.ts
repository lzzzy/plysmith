import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { configureElectronProfile } from '../../../app/infrastructure/channels/ui/desktop/electron-profile.ts';

test('Electron profile and session stay within each application home', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'plysmith-profile-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  for (const name of ['development', 'installed']) {
    const home = path.join(root, name);
    const selected: Record<string, string> = {};
    await configureElectronProfile(
      { setPath: (key, value) => (selected[key] = value) },
      home,
    );
    assert.deepEqual(selected, {
      userData: path.join(home, 'desktop', 'profile'),
      sessionData: path.join(home, 'desktop', 'profile', 'session'),
    });
    await stat(selected.sessionData!);
  }
});

test('an unavailable profile blocks startup before using default Electron paths', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'plysmith-profile-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'desktop'), 'not a directory');
  const selected: Record<string, string> = {};

  await assert.rejects(
    configureElectronProfile(
      { setPath: (key, value) => (selected[key] = value) },
      root,
    ),
  );
  assert.deepEqual(selected, {});
});
