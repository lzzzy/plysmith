import assert from 'node:assert/strict';
import test from 'node:test';

import type { EngineProviderConfigurationDto } from '../../../app/infrastructure/channels/host_client/index.ts';
import {
  EngineConfigurationDrafts,
  mapEngineConfigurationIssues,
} from '../../../app/infrastructure/channels/ui/renderer/engine-configuration-drafts.ts';

const stockfish: EngineProviderConfigurationDto = {
  instanceId: 'stockfish',
  providerType: 'stockfish-uci',
  displayName: 'Stockfish',
  executablePath: 'C:/engines/stockfish.exe',
  arguments: [],
  threads: 1,
  hashMb: 64,
  detailLevels: { fast: 500, thorough: 1_500, very_deep: 5_000 },
  playoutBudget: 'thorough',
  startupTimeoutMs: 5_000,
  moveTimeoutMs: 10_000,
  stopTimeoutMs: 1_000,
  maxOutputBytes: 1_048_576,
  configurationRevision: 'revision-1',
  effectiveFingerprint: 'fingerprint-1',
  restartRequired: false,
};
const maia: EngineProviderConfigurationDto = {
  instanceId: 'maia-1500',
  providerType: 'maia-chess',
  displayName: 'Maia 1500',
  executablePath: 'C:/engines/lc0.exe',
  weightsPath: 'C:/engines/maia.pb.gz',
  startupTimeoutMs: 30_000,
  moveTimeoutMs: 30_000,
  stopTimeoutMs: 1_000,
  maxOutputBytes: 1_048_576,
  configurationRevision: 'revision-2',
  effectiveFingerprint: 'fingerprint-2',
  restartRequired: false,
};

function createDrafts(): EngineConfigurationDrafts {
  const drafts = new EngineConfigurationDrafts();
  drafts.synchronize([stockfish, maia]);
  return drafts;
}

function entry(drafts: EngineConfigurationDrafts, key: string) {
  const value = drafts.snapshot.entries.find((draft) => draft.key === key);
  assert.ok(value);
  return value;
}

test('new Stockfish defaults and custom shared levels survive draft save and reload', () => {
  const drafts = createDrafts();
  const key = drafts.create('stockfish-uci');
  drafts.update(key, { executablePath: 'C:/engines/new-stockfish.exe' });
  const initial = drafts.prepareSave(key)?.input;
  assert.ok(initial?.providerType === 'stockfish-uci');
  assert.equal(initial.threads, 2);
  assert.equal(initial.hashMb, 64);
  assert.deepEqual(initial.detailLevels, {
    fast: 500,
    thorough: 1_500,
    very_deep: 5_000,
  });
  assert.equal(initial.playoutBudget, 'thorough');
  assert.equal('moveTimeMs' in initial, false);
  drafts.update(key, {
    fast: '750',
    thorough: '2500',
    very_deep: '600000',
    playoutBudget: 'very_deep',
  });
  const updated = drafts.prepareSave(key)?.input;
  assert.ok(updated?.providerType === 'stockfish-uci');
  const saved = {
    ...updated,
    configurationRevision: 'saved',
    effectiveFingerprint: 'updated',
    restartRequired: true,
  };
  drafts.saved(key, saved);
  const reloaded = new EngineConfigurationDrafts();
  reloaded.synchronize([saved]);
  const form = entry(reloaded, saved.instanceId).form;
  assert.ok(form.providerType === 'stockfish-uci');
  assert.deepEqual(form.detailLevels, {
    fast: '750',
    thorough: '2500',
    very_deep: '600000',
  });
  assert.equal(form.playoutBudget, 'very_deep');
  const existing = entry(drafts, 'stockfish').form;
  assert.ok(existing.providerType === 'stockfish-uci');
  assert.equal(existing.threads, '1');
});

test('configuration drafts survive selection and refresh independently with real dirty comparison', () => {
  const drafts = createDrafts();
  const original = drafts.snapshot;
  drafts.update('stockfish', { displayName: 'My engine' });
  drafts.select('maia-1500');
  drafts.update('maia-1500', { displayName: 'My Maia' });
  drafts.synchronize([stockfish, maia]);
  assert.equal(drafts.snapshot.selectedKey, 'maia-1500');
  assert.deepEqual(
    drafts.snapshot.entries.map((value) => value.dirty),
    [true, true],
  );
  drafts.select('stockfish');
  assert.equal(entry(drafts, 'stockfish').form.displayName, 'My engine');
  drafts.update('stockfish', { displayName: 'Stockfish' });
  assert.equal(entry(drafts, 'stockfish').dirty, false);
  assert.equal(entry(drafts, 'maia-1500').form.displayName, 'My Maia');
  assert.equal(original.entries[0]?.form.displayName, 'Stockfish');
});

