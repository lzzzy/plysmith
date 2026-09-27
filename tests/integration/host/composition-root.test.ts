import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { composeHost } from '../../../app/bootstrap/host/composition-root.ts';
import {
  formatHostStartupFailure,
  parseHostPaths,
} from '../../../app/bootstrap/host/main.ts';
import { initializeConfiguration } from '../../../app/infrastructure/adapters/configuration/filesystem/index.ts';

const defaultsDirectory = path.resolve('configuration', 'defaults');
const hostToken = 'composition-root-test-token';

test('composition root wires the real store and use cases without listening', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const initialized = await initializeConfiguration({
    applicationHome,
    defaultsDirectory,
  });
  const centralPath = path.join(initialized.activeDirectory, 'plysmith.json');
  const maiaWeightsPath = path.join(applicationHome, 'maia-1500.pb.gz');
  await writeFile(maiaWeightsPath, 'fake Maia weights', 'utf8');
  const central = JSON.parse(await readFile(centralPath, 'utf8'));
  central.bindings.playoutEngines = ['uci-test', 'maia-test'];
  await writeFile(centralPath, `${JSON.stringify(central)}\n`, 'utf8');
  await writeFile(
    path.join(initialized.activeDirectory, 'uci-test.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      provider: 'stockfish-uci',
      displayName: 'UCI-Testanbieter',
      stockfish: {
        executablePath: process.execPath,
        arguments: [
          path.resolve('tests', 'fixtures', 'uci', 'fake-uci-engine.mjs'),
        ],
        threads: 1,
        hashMb: 16,
        moveTimeMs: 10,
        startupTimeoutMs: 2_000,
        moveTimeoutMs: 2_000,
        stopTimeoutMs: 1_000,
        maxOutputBytes: 32_768,
      },
    })}\n`,
    'utf8',
  );
  await writeFile(
    path.join(initialized.activeDirectory, 'maia-test.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      provider: 'maia-chess',
      displayName: 'Maia 1500',
      maia: {
        executablePath: process.execPath,
        weightsPath: maiaWeightsPath,
        startupTimeoutMs: 2_000,
        moveTimeoutMs: 2_000,
        stopTimeoutMs: 1_000,
        maxOutputBytes: 32_768,
      },
    })}\n`,
    'utf8',
  );
  const runtime = await composeHost({
    applicationHome,
    defaultsDirectory,
    hostToken,
    now: () => '2026-09-08T11:00:00.000Z',
    correlationIdFactory: () => 'composition-correlation',
  });
  try {
    runtime.markReady();

    const headers = {
      host: '127.0.0.1',
      authorization: `Bearer ${hostToken}`,
    };
    const before = await runtime.host.inject({
      method: 'GET',
      url: '/preferences',
      headers,
    });
    assert.deepEqual(before.json(), {
      uiLocale: 'de-DE',
      preferenceRevision: 1,
      dataRevision: 0,
      updatedAt: '2026-09-08T11:00:00.000Z',
    });

    const changed = await runtime.host.inject({
      method: 'PUT',
      url: '/preferences/ui-language',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: { uiLocale: 'en-GB', expectedRevision: 1 },
    });
    assert.equal(changed.statusCode, 200);
    assert.equal(changed.json().preferences.uiLocale, 'en-GB');

    const status = await runtime.host.inject({
      method: 'GET',
      url: '/status',
      headers,
    });
    assert.deepEqual(status.json().persistence, {
      schemaVersion: 7,
      dataRevision: 1,
    });
    assert.equal(status.json().state, 'ready');
    assert.equal(
      status.json().contractFingerprint,
      runtime.contractFingerprint,
    );

    const providers = await runtime.host.inject({
      url: '/playout/providers',
      headers,
    });
    assert.equal(providers.statusCode, 200);
    assert.deepEqual(providers.json().providers, [
      {
        instanceId: 'uci-test',
        providerType: 'stockfish-uci',
        displayName: 'UCI-Testanbieter',
        fingerprint: providers.json().providers[0].fingerprint,
        capabilities: ['best_move'],
        readiness: 'cold',
        status: 'available',
      },
      {
        instanceId: 'maia-test',
        providerType: 'maia-chess',
        displayName: 'Maia 1500',
        fingerprint: providers.json().providers[1].fingerprint,
        capabilities: ['human_profile'],
        profile: {
          modelName: 'maia-1500.pb.gz',
          selectionMode: 'most_likely',
          historyMode: 'known_position_history',
          reproducibility: 'deterministic',
        },
        readiness: 'cold',
        status: 'available',
      },
    ]);

    const startedPlayout = await runtime.host.inject({
      method: 'POST',
      url: '/playout',
      headers,
      payload: {
        scope: { kind: 'free' },
        start: { kind: 'initial_position' },
        providerInstanceId: 'uci-test',
        capability: 'best_move',
        opening: {
          kind: 'user_move',
          move: { kind: 'notation', value: 'e4', locale: 'de-DE' },
        },
      },
    });
    assert.equal(startedPlayout.statusCode, 200);
    assert.equal(startedPlayout.json().draft.status.kind, 'active');
    assert.deepEqual(
      startedPlayout
        .json()
        .draft.steps.map((step: { move: { san: string } }) => step.move.san),
      ['e4', 'e5'],
    );

    const stoppedPlayout = await runtime.host.inject({
      method: 'POST',
      url: '/playout/stop',
      headers,
      payload: {
        scope: { kind: 'free' },
        draftId: startedPlayout.json().draft.draftId,
        expectedDraftRevision: startedPlayout.json().draft.draftRevision,
      },
    });
    assert.equal(stoppedPlayout.statusCode, 200);
    assert.equal(stoppedPlayout.json().draft.status.kind, 'stopped');

    const completedPlayout = await runtime.host.inject({
      method: 'POST',
      url: '/playout/complete',
      headers,
      payload: {
        scope: { kind: 'free' },
        draftId: stoppedPlayout.json().draft.draftId,
        expectedDraftRevision: stoppedPlayout.json().draft.draftRevision,
        completionId: 'composition-playout-completion',
        manualResult: 'draw',
        displayName: 'Ausgespielte Testpartie',
        languageTag: 'de-DE',
      },
    });
    assert.equal(completedPlayout.statusCode, 200);
    assert.deepEqual(completedPlayout.json().outcome, { kind: 'draw' });
    assert.equal(completedPlayout.json().outcomeSource, 'manual');
    const completedGame = await runtime.host.inject({
      url: `/inventory/items/${completedPlayout.json().itemId}/revisions/${completedPlayout.json().revisionId}?scopeKind=free`,
      headers,
    });
    assert.equal(completedGame.statusCode, 200);
    assert.deepEqual(completedGame.json().game.outcome, { kind: 'draw' });
    assert.equal(completedGame.json().game.outcomeSource, 'manual');

    const diagnosticSettings = await runtime.host.inject({
      url: '/diagnostics/settings',
      headers,
    });
    assert.equal(diagnosticSettings.statusCode, 200);
    assert.deepEqual(
      {
        configuredLevel: diagnosticSettings.json().configuredLevel,
        activeLevel: diagnosticSettings.json().activeLevel,
        restartRequired: diagnosticSettings.json().restartRequired,
      },
      {
        configuredLevel: 'off',
        activeLevel: 'off',
        restartRequired: false,
      },
    );
    const changedDiagnosticSettings = await runtime.host.inject({
      method: 'PUT',
      url: '/diagnostics/settings/log-level',
      headers,
      payload: {
        level: 'debug',
        expectedConfigurationRevision:
          diagnosticSettings.json().configurationRevision,
      },
    });
    assert.equal(changedDiagnosticSettings.statusCode, 200);
    assert.equal(
      changedDiagnosticSettings.json().settings.restartRequired,
      true,
    );

    const initialWorkspace = await runtime.host.inject({
      url: '/analysis/workspace?scopeKind=free',
      headers,
    });
    assert.equal(initialWorkspace.statusCode, 200);
    assert.equal(
      initialWorkspace.json().currentState.fen.split(' ')[0],
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR',
    );

    const start = await runtime.host.inject({
      method: 'PUT',
      url: '/analysis/scratch',
      headers,
      payload: {
        scope: { kind: 'free' },
        expectedScratchId: null,
        expectedScratchRevision: null,
        action: { kind: 'start', origin: { kind: 'initial_position' } },
      },
    });
    assert.equal(start.statusCode, 200);
    assert.equal(start.json().scratch.scratchRevision, 1);

    const moved = await runtime.host.inject({
      method: 'PUT',
      url: '/analysis/scratch',
      headers,
      payload: {
        scope: { kind: 'free' },
        expectedScratchId: start.json().scratch.scratchId,
        expectedScratchRevision: 1,
        action: {
          kind: 'apply_move',
          move: { kind: 'notation', value: 'e4', locale: 'de-DE' },
        },
      },
    });
    assert.equal(moved.statusCode, 200);
    assert.equal(moved.json().scratch.steps[0].move.san, 'e4');

    const noted = await runtime.host.inject({
      method: 'PUT',
      url: '/analysis/scratch',
      headers,
      payload: {
        scope: { kind: 'free' },
        expectedScratchId: moved.json().scratch.scratchId,
        expectedScratchRevision: 2,
        action: { kind: 'prepare_note', body: 'Mein erster Analysepfad.' },
      },
    });
    assert.equal(noted.statusCode, 200);
    assert.equal(noted.json().scratch.scratchRevision, 3);

    const record = await runtime.host.inject({
      method: 'POST',
      url: '/inventory/analysis-records',
      headers,
      payload: {
        scope: { kind: 'free' },
        expectedScratchId: noted.json().scratch.scratchId,
        expectedScratchRevision: 3,
        displayName: 'Erste eigene Analyse',
        languageTag: 'de-DE',
      },
    });
    assert.equal(record.statusCode, 200);
    const recordDto = record.json();

    const inventory = await runtime.host.inject({
      url: '/inventory?query=Erste&pageSize=10',
      headers,
    });
    assert.equal(inventory.statusCode, 200);
    assert.equal(inventory.json().items[0].itemId, recordDto.itemId);

    const createdContext = await runtime.host.inject({
      method: 'POST',
      url: '/working-contexts',
      headers,
      payload: {
        displayName: 'Mein Repertoire',
        purpose: 'Eigene Eröffnungen ausbauen',
      },
    });
    assert.equal(createdContext.statusCode, 200);
    const contextId = createdContext.json().context.contextId;

    const referenced = await runtime.host.inject({
      method: 'POST',
      url: `/working-contexts/${contextId}/references`,
      headers,
      payload: {
        itemId: recordDto.itemId,
        anchorId: recordDto.rootAnchorId,
      },
    });
    assert.equal(referenced.statusCode, 200);

    const resumed = await runtime.host.inject({
      method: 'PUT',
      url: '/workspace/resume',
      headers,
      payload: {
        area: 'analyze',
        scope: { kind: 'context', contextId },
        expectedResumeVersion: null,
        mode: 'analyze',
        itemId: recordDto.itemId,
        revisionId: recordDto.revisionId,
        anchorId: recordDto.rootAnchorId,
      },
    });
    assert.equal(resumed.statusCode, 200);
    assert.equal(resumed.json().resume.resumeVersion, 1);

    const contextWorkspace = await runtime.host.inject({
      url: `/working-contexts/${contextId}`,
      headers,
    });
    assert.equal(contextWorkspace.statusCode, 200);
    assert.equal(contextWorkspace.json().references.length, 1);
    assert.equal(
      contextWorkspace.json().analysisResume.itemId,
      recordDto.itemId,
    );

    const contextAnalysis = await runtime.host.inject({
      url: `/analysis/workspace?scopeKind=context&contextId=${contextId}`,
      headers,
    });
    assert.equal(contextAnalysis.statusCode, 200);
    assert.equal(contextAnalysis.json().record.contextMember, true);
    assert.equal(contextAnalysis.json().record.contextMember, true);
  } finally {
    await runtime.close();
  }
});

