// Opt-in after build; only owned profiles, with native picker responses stubbed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import {
  composeHost,
  type ComposedHost,
} from '../app/bootstrap/host/composition-root.ts';
import { publishHostDiscovery } from '../app/infrastructure/adapters/platform/windows/index.ts';
import {
  connectHost,
  type PlysmithHostClient,
} from '../app/infrastructure/channels/host_client/index.ts';
import { inventoryBackupMessages } from '../app/infrastructure/channels/ui/renderer/inventory-backup-messages.ts';

const repository = await realpath(process.cwd());
const artifacts = await mkdtemp(
  path.join(tmpdir(), 'plysmith-transfer-runtime-'),
);
const backup = path.join(artifacts, 'manual-backup.pgn');
const repeated = path.join(artifacts, 'restored-backup.pgn');
const screenshots: string[] = [];
const steps: string[] = [];
const errors: string[] = [];
let host: ComposedHost | undefined;
let desktop: Awaited<ReturnType<typeof electron.launch>> | undefined;
let page: Page | undefined;
let client!: PlysmithHostClient;
let home = path.join(artifacts, 'source');
let locale: 'de-DE' | 'en-GB' = 'de-DE';

console.log('Artifacts: ' + artifacts);
function label(key: keyof (typeof inventoryBackupMessages)['de-DE']): string {
  return inventoryBackupMessages[locale][key];
}
async function startHost() {
  host = await composeHost({
    applicationHome: home,
    defaultsDirectory: path.join(repository, 'configuration/defaults'),
  });
  const endpoint = await host.host.listen({ host: '127.0.0.1', port: 0 });
  host.markReady();
  const discovery = {
    ownerId: host.ownerId,
    pid: process.pid,
    endpoint: new URL(endpoint).toString(),
    productRelease: host.productRelease,
    contractFingerprint: host.contractFingerprint,
    token: host.hostToken,
  };
  await publishHostDiscovery(home, discovery);
  client = await connectHost(discovery);
}
async function stop() {
  const app = desktop;
  desktop = undefined;
  page = undefined;
  try {
    await app?.close();
  } finally {
    const runtime = host;
    host = undefined;
    await runtime?.close();
  }
}
async function launch() {
  desktop = await electron.launch({
    executablePath: path.join(
      repository,
      'node_modules/electron/dist/electron.exe',
    ),
    args: [
      path.join(repository, 'build/desktop/main.mjs'),
      '--application-home',
      home,
      '--install-root',
      repository,
    ],
    cwd: repository,
    timeout: 60_000,
  });
  page = await desktop.firstWindow({ timeout: 60_000 });
  page.setDefaultTimeout(30_000);
  page.on('pageerror', (error) => errors.push(error.message));
  const profile = await desktop.evaluate(({ app }) => app.getPath('userData'));
  assert.equal(profile, path.join(home, 'desktop/profile'));
  await page
    .getByRole('navigation', { name: 'Plysmith' })
    .waitFor({ timeout: 60_000 });
  await page
    .getByText(/^(Verbunden|Connected)$/)
    .first()
    .waitFor();
  await settings();
}
async function settings() {
  assert(page);
  await page
    .getByRole('button', { name: /^(Einstellungen|Settings)$/ })
    .click();
  await page
    .getByRole('heading', { name: label('backup.title'), exact: true })
    .waitFor();
}
async function capture(name: string) {
  assert(page);
  await page.evaluate('document.fonts.ready');
  const file = path.join(artifacts, name + '.png');
  await page.screenshot({ path: file, fullPage: true });
  screenshots.push(file);
  const violations = (await new AxeBuilder({ page }).setLegacyMode().analyze())
    .violations;
  assert.deepEqual(violations, [], name + ': accessibility');
  assert.equal(
    await page.evaluate<boolean>(
      'document.documentElement.scrollWidth <= innerWidth + 1',
    ),
    true,
    name + ': overflow',
  );
  assert.deepEqual(errors, [], 'No renderer exceptions');
}
async function saveThroughDesktop(file: string) {
  assert(desktop && page);
  await desktop.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, file);
  await page
    .getByRole('button', { name: label('backup.create'), exact: true })
    .click();
  await page
    .getByText(
      label('backup.created').replace('{fileName}', path.basename(file)),
      { exact: true },
    )
    .waitFor();
}
async function inventory() {
  return (await client.searchInventory({ pageSize: '100' })).items;
}
async function settingsHashes() {
  const directory = path.join(home, 'configuration/active');
  const entries = (await readdir(directory)).sort();
  return Promise.all(
    entries.map(async (entry) => [
      entry,
      createHash('sha256')
        .update(await readFile(path.join(directory, entry)))
        .digest('hex'),
    ]),
  );
}
async function setLocale(value: 'de-DE' | 'en-GB') {
  await client.setUiLanguage({
    uiLocale: value,
    expectedRevision: (await client.getUserPreferences()).preferenceRevision,
  });
  locale = value;
  await stop();
  await startHost();
  await launch();
}