test('discard affects only its target and save establishes only that target baseline', () => {
  const drafts = createDrafts();
  drafts.update('stockfish', { threads: '8' });
  drafts.update('maia-1500', { displayName: 'Training' });
  drafts.discard('stockfish');
  assert.equal(entry(drafts, 'stockfish').dirty, false);
  assert.equal(entry(drafts, 'maia-1500').dirty, true);
  drafts.update('stockfish', { threads: '4' });
  const prepared = drafts.prepareSave('stockfish');
  assert.ok(prepared);
  assert.equal(prepared.expectedConfigurationRevision, 'revision-1');
  assert.equal(
    prepared.input.providerType === 'stockfish-uci' && prepared.input.threads,
    4,
  );
  drafts.saved('stockfish', {
    ...stockfish,
    threads: 4,
    configurationRevision: 'revision-3',
  });
  assert.equal(entry(drafts, 'stockfish').dirty, false);
  assert.equal(
    entry(drafts, 'stockfish').expectedConfigurationRevision,
    'revision-3',
  );
  assert.equal(entry(drafts, 'maia-1500').dirty, true);
});

test('new drafts have stable selection identities and collision-free provider ids', () => {
  const drafts = createDrafts();
  const first = drafts.create('stockfish-uci');
  const second = drafts.create('stockfish-uci');
  const third = drafts.create('maia-chess');
  drafts.update(first, {
    displayName: 'Custom engine',
    executablePath: 'C:/custom.exe',
  });
  drafts.select('stockfish');
  drafts.synchronize([stockfish, maia]);
  drafts.select(first);
  assert.equal(drafts.snapshot.selectedKey, first);
  assert.equal(entry(drafts, first).form.displayName, 'Custom engine');
  assert.equal(entry(drafts, first).baseline, null);
  assert.equal(entry(drafts, first).dirty, true);
  const ids = drafts.snapshot.entries.map((value) => value.form.instanceId);
  assert.equal(new Set(ids).size, ids.length);
  drafts.discard(second);
  assert.ok(drafts.snapshot.entries.some((value) => value.key === third));
  assert.equal(drafts.snapshot.selectedKey, first);
  drafts.discard(first);
  assert.equal(drafts.snapshot.selectedKey, 'stockfish');
});

test('invalid raw numeric text is retained and blocks conversion with field-associated issues', () => {
  for (const raw of ['0', '', ' ', '257', '1.5', '1e', 'NaN', 'Infinity']) {
    const drafts = createDrafts();
    drafts.update('stockfish', { threads: raw });
    assert.equal(drafts.prepareSave('stockfish'), undefined);
    const draft = entry(drafts, 'stockfish');
    assert.equal(
      draft.form.providerType === 'stockfish-uci' && draft.form.threads,
      raw,
    );
    assert.deepEqual(draft.issues, [
      {
        field: 'threads',
        messageId: 'engines.validation.integerRange',
        values: { min: 1, max: 256 },
      },
    ]);
    drafts.select('maia-1500');
    drafts.synchronize([stockfish, maia]);
    drafts.select('stockfish');
    assert.equal(entry(drafts, 'stockfish').form, draft.form);
  }
});

test('numeric bounds match the host contract and valid endpoints produce numbers', () => {
  for (const [field, min, max] of [
    ['threads', 1, 256],
    ['hashMb', 1, 65_536],
    ['fast', 10, 600_000],
    ['thorough', 10, 600_000],
    ['very_deep', 10, 600_000],
  ] as const) {
    for (const value of [min - 1, max + 1]) {
      const drafts = createDrafts();
      drafts.update('stockfish', { [field]: String(value) });
      assert.equal(drafts.prepareSave('stockfish'), undefined);
      assert.equal(entry(drafts, 'stockfish').issues[0]?.field, field);
    }
    for (const value of [min, max]) {
      const drafts = createDrafts();
      drafts.update('stockfish', {
        displayName: 'Changed',
        [field]: String(value),
      });
      const input = drafts.prepareSave('stockfish')?.input;
      assert.ok(input?.providerType === 'stockfish-uci');
      assert.equal(
        field === 'threads' || field === 'hashMb'
          ? input[field]
          : input.detailLevels[field],
        value,
      );
    }
  }
});