test('failed composition releases the owner lease for a corrected restart', async (context) => {
  const applicationHome = await createApplicationHome(context);
  await assert.rejects(
    composeHost({
      applicationHome,
      defaultsDirectory: path.join(applicationHome, 'missing-defaults'),
      hostToken,
    }),
  );

  const runtime = await composeHost({
    applicationHome,
    defaultsDirectory,
    hostToken,
  });
  await runtime.close();
});

test('configured host diagnostics keep routine successful reads silent', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const initialized = await initializeConfiguration({
    applicationHome,
    defaultsDirectory,
  });
  const centralPath = path.join(initialized.activeDirectory, 'plysmith.json');
  const central = JSON.parse(await readFile(centralPath, 'utf8'));
  central.diagnostics.logging.level = 'debug';
  await writeFile(centralPath, `${JSON.stringify(central)}\n`, 'utf8');

  const runtime = await composeHost({
    applicationHome,
    defaultsDirectory,
    hostToken,
    now: () => '2026-09-14T12:00:00.000Z',
    correlationIdFactory: () => 'host-generated-correlation',
  });
  runtime.markReady();
  const response = await runtime.host.inject({
    url: '/analysis/workspace?scopeKind=free',
    headers: {
      host: '127.0.0.1',
      authorization: `Bearer ${hostToken}`,
      'x-plysmith-correlation-id': 'desktop-correlation-1',
    },
  });
  assert.equal(response.statusCode, 200);
  const writeResponse = await runtime.host.inject({
    method: 'PUT',
    url: '/preferences/ui-language',
    headers: {
      host: '127.0.0.1',
      authorization: `Bearer ${hostToken}`,
      'content-type': 'application/json',
      'x-plysmith-correlation-id': 'desktop-correlation-2',
    },
    payload: { uiLocale: 'de-DE', expectedRevision: 1 },
  });
  assert.equal(writeResponse.statusCode, 200);
  await runtime.close();

  const directory = path.join(applicationHome, 'diagnostics');
  const files = await readdir(directory);
  const content = await readFile(path.join(directory, files[0]!), 'utf8');
  const events = content
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.ok(
    !events.some(
      (event) =>
        event.eventCode === 'host.request.completed' &&
        event.operation === 'GetAnalysisWorkspace',
    ),
  );
  assert.ok(
    events.some(
      (event) =>
        event.eventCode === 'host.request.completed' &&
        event.operation === 'SetUiLanguage' &&
        event.correlationId === 'desktop-correlation-2' &&
        event.status === 'succeeded',
    ),
  );
  assert.ok(events.some((event) => event.eventCode === 'host.lifecycle.ready'));
  assert.ok(
    events.some((event) => event.eventCode === 'host.lifecycle.stopped'),
  );
  assert.doesNotMatch(content, /scopeKind|analysis\/workspace|Bearer/);
});

test('host path parsing keeps source application home and install root explicit', () => {
  const paths = parseHostPaths([
    '--application-home',
    'C:\\Users\\example\\AppData\\Local\\Plysmith',
    '--install-root',
    'C:\\Program Files\\Plysmith',
  ]);

  assert.equal(
    paths.defaultsDirectory,
    path.resolve('C:\\Program Files\\Plysmith', 'configuration', 'defaults'),
  );
  assert.equal(
    paths.applicationHome,
    path.resolve('C:\\Users\\example\\AppData\\Local\\Plysmith'),
  );
});

test('host startup failure includes the error and its cause', () => {
  const error = new Error('Could not open the persistence store.', {
    cause: new Error('Database file is locked.'),
  });

  const output = formatHostStartupFailure(error);

  assert.match(output, /^Plysmith Application Host could not start\./);
  assert.match(output, /Could not open the persistence store\./);
  assert.match(output, /Caused by: Error: Database file is locked\./);
});

async function createApplicationHome(context: TestContext): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'plysmith-composed-'));
  context.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}