try {
  await startHost();
  const input = await client.registerImportInput({
    inputLocator: path.join(repository, 'docs/manual/manual.pgn'),
  });
  const preview = await client.prepareImport({
    inputHandle: input.inputHandle,
    languageTag: locale,
  });
  assert.equal(preview.candidates.length, 6);
  assert(
    preview.candidates.every((candidate) => candidate.status !== 'rejected'),
  );
  await client.publishImport({
    previewId: preview.previewId,
    candidates: preview.candidates.map((candidate, index) => ({
      sourceOrder: candidate.sourceOrder,
      displayName: candidate.suggestedName,
      itemType: index === 2 ? 'game' : 'analysis',
    })),
    folder: { kind: 'new', displayName: 'Manual' },
    confirmWarnings: true,
  });
  const names = (await inventory()).map((item) => item.displayName);
  assert.equal(names.length, 6);
  await launch();
  assert.equal((await client.getInventoryBackupStatus()).canRestore, false);
  await page!.setViewportSize({ width: 1280, height: 900 });
  await saveThroughDesktop(backup);
  await capture('source-backup-de');
  const backupSection = path.join(artifacts, 'backup-section-de.png');
  await page!
    .getByRole('region', { name: label('backup.title'), exact: true })
    .screenshot({ path: backupSection });
  screenshots.push(backupSection);
  steps.push('Manual PGN imported; native IPC export; occupied target blocked');
  await stop();

  home = path.join(artifacts, 'target');
  await startHost();
  await launch();
  assert.equal(
    (await client.getInventoryBackupStatus()).canRestore,
    true,
    'Fresh desktop after startup is restorable',
  );
  const settingsBefore = await settingsHashes();
  await desktop!.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    });
  }, backup);
  await page!
    .getByRole('button', { name: label('backup.chooseRestore'), exact: true })
    .click();
  await page!
    .getByRole('button', { name: label('backup.confirm'), exact: true })
    .waitFor();
  const restoreDialog = path.join(artifacts, 'restore-dialog-de.png');
  await page!.getByRole('dialog').screenshot({ path: restoreDialog });
  screenshots.push(restoreDialog);
  await page!.setViewportSize({ width: 390, height: 844 });
  await capture('restore-preview-de-390');
  await page!
    .getByRole('button', { name: label('backup.confirm'), exact: true })
    .click();
  await page!.getByText(label('backup.restored'), { exact: true }).waitFor();
  assert.deepEqual(
    (await inventory()).map((item) => item.displayName),
    names,
  );
  assert.deepEqual(
    await settingsHashes(),
    settingsBefore,
    'Restore leaves configuration unchanged',
  );
  assert.equal((await client.getInventoryBackupStatus()).canRestore, false);
  steps.push(
    'Fresh owned target restored through desktop confirmation; settings preserved',
  );
  await saveThroughDesktop(repeated);
  assert.deepEqual(
    await readFile(repeated),
    await readFile(backup),
    'Deterministic complete Manual roundtrip',
  );
  steps.push('Re-export byte-identical including metadata, RAV and notes');

  await setLocale('en-GB');
  assert.deepEqual(
    (await inventory()).map((item) => item.displayName),
    names,
  );
  for (const width of [1280, 900, 390]) {
    await page!.setViewportSize({ width, height: 900 });
    await capture(`restored-settings-en-${width}`);
  }
  await page!.setViewportSize({ width: 1280, height: 900 });
  await page!
    .getByRole('navigation', { name: 'Plysmith' })
    .getByRole('button', { name: 'Manage', exact: true })
    .click();
  await page!
    .getByText('Italienische Eröffnung', { exact: true })
    .first()
    .waitFor();
  await capture('restored-manual-inventory-en');
  steps.push(
    'Host and desktop restarted; restored inventory usable; EN 1280/900/390 accessibility',
  );
  const restoredItems = await inventory();
  const italian = restoredItems.find(
    (item) => item.displayName === 'Italienische Eröffnung',
  );
  const game = restoredItems.find((item) => item.itemType === 'game');
  assert(italian && game);
  const record = await client.getInventoryRevision(
    italian.itemId,
    italian.currentRevisionId,
    { scopeKind: 'free' },
  );
  assert(record.tree);
  const branch = record.tree.nodes.find((node) => node.siblingOrder > 0);
  assert(branch);
  const branchWorkspace = await client.getAnalysisWorkspace({
    scopeKind: 'free',
    itemId: italian.itemId,
    revisionId: record.revisionId,
    anchorId: branch.anchorId,
  });
  const noteBody = 'Native restore: branch note';
  await client.createPositionNote({
    scope: { kind: 'free' },
    itemId: italian.itemId,
    revisionId: record.revisionId,
    anchorId: branch.anchorId,
    body: noteBody,
    languageTag: 'en-GB',
    noteScope: { kind: 'global' },
  });
  const begun = await client.updateAnalysisScratch({
    scope: { kind: 'free' },
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: {
      kind: 'start',
      origin: {
        kind: 'inventory_anchor',
        itemId: italian.itemId,
        revisionId: record.revisionId,
        anchorId: branch.anchorId,
      },
    },
  });
  assert(begun.scratch);
  const derived = await client.createAnalysisRecord({
    scope: { kind: 'free' },
    expectedScratchId: begun.scratch.scratchId,
    expectedScratchRevision: begun.scratch.scratchRevision,
    displayName: 'Derived after restore',
    languageTag: 'en-GB',
  });
  const edit = await client.startInventoryRevision(derived.itemId, {
    scope: { kind: 'free' },
    baseRevisionId: derived.revisionId,
    anchorId: derived.rootAnchorId,
    mode: 'extend',
    expectedScratchId: null,
    expectedScratchRevision: null,
    firstMove: { kind: 'coordinates', value: 'd2d3' },
  });
  const revisionRequest = {
    scope: { kind: 'free' as const },
    expectedScratchId: edit.scratch.scratchId,
    expectedScratchRevision: edit.scratch.scratchRevision,
  };
  const revisionPreview =
    await client.previewInventoryRevision(revisionRequest);
  await client.saveInventoryRevision({
    ...revisionRequest,
    previewFingerprint: revisionPreview.previewFingerprint,
  });
  const gameRecord = await client.getInventoryRevision(
    game.itemId,
    game.currentRevisionId,
    { scopeKind: 'free' },
  );
  await assert.rejects(
    client.startInventoryRevision(game.itemId, {
      scope: { kind: 'free' },
      baseRevisionId: game.currentRevisionId,
      anchorId: gameRecord.rootAnchorId,
      mode: 'add_variation',
      expectedScratchId: null,
      expectedScratchRevision: null,
    }),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'problem' in error &&
      (error.problem as { code: string }).code === 'inventory.invalid_revision',
  );
  await stop();
  await startHost();
  const noteWorkspace = await client.getAnalysisWorkspace({
    scopeKind: 'free',
    itemId: italian.itemId,
    revisionId: record.revisionId,
    anchorId: branch.anchorId,
  });
  assert(
    noteWorkspace.record?.contributions.some((note) => note.body === noteBody),
  );
  const derivedItem = (await inventory()).find(
    (item) => item.itemId === derived.itemId,
  );
  assert(derivedItem);
  const derivedRecord = await client.getInventoryRevision(
    derived.itemId,
    derivedItem.currentRevisionId,
    { scopeKind: 'free' },
  );
  assert.equal(derivedRecord.origin.kind, 'inventory_anchor');
  assert.equal(derivedRecord.root.fen, branchWorkspace.currentState.fen);
  assert.equal(derivedRecord.steps.length, 1);
  assert.equal(
    (await inventory()).find((item) => item.itemId === game.itemId)
      ?.currentRevisionId,
    game.currentRevisionId,
  );
  steps.push(
    'Restored branch navigated; global note, derived analysis and mainline revision saved and retained after another restart; game variant edit refused',
  );
  console.log('PASS ' + steps.join('; '));
} catch (error) {
  if (page && !page.isClosed()) {
    await page
      .screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true })
      .catch(() => {});
    await writeFile(
      path.join(artifacts, 'failure-dom.txt'),
      await page.locator('body').innerText(),
    ).catch(() => {});
  }
  throw error;
} finally {
  await stop();
  await mkdir(artifacts, { recursive: true });
  await writeFile(
    path.join(artifacts, 'proof.json'),
    JSON.stringify(
      {
        steps,
        screenshots,
        errors,
        limits: [
          'Native pickers stubbed in owned Electron process; no human picker acceptance claimed.',
        ],
        ownedRoot: artifacts,
        stopped: host === undefined && desktop === undefined,
      },
      null,
      2,
    ) + '\n',
  );
}