test('required names and paths and maximum text lengths yield individual field errors', () => {
  const drafts = createDrafts();
  const key = drafts.create('maia-chess');
  drafts.update(key, { displayName: '   ' });
  assert.equal(drafts.prepareSave(key), undefined);
  assert.deepEqual(
    entry(drafts, key).issues.map((issue) => issue.field),
    ['displayName', 'executablePath', 'weightsPath'],
  );
  drafts.update(key, {
    displayName: 'a'.repeat(161),
    executablePath: 'x'.repeat(1025),
    weightsPath: 'w'.repeat(1025),
  });
  assert.equal(drafts.prepareSave(key), undefined);
  assert.ok(
    entry(drafts, key).issues.every(
      (issue) => issue.messageId === 'engines.validation.maxLength',
    ),
  );
  drafts.update(key, {
    displayName: 'a'.repeat(160),
    executablePath: 'x'.repeat(1024),
    weightsPath: 'w'.repeat(1024),
  });
  assert.ok(drafts.prepareSave(key));
  assert.ok(entry(drafts, key).form.instanceId.length <= 80);
});

test('preview and structured server issues preserve raw inputs and clear only edited field issues', () => {
  const drafts = createDrafts();
  drafts.update('maia-1500', { displayName: 'Kept input' });
  const before = entry(drafts, 'maia-1500').form;
  drafts.setIssues(
    'maia-1500',
    mapEngineConfigurationIssues([
      'weights_not_found',
      'executable_not_found',
      'configuration_invalid',
    ]),
  );
  assert.equal(entry(drafts, 'maia-1500').form, before);
  assert.deepEqual(
    entry(drafts, 'maia-1500').issues.map((issue) => issue.field),
    ['weightsPath', 'executablePath', undefined],
  );
  drafts.update('maia-1500', { weightsPath: 'C:/other.pb.gz' });
  assert.deepEqual(
    entry(drafts, 'maia-1500').issues.map((issue) => issue.field),
    ['executablePath'],
  );
  drafts.setIssues('maia-1500', [
    {
      field: 'displayName',
      messageId: 'engines.validation.maxLength',
      values: { max: 160 },
    },
  ]);
  drafts.synchronize([stockfish, maia]);
  assert.equal(entry(drafts, 'maia-1500').form.displayName, 'Kept input');
  assert.equal(entry(drafts, 'maia-1500').issues[0]?.field, 'displayName');
});

test('refresh updates clean baselines but preserves dirty revisions for conflict detection', () => {
  const drafts = createDrafts();
  drafts.update('stockfish', { threads: '0' });
  const current = {
    ...stockfish,
    configurationRevision: 'new-revision',
    threads: 8,
  };
  drafts.synchronize([current, { ...maia, displayName: 'Remote Maia' }]);
  assert.equal(
    entry(drafts, 'stockfish').expectedConfigurationRevision,
    'revision-1',
  );
  assert.equal(entry(drafts, 'maia-1500').form.displayName, 'Remote Maia');
  drafts.discard('stockfish');
  drafts.synchronize([current, maia]);
  assert.equal(
    entry(drafts, 'stockfish').expectedConfigurationRevision,
    'new-revision',
  );
});

test('empty sessions do not invent saved configuration or restart persistence', () => {
  const drafts = new EngineConfigurationDrafts();
  drafts.synchronize([]);
  assert.equal(drafts.snapshot.selectedKey, undefined);
  const key = drafts.create('stockfish-uci');
  drafts.discard(key);
  assert.deepEqual(drafts.snapshot.entries, []);
  assert.equal(drafts.snapshot.selectedKey, undefined);
  const previousSession = createDrafts();
  previousSession.update('stockfish', { displayName: 'Temporary' });
  assert.equal(
    entry(createDrafts(), 'stockfish').form.displayName,
    'Stockfish',
  );
});

test('confirmed removal clears only that provider draft and chooses a remaining entry', () => {
  const drafts = createDrafts();
  drafts.update('stockfish', { displayName: 'Edited Stockfish' });
  drafts.update('maia-1500', { displayName: 'Edited Maia' });
  drafts.removed('stockfish');
  assert.equal(drafts.snapshot.selectedKey, 'maia-1500');
  assert.equal(drafts.snapshot.entries.length, 1);
  assert.equal(entry(drafts, 'maia-1500').form.displayName, 'Edited Maia');
  drafts.removed('maia-1500');
  assert.equal(drafts.snapshot.selectedKey, undefined);
});
