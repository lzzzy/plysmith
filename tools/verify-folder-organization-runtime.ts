// Opt-in: node tools/verify-folder-organization-runtime.ts [--api-only] [--software-rendering]
// Build the settled desktop separately before running the complete acceptance.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  _electron as electron,
  expect,
  type Locator,
  type Page,
  type Request,
} from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import {
  composeHost,
  type ComposedHost,
} from '../app/bootstrap/host/composition-root.ts';
import { publishHostDiscovery } from '../app/infrastructure/adapters/platform/windows/index.ts';
import {
  connectHost,
  HostClientProblem,
  type PlysmithHostClient,
  type AnalysisWorkspaceDto,
  type CreateAnalysisRecordResultDto,
  type UpdateAnalysisScratchRequestDto,
  type ChangeInventoryOrganizationRequestDto,
} from '../app/infrastructure/channels/host_client/index.ts';
import { messages } from '../app/infrastructure/channels/ui/renderer/messages.ts';

const arguments_ = process.argv.slice(2);
assert.ok(
  arguments_.every(
    (value) => value === '--api-only' || value === '--software-rendering',
  ),
  'Supported options: --api-only, --software-rendering.',
);
const apiOnly = arguments_.includes('--api-only');
const softwareRendering = arguments_.includes('--software-rendering');
const repo = process.cwd();
const artifacts = path.resolve(
  repo,
  'build/verification/folder-organization',
  randomUUID(),
);
const applicationHome = path.join(artifacts, 'home');
const stockfish =
  'C:/XProgramme/stockfish/stockfish-windows-x86-64-universal.exe';
const free = { kind: 'free' } as const;
type Scope = UpdateAnalysisScratchRequestDto['scope'];
type Scratch = NonNullable<AnalysisWorkspaceDto['scratch']>;
type Created = CreateAnalysisRecordResultDto;
type Change = ChangeInventoryOrganizationRequestDto['change'];
type Locale = 'de-DE' | 'en-GB';
const steps: { name: string; status: 'passed' | 'failed'; detail?: string }[] =
  [];
const limits: string[] = [];
if (softwareRendering)
  limits.push(
    'Electron uses software rendering with an in-process GPU; hardware GPU startup is not verified.',
  );
const errors: string[] = [];
const accessibilityFindings: { screenshot: string; violations: unknown }[] = [];
const desktopOutput: string[] = [];
let runtime: ComposedHost | undefined;
let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
let page: Page | undefined;
let client: PlysmithHostClient;
let locale: Locale = 'de-DE';
let seed: Awaited<ReturnType<typeof seedFamilies>> | undefined;
let membershipContextId: string | undefined;
let engineAvailable = false;
let failed = false;
await mkdir(artifacts, { recursive: true });
console.log('Artifacts: ' + artifacts);
process.once('uncaughtException', (error) => {
  failed = true;
  errors.push(error.stack ?? error.message);
  console.error('Uncaught verification failure: ' + error.message);
  void (async () => {
    try {
      await closeDesktop();
    } catch (closeError) {
      errors.push(String(closeError));
    }
    try {
      await closeHost();
    } catch (closeError) {
      errors.push(String(closeError));
    }
    await persistProof();
    process.exit(1);
  })();
});

function label(key: string) {
  const value = (messages[locale] as Readonly<Record<string, string>>)[key];
  assert.ok(value, 'Unknown UI message: ' + key);
  return value;
}

async function persistProof() {
  await writeFile(
    path.join(artifacts, 'desktop-output.txt'),
    desktopOutput.join(''),
  );
  await writeFile(
    path.join(artifacts, 'proof.json'),
    JSON.stringify(
      {
        applicationHome,
        apiOnly,
        engineAvailable,
        steps,
        limits,
        errors,
        accessibilityFindings,
        seed,
        membershipContextId,
      },
      null,
      2,
    ) + '\n',
  );
}

async function step(name: string, action: () => Promise<void>) {
  console.log('RUN ' + name);
  try {
    await action();
    steps.push({ name, status: 'passed' });
    console.log('PASS ' + name);
  } catch (error) {
    const detail =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    steps.push({ name, status: 'failed', detail });
    console.error('FAIL ' + name + ': ' + detail);
    if (page && !page.isClosed()) {
      await page
        .screenshot({
          path: path.join(artifacts, 'failure.png'),
          fullPage: true,
        })
        .catch(() => undefined);
      await writeFile(
        path.join(artifacts, 'failure-dom.txt'),
        await page.locator('body').innerText(),
      ).catch(() => undefined);
      await writeFile(
        path.join(artifacts, 'failure-dom.html'),
        await page.content(),
      ).catch(() => undefined);
    }
    throw error;
  } finally {
    if (page && !page.isClosed()) {
      const dragEvents = await page
        .evaluate('window.__folderDragLog ?? []')
        .catch(() => []);
      await writeFile(
        path.join(artifacts, 'drag-events.json'),
        JSON.stringify(dragEvents, null, 2),
      );
    }
    await persistProof();
  }
}

async function startHost() {
  runtime = await composeHost({
    applicationHome,
    defaultsDirectory: path.join(repo, 'configuration/defaults'),
  });
  const endpoint = await runtime.host.listen({ host: '127.0.0.1', port: 0 });
  runtime.markReady();
  const discovery = {
    ownerId: runtime.ownerId,
    pid: process.pid,
    endpoint: new URL(endpoint).toString(),
    productRelease: runtime.productRelease,
    contractFingerprint: runtime.contractFingerprint,
    token: runtime.hostToken,
  };
  await publishHostDiscovery(applicationHome, discovery);
  client = await connectHost(discovery);
}

async function closeDesktop() {
  if (!application) return;
  const owned = application;
  const child = owned.process();
  application = undefined;
  page = undefined;
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    await Promise.race([
      (async () => {
        await owned.evaluate(({ app }) => {
          setTimeout(() => app.quit(), 0);
        });
        await expect
          .poll(() => child.exitCode !== null || child.signalCode !== null, {
            timeout: 30_000,
          })
          .toBe(true);
      })(),
      delay(35_000, undefined, { ref: false }).then(() => {
        throw new Error('Electron close timed out');
      }),
    ]);
  } catch (error) {
    if (child.exitCode === null) child.kill();
    await expect
      .poll(() => child.exitCode !== null || child.signalCode !== null, {
        timeout: 10_000,
      })
      .toBe(true);
    throw error;
  }
}

async function closeHost() {
  if (!runtime) return;
  const owned = runtime;
  runtime = undefined;
  await owned.close();
}

async function restart() {
  await closeDesktop();
  await closeHost();
  await startHost();
}

async function launchDesktop() {
  await access(path.join(repo, 'build/desktop/main.mjs'));
  application = await electron.launch({
    executablePath: path.join(repo, 'node_modules/electron/dist/electron.exe'),
    args: [
      path.join(repo, 'build/desktop/main.mjs'),
      ...(softwareRendering ? ['--disable-gpu', '--in-process-gpu'] : []),
      '--application-home',
      applicationHome,
      '--install-root',
      repo,
    ],
    cwd: repo,
    timeout: 60_000,
  });
  for (const stream of [
    application.process().stdout,
    application.process().stderr,
  ]) {
    stream?.on('data', (chunk: Buffer) => desktopOutput.push(chunk.toString()));
  }
  page = await application.firstWindow({ timeout: 60_000 });
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluate(`window.__folderDragLog = [];
    for (const name of ['dragstart', 'drop']) document.addEventListener(name, (event) => {
      window.__folderDragLog.push({ name, target: event.target.outerHTML?.slice(0, 1000),
        payload: event.dataTransfer?.getData('application/x-plysmith-inventory') });
    });`);
  await page
    .getByRole('navigation', { name: 'Plysmith' })
    .waitFor({ timeout: 60_000 });
  await page
    .getByText(/^(Verbunden|Connected)$/)
    .first()
    .waitFor();
  const paths = await application.evaluate(({ app }) => ({
    userData: app.getPath('userData'),
    sessionData: app.getPath('sessionData'),
  }));
  assert.equal(paths.userData, path.join(applicationHome, 'desktop/profile'));
  assert.equal(
    paths.sessionData,
    path.join(applicationHome, 'desktop/profile/session'),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  const window = await application.browserWindow(page);
  await window.evaluate((window) => {
    window.show();
    window.focus();
  });
  await window.dispose();
  await page.bringToFront();
  return page;
}

async function workspace(scope: Scope = free) {
  return client.getAnalysisWorkspace({
    scopeKind: scope.kind,
    ...(scope.kind === 'context' ? { contextId: scope.contextId } : {}),
  });
}

async function update(
  scope: Scope,
  action: UpdateAnalysisScratchRequestDto['action'],
  current?: Scratch,
) {
  const result = await client.updateAnalysisScratch({
    scope,
    action,
    expectedScratchId: current?.scratchId ?? null,
    expectedScratchRevision: current?.scratchRevision ?? null,
  });
  assert.ok(result.scratch);
  return result.scratch;
}

async function change(change: Change) {
  const organization = await client.getInventoryOrganization({});
  return client.changeInventoryOrganization({
    expectedDataRevision: organization.dataRevision,
    change,
  });
}

async function folder(displayName: string, parentFolderId?: string) {
  const result = await change({
    kind: 'create_folder',
    displayName,
    ...(parentFolderId ? { parentFolderId } : {}),
  });
  assert.ok(result.folderId);
  return result.folderId;
}

async function save(scratch: Scratch, displayName: string, folderId?: string) {
  return client.createAnalysisRecord({
    scope: free,
    expectedScratchId: scratch.scratchId,
    expectedScratchRevision: scratch.scratchRevision,
    displayName,
    languageTag: 'en-GB',
    ...(folderId === undefined ? {} : { folderId }),
  });
}

async function inventory() {
  return client.searchInventory({ pageSize: '100' });
}
async function item(id: string) {
  const result = (await inventory()).items.find((entry) => entry.itemId === id);
  assert.ok(result, 'Missing inventory item ' + id);
  return result;
}

async function configureEngine() {
  engineAvailable = await access(stockfish).then(
    () => true,
    () => false,
  );
  if (!engineAvailable) {
    limits.push('Stockfish executable absent; no real engine games verified.');
    return;
  }
  await client.saveEngineProviderConfiguration('folder-stockfish', {
    expectedConfigurationRevision: null,
    input: {
      instanceId: 'folder-stockfish',
      displayName: 'Folder acceptance Stockfish',
      providerType: 'stockfish-uci',
      executablePath: stockfish,
      arguments: [],
      threads: 1,
      hashMb: 16,
      moveTimeMs: 50,
      startupTimeoutMs: 10_000,
      moveTimeoutMs: 10_000,
      stopTimeoutMs: 2_000,
      maxOutputBytes: 65_536,
    },
  });
  await restart();
  const providers = await client.listMovePolicyProviders();
  assert.ok(
    providers.providers.some(
      (entry) => entry.instanceId === 'folder-stockfish',
    ),
  );
}

async function game(parent: Created, displayName: string) {
  let current = await client.startPlayout({
    scope: free,
    providerInstanceId: 'folder-stockfish',
    capability: 'best_move',
    start: {
      kind: 'inventory_anchor',
      itemId: parent.itemId,
      revisionId: parent.revisionId,
      anchorId: parent.rootAnchorId,
      continuation: [],
    },
    opening: { kind: 'provider_move' },
  });
  await expect
    .poll(
      async () => {
        const read = await client.getPlayout({ scopeKind: 'free' });
        assert.ok(read);
        current = read;
        return current.draft.status.kind;
      },
      { timeout: 30_000 },
    )
    .not.toBe('awaiting_policy');
  assert.equal(current.draft.status.kind, 'active');
  assert.ok(
    current.draft.steps.length > 0,
    'Real Stockfish must produce a move',
  );
  current = await client.stopPlayout({
    scope: free,
    draftId: current.draft.draftId,
    expectedDraftRevision: current.draft.draftRevision,
  });
  return client.completePlayout({
    scope: free,
    draftId: current.draft.draftId,
    expectedDraftRevision: current.draft.draftRevision,
    completionId: randomUUID(),
    displayName,
    languageTag: 'en-GB',
    manualResult: 'unfinished',
  });
}

async function seedFamilies() {
  assert.equal(
    (await inventory()).items.length,
    0,
    'Only a fresh isolated store can be seeded',
  );
  const openings = await folder('Openings');
  const branches = await folder('Branches', openings);
  const independent = await folder('Independent 1.e4');
  const endings = await folder('Endgames');
  const empty = await folder('Empty destination');
  const loss = await folder('Removal target');
  const families: {
    root: Created;
    child: Created;
    game?: Awaited<ReturnType<typeof game>>;
  }[] = [];
  for (const [name, folderId, moves, fen, continuation] of [
    ['Opening root', openings, [], undefined, ['e2e4']],
    ['Independent e4 root', independent, ['e2e4'], undefined, ['c7c5']],
    [
      'Opposition root',
      endings,
      [],
      '8/4k3/8/4K3/4P3/8/8/8 w - - 0 1',
      ['e5d5', 'e7d7'],
    ],
  ] as const) {
    let origin: Extract<
      UpdateAnalysisScratchRequestDto['action'],
      { kind: 'start' }
    >['origin'] = { kind: 'initial_position' };
    if (fen) {
      const validated = await client.validateAnalysisSetup({
        input: { kind: 'fen', fen },
      });
      assert.equal(validated.valid, true);
      if (validated.valid)
        origin = { kind: 'position_setup', setup: validated.setup };
    }
    let scratch = await update(free, { kind: 'start', origin });
    for (const value of moves)
      scratch = await update(
        free,
        { kind: 'apply_move', move: { kind: 'coordinates', value } },
        scratch,
      );
    const root = await save(scratch, name, folderId);
    const rootView = await client.getInventoryRevision(
      root.itemId,
      root.revisionId,
      { scopeKind: 'free' },
    );
    assert.notEqual(rootView.origin.kind, 'inventory_anchor');
    scratch = await update(free, {
      kind: 'start',
      origin: {
        kind: 'inventory_anchor',
        itemId: root.itemId,
        revisionId: root.revisionId,
        anchorId: rootView.steps.at(-1)?.anchorId ?? root.rootAnchorId,
      },
    });
    for (const value of continuation)
      scratch = await update(
        free,
        { kind: 'apply_move', move: { kind: 'coordinates', value } },
        scratch,
      );
    const child = await save(scratch, name + ' branch');
    const childView = await client.getInventoryRevision(
      child.itemId,
      child.revisionId,
      { scopeKind: 'free' },
    );
    assert.equal(childView.origin.kind, 'inventory_anchor');
    if (childView.origin.kind === 'inventory_anchor')
      assert.equal(childView.origin.itemId, root.itemId);
    assert.equal((await item(child.itemId)).folderId, folderId);
    families.push({
      root,
      child,
      ...(engineAvailable
        ? { game: await game(root, name + ' practice') }
        : {}),
    });
  }
  await change({
    kind: 'move_items',
    itemIds: [families[0]!.child.itemId],
    folderId: branches,
  });
  const alpha = (
    await client.createWorkingContext({ displayName: 'Context Alpha' })
  ).context.contextId;
  const beta = (
    await client.createWorkingContext({ displayName: 'Context Beta' })
  ).context.contextId;
  await change({
    kind: 'include_folder',
    folderId: openings,
    contextId: alpha,
    includeItems: true,
  });
  await change({
    kind: 'include_folder',
    folderId: empty,
    contextId: alpha,
    includeItems: false,
  });
  const lateFolder = await folder('Later subtree', openings);
  let lateScratch = await update(free, {
    kind: 'start',
    origin: { kind: 'initial_position' },
  });
  lateScratch = await update(
    free,
    { kind: 'apply_move', move: { kind: 'coordinates', value: 'd2d4' } },
    lateScratch,
  );
  const late = await save(lateScratch, 'Later inventory only', openings);
  assert.ok(
    !(await item(late.itemId)).contextIds.includes(alpha),
    'Folder inclusion is a snapshot',
  );
  const organization = await client.getInventoryOrganization({
    contextId: alpha,
  });
  assert.ok(organization.linkedFolderIds.includes(empty));
  assert.ok(
    !organization.linkedFolderIds.includes(lateFolder),
    'Future subfolders are not automatically linked',
  );
  await change({
    kind: 'move_items',
    itemIds: [families[0]!.child.itemId],
    folderId: loss,
  });
  for (const contextId of [alpha, beta])
    await change({
      kind: 'include_folder',
      folderId: loss,
      contextId,
      includeItems: true,
    });
  const source = families[0]!.child;
  for (const contextId of [alpha, beta]) {
    const scope = { kind: 'context', contextId } as const;
    await client.createPositionNote({
      scope,
      itemId: source.itemId,
      revisionId: source.revisionId,
      anchorId: source.rootAnchorId,
      body: 'Retain only in ' + contextId,
      languageTag: 'en-GB',
      noteScope: { kind: 'context', contextId },
    });
    let scratch = await update(scope, {
      kind: 'start',
      origin: {
        kind: 'inventory_anchor',
        itemId: source.itemId,
        revisionId: source.revisionId,
        anchorId: source.rootAnchorId,
      },
    });
    scratch = await update(
      scope,
      { kind: 'apply_move', move: { kind: 'coordinates', value: 'd2d4' } },
      scratch,
    );
    scratch = await update(
      scope,
      { kind: 'prepare_note', body: 'Unfinished context work ' + contextId },
      scratch,
    );
    assert.equal(
      scratch.noteDraft?.body,
      'Unfinished context work ' + contextId,
    );
  }
  const retained = await client.previewContextFolderRemoval({
    folderId: loss,
    contextId: alpha,
  });
  await change({
    kind: 'move_items',
    itemIds: [source.itemId],
    folderId: empty,
    workContextId: alpha,
  });
  assert.deepEqual(
    (
      await client.previewContextFolderRemoval({
        folderId: empty,
        contextId: alpha,
      })
    ).losses,
    retained.losses,
  );
  await change({
    kind: 'move_items',
    itemIds: [source.itemId],
    folderId: loss,
    workContextId: alpha,
  });
  return {
    folders: {
      openings,
      branches,
      independent,
      endings,
      empty,
      loss,
      lateFolder,
    },
    families,
    alpha,
    beta,
    late,
  };
}

async function rejectedWrites() {
  assert.ok(seed);
  for (const [change_, code] of [
    [
      {
        kind: 'move_folder',
        folderId: seed.folders.openings,
        parentFolderId: seed.folders.branches,
      },
      'inventory.cycle',
    ],
    [
      { kind: 'create_folder', displayName: 'Openings' },
      'inventory.name_conflict',
    ],
    [
      {
        kind: 'move_items',
        itemIds: [seed.late.itemId],
        folderId: seed.folders.empty,
        workContextId: seed.alpha,
      },
      'workspace.inventory_work_not_allowed',
    ],
  ] as const) {
    const before = await client.getInventoryOrganization({});
    await assert.rejects(
      () =>
        client.changeInventoryOrganization({
          change: change_,
          expectedDataRevision: before.dataRevision,
        }),
      (error: unknown) =>
        error instanceof HostClientProblem && error.problem.code === code,
    );
    assert.deepEqual(await client.getInventoryOrganization({}), before);
  }
  const before = await client.getInventoryOrganization({});
  await folder('Concurrent write');
  await assert.rejects(
    () =>
      client.changeInventoryOrganization({
        expectedDataRevision: before.dataRevision,
        change: {
          kind: 'rename_folder',
          folderId: seed!.folders.empty,
          displayName: 'Stale overwrite',
        },
      }),
    (error: unknown) =>
      error instanceof HostClientProblem &&
      error.problem.code === 'inventory.organization_conflict',
  );
}

function group(folderId: string) {
  return page!.locator('section[data-folder-id="' + folderId + '"]');
}
function folderHeader(folderId: string) {
  return group(folderId).locator(':scope > div').first();
}
function itemRow(folderId: string, name: string) {
  return group(folderId)
    .locator('li[draggable="true"]')
    .filter({ has: page!.getByText(name, { exact: true }) });
}
async function activateAction(
  owner: Locator,
  name: string | RegExp,
  keyboard = false,
) {
  const direct = owner.getByRole('button', { name, exact: true });
  if (await direct.isVisible()) {
    if (keyboard) await direct.press('Enter');
    else await direct.click();
    return;
  }
  const trigger = owner.locator('button[aria-haspopup]');
  await expect(trigger).toBeVisible();
  if (keyboard) await trigger.press('Enter');
  else await trigger.click();
  const action = page!.getByRole('menuitem', { name, exact: true });
  if (keyboard) await action.press('Enter');
  else await action.click();
}
async function manage(
  contextId?: string,
  all = false,
  presentation: 'folders' | 'origins' = 'folders',
) {
  await page!
    .getByRole('navigation', { name: 'Plysmith' })
    .getByRole('button', { name: label('activity.manage'), exact: true })
    .click();
  await page!
    .getByLabel(label('scope.label'), { exact: true })
    .selectOption(
      contextId
        ? { value: 'context:' + contextId }
        : { label: label('scope.free') },
    );
  await expect(
    page!.getByLabel(label('scope.label'), { exact: true }),
  ).toHaveValue(contextId ? 'context:' + contextId : 'free');
  if (contextId)
    await page!
      .getByRole('radio', {
        name: label(all ? 'manage.allInventory' : 'manage.inContext'),
        exact: true,
      })
      .press('Space');
  const view = page!.getByRole('radio', {
    name: label(
      presentation === 'folders' ? 'folders.view' : 'folders.origins',
    ),
    exact: true,
  });
  await expect(view).toBeChecked();
  await expect(view).toBeEnabled();
}

async function screenshot(name: string) {
  assert.ok(page);
  await page.evaluate('document.fonts.ready');
  await page.screenshot({
    path: path.join(artifacts, name + '.png'),
    fullPage: true,
  });
  const violations = (await new AxeBuilder({ page }).setLegacyMode().analyze())
    .violations;
  await writeFile(
    path.join(artifacts, name + '-axe.json'),
    JSON.stringify(violations, null, 2),
  );
  if (violations.length > 0) {
    accessibilityFindings.push({ screenshot: name, violations });
    console.error(
      'ACCESSIBILITY: ' +
        name +
        ': ' +
        violations.map((entry) => entry.id).join(', '),
    );
  }
  assert.ok(
    await page.evaluate<boolean>(
      'document.documentElement.scrollWidth <= innerWidth + 1',
    ),
    'No horizontal document overflow',
  );
  assert.deepEqual(errors, [], 'No renderer errors');
}

async function basicUi() {
  assert.ok(seed && page);
  // Native drag gestures need both endpoints visible in the scroll region.
  await page.setViewportSize({ width: 1280, height: 1200 });
  await manage();
  await page
    .getByRole('button', { name: label('folders.new'), exact: true })
    .click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await dialog
    .getByLabel(label('folders.name'), { exact: true })
    .fill('Archive draft');
  await dialog
    .getByRole('button', { name: label('folders.confirm.create'), exact: true })
    .click();
  await expect(dialog).toBeHidden();
  const archive = (await client.getInventoryOrganization({})).folders.find(
    (entry) => entry.displayName === 'Archive draft',
  )!.folderId;
  await activateAction(folderHeader(archive), label('inventory.rename'));
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(label('folders.name')).fill('Archive');
  await dialog
    .getByRole('button', { name: label('folders.confirm.rename'), exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await activateAction(folderHeader(archive), label('folders.newChild'));
  dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', {
      name: label('folders.newChild'),
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await dialog.getByLabel(label('folders.name')).fill('Archive child');
  await screenshot('create-subfolder-fixed-parent');
  await dialog
    .getByRole('button', { name: label('folders.confirm.create'), exact: true })
    .click();
  await expect(dialog).toBeHidden();
  assert.equal(
    (await client.getInventoryOrganization({})).folders.find(
      (entry) => entry.displayName === 'Archive child',
    )?.parentFolderId,
    archive,
    'Child creation uses the clicked parent without destination selection',
  );
  for (const id of [
    seed.folders.endings,
    seed.folders.independent,
    seed.folders.loss,
    seed.folders.empty,
  ]) {
    const expander = folderHeader(id).locator(
      'button[aria-expanded="true"]:not([aria-haspopup])',
    );
    if (await expander.count()) await expander.click();
  }
  const selfDropHeader = folderHeader(archive);
  await selfDropHeader.evaluate((element) => {
    element.addEventListener(
      'drop',
      () => element.setAttribute('data-self-drop-observed', 'true'),
      { once: true },
    );
  });
  const beforeSelfDrop = await client.getInventoryOrganization({});
  const organizationWrites: string[] = [];
  const observeWrite = (request: Request) => {
    if (
      request.method() === 'POST' &&
      request.url().includes('/inventory/organization')
    )
      organizationWrites.push(request.url());
  };
  page.on('request', observeWrite);
  try {
    await selfDropHeader
      .locator('button[draggable="true"]')
      .dragTo(selfDropHeader, { targetPosition: { x: 30, y: 15 } });
    await expect(selfDropHeader).toHaveAttribute(
      'data-self-drop-observed',
      'true',
    );
    assert.deepEqual(
      organizationWrites,
      [],
      'Self-drop sends no write command',
    );
    assert.deepEqual(
      await client.getInventoryOrganization({}),
      beforeSelfDrop,
      'Self-drop preserves the complete organization and data revision',
    );
    await expect(page.getByRole('alert')).toHaveCount(0);
    await screenshot('folder-self-drop-no-op');
  } finally {
    page.off('request', observeWrite);
  }
  await folderHeader(seed.folders.branches)
    .locator('button[draggable="true"]')
    .dragTo(folderHeader(archive), { targetPosition: { x: 30, y: 15 } });
  await expect
    .poll(
      async () =>
        (await client.getInventoryOrganization({})).folders.find(
          (entry) => entry.folderId === seed!.folders.branches,
        )?.parentFolderId,
    )
    .toBe(archive);
  await folderHeader(seed.folders.branches)
    .locator('button[draggable="true"]')
    .dragTo(folderHeader(seed.folders.openings), {
      targetPosition: { x: 30, y: 15 },
    });
  await expect
    .poll(
      async () =>
        (await client.getInventoryOrganization({})).folders.find(
          (entry) => entry.folderId === seed!.folders.branches,
        )?.parentFolderId,
    )
    .toBe(seed.folders.openings);
  const pair = seed.families[1]!;
  const independentExpander = folderHeader(seed.folders.independent).locator(
    'button[aria-expanded="false"]:not([aria-haspopup])',
  );
  if (await independentExpander.count()) await independentExpander.click();
  for (const id of [pair.root.itemId, pair.child.itemId]) {
    const entry = await item(id);
    await page
      .getByRole('checkbox', {
        name: label('folders.selectItem').replace('{name}', entry.displayName),
        exact: true,
      })
      .check();
  }
  const before = (await client.getInventoryOrganization({})).dataRevision;
  await itemRow(
    seed.folders.independent,
    (await item(pair.root.itemId)).displayName,
  ).dragTo(folderHeader(archive), { targetPosition: { x: 30, y: 15 } });
  await expect
    .poll(async () => (await item(pair.root.itemId)).folderId)
    .toBe(archive);
  assert.equal(
    (await client.getInventoryOrganization({})).dataRevision,
    before + 1,
    'Multi-selection is one atomic command',
  );
  for (const id of [pair.root.itemId, pair.child.itemId])
    assert.equal((await item(id)).folderId, archive);
  for (const id of [pair.root.itemId, pair.child.itemId]) {
    const entry = await item(id);
    await page
      .getByRole('checkbox', {
        name: label('folders.selectItem').replace('{name}', entry.displayName),
        exact: true,
      })
      .uncheck();
  }
  const dragged = group(archive)
    .locator('li[draggable="true"]')
    .filter({ hasText: (await item(pair.child.itemId)).displayName });
  await dragged.dragTo(folderHeader(seed.folders.independent), {
    targetPosition: { x: 30, y: 15 },
  });
  await expect
    .poll(async () => (await item(pair.child.itemId)).folderId)
    .toBe(seed.folders.independent);
  assert.equal((await item(pair.root.itemId)).folderId, archive);
  await page
    .getByRole('radio', { name: label('folders.origins'), exact: true })
    .press('Space');
  await expect(
    page.getByText('Opening root', { exact: true }).first(),
  ).toBeVisible();
  const originTitle = page.getByRole('button').filter({
    has: page.getByText('Opening root', { exact: true }),
  });
  const originActions = originTitle.locator('..').getByRole('group');
  for (const width of [1280, 1800]) {
    await page.setViewportSize({ width, height: 900 });
    const titleBounds = await originTitle.boundingBox();
    const actionBounds = await originActions.boundingBox();
    assert.ok(titleBounds && actionBounds);
    assert.ok(actionBounds.x >= titleBounds.x + titleBounds.width - 1);
    assert.ok(titleBounds.width > actionBounds.width);
    await originTitle.focus();
    await page.keyboard.press('Tab');
    await expect(originActions.locator('button:visible').first()).toBeFocused();
  }
  await screenshot('origins-de-wide');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page
    .getByRole('radio', { name: label('folders.view'), exact: true })
    .press('Space');
  return archive;
}

async function lossUi() {
  assert.ok(seed && page);
  const { loss } = seed.folders;
  const alphaBefore = await client.previewContextFolderRemoval({
    folderId: loss,
    contextId: seed.alpha,
  });
  const betaBefore = await client.previewContextFolderRemoval({
    folderId: loss,
    contextId: seed.beta,
  });
  assert.ok(
    alphaBefore.loss.activeNoteCount > 0 && alphaBefore.loss.scratchCount > 0,
  );
  await manage(seed.alpha);
  await expect(folderHeader(loss).locator('svg.lucide-minus')).toHaveCount(1);
  await expect(folderHeader(loss).locator('svg.lucide-trash')).toHaveCount(0);
  const memberRow = itemRow(
    loss,
    (await item(seed.families[0]!.child.itemId)).displayName,
  );
  await expect(memberRow.locator('svg.lucide-minus')).toHaveCount(1);
  await expect(memberRow.locator('svg.lucide-trash')).toHaveCount(1);
  await screenshot('context-minus-inventory-trash');
  await manage(seed.alpha, true);
  await expect(folderHeader(loss).locator('svg.lucide-minus')).toHaveCount(1);
  await expect(folderHeader(loss).locator('svg.lucide-plus')).toHaveCount(0);
  await expect(folderHeader(loss).locator('svg.lucide-trash')).toHaveCount(1);
  await screenshot('all-inventory-context-minus');
  await activateAction(folderHeader(loss), label('folders.removeContext'));
  let dialog = page.getByRole('dialog');
  await expect(
    dialog.getByText(label('loss.notes'), { exact: true }),
  ).toBeVisible();
  await screenshot('context-loss-warning');
  await dialog
    .getByRole('button', { name: label('action.cancel'), exact: true })
    .last()
    .click();
  await expect(dialog).toBeHidden();
  assert.deepEqual(
    (
      await client.previewContextFolderRemoval({
        folderId: loss,
        contextId: seed.alpha,
      })
    ).losses,
    alphaBefore.losses,
  );
  await activateAction(folderHeader(loss), label('folders.removeContext'));
  dialog = page.getByRole('dialog');
  await dialog
    .getByRole('button', { name: label('folders.confirm.remove'), exact: true })
    .click();
  await expect(dialog).toBeHidden();
  const removed = await client.previewContextFolderRemoval({
    folderId: loss,
    contextId: seed.alpha,
  });
  assert.equal(removed.loss.activeNoteCount, 0);
  assert.equal(removed.loss.scratchCount, 0);
  await manage(seed.alpha, true);
  await expect(folderHeader(loss).locator('svg.lucide-plus')).toHaveCount(1);
  await activateAction(folderHeader(loss), label('folders.include'));
  await page
    .getByRole('dialog')
    .getByRole('button', {
      name: label('folders.confirm.include'),
      exact: true,
    })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();
  const restored = await client.previewContextFolderRemoval({
    folderId: loss,
    contextId: seed.alpha,
  });
  assert.equal(
    restored.loss.activeNoteCount,
    0,
    'Re-inclusion must not restore deleted notes',
  );
  assert.equal(restored.loss.scratchCount, 0);
  assert.ok(restored.itemIds.includes(seed.families[0]!.child.itemId));
  await expect(folderHeader(loss).locator('svg.lucide-minus')).toHaveCount(1);
  await expect(folderHeader(loss).locator('svg.lucide-plus')).toHaveCount(0);
  assert.deepEqual(
    (
      await client.previewContextFolderRemoval({
        folderId: loss,
        contextId: seed.beta,
      })
    ).losses,
    betaBefore.losses,
  );
  const betaWork = await workspace({ kind: 'context', contextId: seed.beta });
  await manage();
  await activateAction(folderHeader(loss), label('folders.delete'));
  await page
    .getByRole('dialog')
    .getByRole('button', { name: label('folders.confirm.delete'), exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();
  assert.equal(
    (await item(seed.families[0]!.child.itemId)).folderId,
    undefined,
  );
  assert.ok(
    (await item(seed.families[0]!.child.itemId)).contextIds.includes(seed.beta),
  );
  const after = await workspace({ kind: 'context', contextId: seed.beta });
  assert.deepEqual(after.scratch, betaWork.scratch);
  const usage = await client.previewContextItemRemoval(
    seed.beta,
    seed.families[0]!.child.itemId,
  );
  assert.deepEqual(usage.losses.notes, betaBefore.losses.notes);
}

async function folderMembershipAnalysisUi() {
  assert.ok(seed && page);
  membershipContextId = (
    await client.createWorkingContext({ displayName: 'Folder-only membership' })
  ).context.contextId;
  await change({
    kind: 'include_folder',
    folderId: seed.folders.openings,
    contextId: membershipContextId,
    includeItems: true,
  });
  const context = await client.getWorkingContextWorkspace(membershipContextId);
  assert.deepEqual(
    context.references,
    [],
    'Folder membership does not manufacture anchor references',
  );
  assert.equal(context.context.referenceCount, 0);
  assert.equal(context.context.itemCount, context.members.length);
  assert.ok(context.context.itemCount > 0);
  const root = await item(seed.families[0]!.root.itemId);
  assert.ok(root.contextIds.includes(membershipContextId));
  const member = context.members.find((entry) => entry.itemId === root.itemId);
  assert.ok(member, 'Folder-only membership is exposed canonically');
  assert.equal(member.currentRevisionId, root.currentRevisionId);
  assert.equal(member.displayName, root.displayName);
  await manage(membershipContextId);
  const countLabel = `${context.context.itemCount} Einträge`;
  await expect(
    page
      .getByRole('button', { name: /^Folder-only membership/ })
      .getByText(countLabel, { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator('aside[aria-labelledby="inspector-title"]')
      .getByText(countLabel, { exact: true }),
  ).toBeVisible();
  const row = itemRow(seed.folders.openings, root.displayName);
  await row
    .getByRole('button', { name: new RegExp('^' + root.displayName) })
    .click();
  if (engineAvailable) {
    const [response] = await Promise.all([
      page.waitForResponse(
        (response) => {
          if (
            !response.url().endsWith('/analysis/position') ||
            response.request().method() !== 'POST'
          )
            return false;
          const body = response.request().postDataJSON() as {
            work?: {
              scope?: { contextId?: string };
              subject?: { itemId?: string };
            };
          };
          return (
            body.work?.scope?.contextId === membershipContextId &&
            body.work?.subject?.itemId === root.itemId
          );
        },
        { timeout: 30_000 },
      ),
      activateAction(row, label('activity.analyze')),
    ]);
    assert.equal(
      response.status(),
      200,
      'Folder-only context member can request real engine analysis',
    );
    const snapshot = (await response.json()) as { kind: string };
    assert.equal(snapshot.kind, 'objective');
    await writeFile(
      path.join(artifacts, 'folder-only-membership-analysis.json'),
      JSON.stringify(
        {
          contextId: membershipContextId,
          itemId: root.itemId,
          anchorReferencesBeforeOpening: context.references,
          status: response.status(),
          snapshot,
        },
        null,
        2,
      ),
    );
  } else {
    await activateAction(row, label('activity.analyze'));
    limits.push(
      'Folder-only membership opens in the real UI, but engine analysis is unverified without Stockfish.',
    );
  }
  await expect(
    page.getByRole('grid', { name: /Schachbrett|Chess board/, exact: true }),
  ).toBeVisible();
  await screenshot('folder-only-context-analysis');
}

async function rootSaveUi(folderId: string) {
  assert.ok(seed && page);
  await manage();
  await folderHeader(folderId)
    .getByRole('button', { name: /^Archive/ })
    .click();
  await page
    .getByRole('button', { name: label('manage.newAnalysis'), exact: true })
    .click();
  const board = page.getByRole('grid', {
    name: /Schachbrett|Chess board/,
    exact: true,
  });
  await expect(board).toBeVisible();
  assert.equal(await board.getByRole('gridcell').count(), 64);
  const toggle = page.locator('[aria-controls="analysis-actions-details"]');
  if ((await toggle.getAttribute('aria-expanded')) === 'false')
    await toggle.click();
  await page
    .getByRole('button', {
      name: /Als eigene Analyse speichern|Save as.*analysis/,
    })
    .click();
  const title = page.getByLabel(/^(Titel|Title)$/);
  await title.fill('Opening root');
  await expect(
    page.getByRole('button', {
      name: label('name.useSuggestion'),
      exact: true,
    }),
  ).toBeVisible();
  const before = (await workspace()).scratch;
  assert.ok(before);
  await page
    .getByRole('button', { name: /^(Analyse speichern|Save analysis)$/ })
    .click();
  await expect(title).toHaveValue('Opening root');
  assert.deepEqual(
    (await workspace()).scratch,
    before,
    'Name conflict retains the draft',
  );
  await page
    .getByRole('button', { name: label('name.useSuggestion'), exact: true })
    .click();
  await expect(title).not.toHaveValue('Opening root');
  await expect(
    page.getByRole('combobox', {
      name: new RegExp('^' + label('folders.saveDestination')),
    }),
  ).toHaveValue(folderId);
  const chosen = await title.inputValue();
  await page
    .getByRole('button', { name: /^(Analyse speichern|Save analysis)$/ })
    .click();
  await expect
    .poll(async () =>
      (await inventory()).items.some((entry) => entry.displayName === chosen),
    )
    .toBe(true);
  const saved = (await inventory()).items.find(
    (entry) => entry.displayName === chosen,
  )!;
  assert.equal(saved.folderId, folderId);
  const record = await client.getInventoryRevision(
    saved.itemId,
    saved.currentRevisionId,
    { scopeKind: 'free' },
  );
  assert.equal(
    record.steps.length,
    0,
    'Root-only save is a real zero-move analysis',
  );
  await screenshot('root-only-save-de-wide');
}

async function rowActionsUi() {
  assert.ok(seed && page);
  await manage();
  const entry = await item(seed.families[1]!.root.itemId);
  assert.ok(entry.folderId);
  const row = itemRow(entry.folderId, entry.displayName);
  const actions = row.getByRole('group');
  const inspector = page.locator('aside[aria-labelledby="inspector-title"]');
  await row
    .getByRole('button', { name: new RegExp('^' + entry.displayName) })
    .click();
  await expect(
    inspector.getByText(entry.displayName, { exact: true }),
  ).toBeVisible();
  for (const key of ['inventory.rename', 'manage.deleteInventoryItem'])
    await expect(
      inspector.getByRole('button', { name: label(key), exact: true }),
    ).toHaveCount(0);

  await page.setViewportSize({ width: 1800, height: 900 });
  const direct = actions.getByRole('button', {
    name: label('inventory.rename'),
    exact: true,
  });
  const trigger = actions.locator('button[aria-haspopup]');
  await expect(direct).toBeVisible();
  await expect(trigger).toBeHidden();
  const panel = page
    .locator('section')
    .filter({ has: page.locator('#inventory-search') });
  const box = await panel.boundingBox();
  assert.ok(box);
  const breakpointViewport = Math.round(1800 - box.width + 640);
  assert.ok(
    breakpointViewport > 1182,
    'Test breakpoint is within the three-column layout',
  );
  await direct.focus();
  await page.setViewportSize({ width: breakpointViewport - 1, height: 900 });
  await expect(direct).toBeHidden();
  await expect(trigger).toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  const menu = page.getByRole('menu');
  const menuNames = await menu.getByRole('menuitem').allTextContents();
  assert.deepEqual(
    menuNames.map((name) => name.trim()),
    [
      label('activity.analyze'),
      label('inventory.rename'),
      label('manage.deleteInventoryItem'),
    ],
  );
  await screenshot('row-menu-breakpoint');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  await page.setViewportSize({ width: breakpointViewport + 1, height: 900 });
  await expect(menu).toBeHidden();
  await expect(
    actions.getByRole('button', {
      name: label('activity.analyze'),
      exact: true,
    }),
  ).toBeFocused();
  await expect(trigger).toBeHidden();

  await activateAction(row, label('inventory.rename'), true);
  let dialog = page.getByRole('dialog');
  await dialog
    .getByLabel(label('inventory.displayName'), { exact: true })
    .fill('Unsaved row rename');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  assert.equal((await item(entry.itemId)).displayName, entry.displayName);
  await activateAction(row, label('inventory.rename'));
  dialog = page.getByRole('dialog');
  await expect(
    dialog.getByLabel(label('inventory.displayName'), { exact: true }),
  ).toHaveValue(entry.displayName);
  await dialog
    .getByLabel(label('inventory.displayName'), { exact: true })
    .fill('Opening root');
  await dialog
    .getByRole('button', { name: label('inventory.saveRevision'), exact: true })
    .click();
  await expect(dialog.getByRole('alert')).toHaveText(
    label('error.inventoryNameConflict'),
  );
  await screenshot('row-rename-conflict');
  assert.equal((await item(entry.itemId)).displayName, entry.displayName);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await activateAction(row, label('inventory.rename'));
  dialog = page.getByRole('dialog');
  await dialog
    .getByLabel(label('inventory.summary'), { exact: true })
    .fill('Row-action acceptance');
  await expect(
    dialog.getByRole('button', {
      name: label('inventory.saveRevision'),
      exact: true,
    }),
  ).toBeEnabled();
  await screenshot('row-rename-form');
  await dialog
    .getByRole('button', { name: label('inventory.saveRevision'), exact: true })
    .click();
  await expect(dialog).toBeHidden();
  assert.equal((await item(entry.itemId)).summary, 'Row-action acceptance');

  await folderHeader(entry.folderId)
    .getByRole('button', { name: /^Archive/ })
    .click();
  await expect(
    inspector.getByText(label('folders.path'), { exact: true }),
  ).toBeVisible();
  await expect(inspector.getByRole('grid')).toHaveCount(0);
  await row
    .getByRole('button', { name: new RegExp('^' + entry.displayName) })
    .click();
  await expect(
    inspector.getByText(label('folders.path'), { exact: true }),
  ).toHaveCount(0);
  await screenshot('row-actions-wide-inspector');

  await page.setViewportSize({ width: 390, height: 900 });
  const checkbox = row.getByRole('checkbox');
  await checkbox.check();
  const selection = page.getByRole('group', {
    name: label('manage.selectionActions'),
    exact: true,
  });
  await selection.locator('button[aria-haspopup]').click();
  assert.equal(
    await page.getByRole('menuitem').count(),
    1,
    'Bulk selection only offers Clear; movement uses drag-and-drop',
  );
  await page
    .getByRole('menuitem', {
      name: label('manage.clearSelection'),
      exact: true,
    })
    .click();
  await expect(checkbox).not.toBeChecked();
  await expect(selection).toHaveCount(0);

  await manage(seed.alpha, true);
  const foreign = itemRow(entry.folderId, entry.displayName);
  await foreign.locator('button[aria-haspopup]').click();
  await expect(
    page.getByRole('menuitem', {
      name: label('activity.analyze'),
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('menuitem', {
      name: label('inventory.rename'),
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('menuitem', {
      name: label('manage.useInContext'),
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 900 });
  await manage(seed.alpha);
  const member = await item(seed.families[0]!.root.itemId);
  const scratchBefore = (
    await workspace({ kind: 'context', contextId: seed.alpha })
  ).scratch;
  await activateAction(
    itemRow(seed.folders.openings, member.displayName),
    label('activity.analyze'),
  );
  dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('button', {
      name: label('manage.continueAnalysisDraft'),
      exact: true,
    }),
  ).toBeVisible();
  await screenshot('row-open-scratch-decision');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  assert.deepEqual(
    (await workspace({ kind: 'context', contextId: seed.alpha })).scratch,
    scratchBefore,
  );
  const contextRow = page
    .getByRole('button', { name: /^Context Alpha/ })
    .locator('..');
  await activateAction(contextRow, label('manage.editContext'), true);
  dialog = page.getByRole('dialog');
  await dialog
    .getByLabel(label('manage.contextPurpose'), { exact: true })
    .fill('Unsaved context purpose');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  assert.notEqual(
    (await client.getWorkingContextWorkspace(seed.alpha)).context.purpose,
    'Unsaved context purpose',
  );
  await manage();
}

async function revisionDialogUi() {
  assert.ok(seed && page);
  await page.setViewportSize({ width: 1280, height: 900 });
  let scratch = await update(free, {
    kind: 'start',
    origin: { kind: 'initial_position' },
  });
  scratch = await update(
    free,
    { kind: 'apply_move', move: { kind: 'coordinates', value: 'e2e4' } },
    scratch,
  );
  const record = await save(
    scratch,
    'Revision dialog acceptance',
    seed.folders.openings,
  );
  const contextId = (
    await client.createWorkingContext({
      displayName: 'Revision dialog context',
    })
  ).context.contextId;
  const revision = await client.getInventoryRevision(
    record.itemId,
    record.revisionId,
    { scopeKind: 'free' },
  );
  await client.addContextReference(contextId, {
    itemId: record.itemId,
    anchorId: revision.steps[0]!.anchorId,
  });
  const followingContextId = (
    await client.createWorkingContext({
      displayName: 'Revision dialog following context',
    })
  ).context.contextId;
  await client.addContextReference(followingContextId, {
    itemId: record.itemId,
    anchorId: record.rootAnchorId,
  });
  await client.createPositionNote({
    scope: { kind: 'context', contextId },
    itemId: record.itemId,
    revisionId: record.revisionId,
    anchorId: revision.steps[0]!.anchorId,
    body: 'Context work on the previous continuation',
    languageTag: 'en-GB',
    noteScope: { kind: 'context', contextId },
  });
  const losslessContexts: string[] = [];
  for (const name of [
    'Use new revision without loss',
    'Remove revision without loss',
  ]) {
    const id = (await client.createWorkingContext({ displayName: name }))
      .context.contextId;
    await client.addContextReference(id, {
      itemId: record.itemId,
      anchorId: revision.steps[0]!.anchorId,
    });
    losslessContexts.push(id);
  }
  const started = await client.startInventoryRevision(record.itemId, {
    scope: free,
    baseRevisionId: record.revisionId,
    anchorId: revision.steps[0]!.anchorId,
    mode: 'replace_move',
    firstMove: { kind: 'coordinates', value: 'd2d4' },
    expectedScratchId: null,
    expectedScratchRevision: null,
  });
  const preview = await client.previewInventoryRevision({
    scope: free,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
  });
  await client.saveInventoryRevision({
    scope: free,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
    previewFingerprint: preview.previewFingerprint,
  });
  assert.equal(
    (await client.getWorkingContextWorkspace(contextId)).pendingRevisionImpacts
      .length,
    1,
  );
  await manage(contextId);
  await activateAction(
    itemRow(seed.folders.openings, 'Revision dialog acceptance'),
    label('revisionImpact.review'),
  );
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('button', {
      name: label('revisionImpact.useTargetAction'),
      exact: true,
    })
    .click();
  await dialog
    .getByRole('button', { name: label('revisionImpact.confirm'), exact: true })
    .click();
  await expect(dialog).toBeHidden();
  assert.deepEqual(
    (await client.getWorkingContextWorkspace(contextId)).pendingRevisionImpacts,
    [],
  );
  await screenshot('row-revision-resolved');
  for (const [index, id] of losslessContexts.entries()) {
    await manage(id);
    await activateAction(
      itemRow(seed.folders.openings, 'Revision dialog acceptance'),
      label('revisionImpact.review'),
    );
    const review = page.getByRole('dialog');
    await review
      .getByRole('button', {
        name: label(
          index === 0
            ? 'revisionImpact.useTargetAction'
            : 'revisionImpact.removeAction',
        ),
        exact: true,
      })
      .click();
    await expect(review).toBeHidden();
    assert.equal(
      (await client.getWorkingContextWorkspace(id)).pendingRevisionImpacts
        .length,
      0,
    );
  }
  await manage();
}

async function lossFreeUi() {
  assert.ok(seed && page);
  await page.setViewportSize({ width: 1800, height: 900 });
  const contextId = (
    await client.createWorkingContext({ displayName: 'Loss-free actions' })
  ).context.contextId;
  const parent = await folder('Empty confirmation tree');
  const child = await folder('Empty confirmation leaf', parent);
  const leaf = await folder('Disposable empty folder');
  await manage();
  await activateAction(folderHeader(leaf), label('folders.delete'));
  await expect
    .poll(async () =>
      (await client.getInventoryOrganization({})).folders.some(
        (entry) => entry.folderId === leaf,
      ),
    )
    .toBe(false);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await manage(contextId, true);
  await activateAction(folderHeader(parent), label('folders.include'));
  await expect
    .poll(async () =>
      (
        await client.getInventoryOrganization({ contextId })
      ).linkedFolderIds.includes(child),
    )
    .toBe(true);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await manage();
  await activateAction(folderHeader(child), label('folders.delete'));
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await manage(contextId, true);
  await activateAction(folderHeader(parent), label('folders.removeContext'));
  await expect
    .poll(
      async () =>
        (await client.getInventoryOrganization({ contextId })).linkedFolderIds
          .length,
    )
    .toBe(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const entry = await item(seed.families[1]!.root.itemId);
  await client.addContextReference(contextId, {
    itemId: entry.itemId,
    anchorId: entry.rootAnchorId,
  });
  await manage(contextId);
  await activateAction(
    itemRow(entry.folderId!, entry.displayName),
    label('manage.removeFromContext'),
  );
  await expect
    .poll(
      async () =>
        (await client.getWorkingContextWorkspace(contextId)).members.length,
    )
    .toBe(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.equal((await item(entry.itemId)).lifecycle, 'active');

  await client.addContextReference(contextId, {
    itemId: entry.itemId,
    anchorId: entry.rootAnchorId,
  });
  await client.createPositionNote({
    scope: { kind: 'context', contextId },
    itemId: entry.itemId,
    revisionId: entry.currentRevisionId,
    anchorId: entry.rootAnchorId,
    body: 'Keep my contextual note',
    languageTag: 'en-GB',
    noteScope: { kind: 'context', contextId },
  });
  await manage(contextId);
  await activateAction(
    itemRow(entry.folderId!, entry.displayName),
    label('manage.removeFromContext'),
  );
  let dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(
    dialog
      .locator('dt')
      .filter({ hasText: label('loss.notes') })
      .locator('..')
      .locator('dd'),
  ).toHaveText('1');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  assert.equal(
    (await client.previewContextItemRemoval(contextId, entry.itemId)).losses
      .notes.length,
    1,
  );

  await manage();
  await page
    .getByRole('button', { name: label('manage.newAnalysis'), exact: true })
    .click();
  await expect(
    page.getByRole('grid', { name: /Schachbrett|Chess board/, exact: true }),
  ).toBeVisible();
  const empty = (await workspace()).scratch!;
  assert.equal((await workspace()).scratchHasChanges, false);
  await manage();
  await page
    .getByRole('button', { name: label('manage.newAnalysis'), exact: true })
    .click();
  await expect
    .poll(async () => (await workspace()).scratch?.scratchId)
    .not.toBe(empty.scratchId);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await manage();
  await activateAction(
    itemRow(entry.folderId!, entry.displayName),
    label('activity.analyze'),
  );
  await expect
    .poll(async () => (await workspace()).record?.itemId)
    .toBe(entry.itemId);
  assert.equal((await workspace()).scratch, undefined);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const custom = await update(free, {
    kind: 'start',
    origin: { kind: 'fen', fen: '8/4k3/8/4K3/4P3/8/8/8 w - - 0 1' },
  });
  await manage();
  await page
    .getByRole('button', { name: label('manage.newAnalysis'), exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await screenshot('custom-root-still-protected');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  assert.deepEqual((await workspace()).scratch, custom);
  await activateAction(
    itemRow(entry.folderId!, entry.displayName),
    label('inventory.rename'),
  );
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toHaveText(
    label('manage.renameScratchOccupied'),
  );
  await expect(
    dialog.getByRole('button', {
      name: label('inventory.saveRevision'),
      exact: true,
    }),
  ).toBeDisabled();
  await screenshot('rename-preserves-unsaved-analysis');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  assert.deepEqual((await workspace()).scratch, custom);
  await client.updateAnalysisScratch({
    scope: free,
    expectedScratchId: custom.scratchId,
    expectedScratchRevision: custom.scratchRevision,
    action: { kind: 'discard' },
  });
  await manage();
}

async function responsiveUi() {
  assert.ok(page && seed && membershipContextId);
  let deepFolder = seed.folders.openings;
  for (let depth = 1; depth <= 4; depth++)
    deepFolder = await folder(
      'Long folder name for responsive acceptance level ' + depth,
      deepFolder,
    );
  let deepScratch = await update(free, {
    kind: 'start',
    origin: {
      kind: 'inventory_anchor',
      itemId: seed.families[0]!.root.itemId,
      revisionId: seed.families[0]!.root.revisionId,
      anchorId: seed.families[0]!.root.rootAnchorId,
    },
  });
  deepScratch = await update(
    free,
    { kind: 'apply_move', move: { kind: 'coordinates', value: 'e2e4' } },
    deepScratch,
  );
  const longName = 'Opening continuation ' + 'abcdefghijklmnopqrst'.repeat(6);
  await save(deepScratch, longName, deepFolder);
  await change({
    kind: 'include_folder',
    folderId: deepFolder,
    contextId: membershipContextId,
    includeItems: true,
  });
  for (const language of ['de-DE', 'en-GB'] as const) {
    const preferences = await client.getUserPreferences();
    await client.setUiLanguage({
      uiLocale: language,
      expectedRevision: preferences.preferenceRevision,
    });
    locale = language;
    await expect(
      page
        .getByRole('navigation', { name: 'Plysmith' })
        .getByRole('button', { name: label('activity.manage'), exact: true }),
    ).toBeVisible();
    for (const contextId of [undefined, membershipContextId]) {
      await manage(contextId);
      for (const width of [1800, 1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page
          .locator('section[data-folder-id]')
          .first()
          .locator(':scope > div')
          .first()
          .scrollIntoViewIfNeeded();
        await screenshot(
          (contextId === undefined ? 'folders-' : 'context-folders-') +
            language +
            '-' +
            width,
        );
        await group(deepFolder).scrollIntoViewIfNeeded();
        await itemRow(deepFolder, longName)
          .getByRole('button', { name: new RegExp('^' + longName) })
          .click();
        await screenshot(
          (contextId === undefined
            ? 'deep-folders-'
            : 'deep-context-folders-') +
            language +
            '-' +
            width,
        );
      }
    }
  }
}

async function presentationUi() {
  assert.ok(page && seed);
  const preferences = await client.getUserPreferences();
  await client.setUiLanguage({
    uiLocale: 'de-DE',
    expectedRevision: preferences.preferenceRevision,
  });
  locale = 'de-DE';
  await page.setViewportSize({ width: 1280, height: 900 });
  await manage();
  const before = await client.getWorkScopeWorkspace({ scopeKind: 'free' });
  const origins = page.getByRole('radio', {
    name: label('folders.origins'),
    exact: true,
  });
  await expect(origins).toBeEnabled();
  await origins.locator('xpath=ancestor::label').click();
  await expect(
    page.getByRole('radio', { name: label('folders.origins'), exact: true }),
  ).toBeChecked();
  const after = await client.getWorkScopeWorkspace({ scopeKind: 'free' });
  assert.equal(after.managementResume?.presentation, 'origins');
  assert.equal(
    after.managementResume?.selectedItemId,
    before.managementResume?.selectedItemId,
  );
  assert.equal(
    after.managementResume?.selectedAnchorId,
    before.managementResume?.selectedAnchorId,
  );
  assert.deepEqual(after.analysisResume, before.analysisResume);
  await page
    .getByRole('button', { name: label('activity.settings'), exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: label('settings.title'), exact: true }),
  ).toBeVisible();
  await manage(undefined, false, 'origins');
  await manage(seed.alpha);
  await manage(seed.beta);
  await expect(origins).toBeEnabled();
  await origins.locator('xpath=ancestor::label').click();
  await expect(
    page.getByRole('radio', { name: label('folders.origins'), exact: true }),
  ).toBeChecked();
  await manage(seed.alpha);
  await manage(undefined, false, 'origins');
  await manage(seed.beta, false, 'origins');
  await screenshot('remembered-origins-before-restart');
}

async function durableSnapshot() {
  assert.ok(seed);
  return {
    organization: await client.getInventoryOrganization({}),
    alpha: await client.getInventoryOrganization({ contextId: seed.alpha }),
    beta: await client.getInventoryOrganization({ contextId: seed.beta }),
    inventory: await inventory(),
    freeWorkspace: await client.getWorkScopeWorkspace({ scopeKind: 'free' }),
    alphaWork: await workspace({ kind: 'context', contextId: seed.alpha }),
    betaWork: await workspace({ kind: 'context', contextId: seed.beta }),
    folderOnlyContext:
      membershipContextId === undefined
        ? undefined
        : await client.getWorkingContextWorkspace(membershipContextId),
    folderOnlyWork:
      membershipContextId === undefined
        ? undefined
        : await workspace({ kind: 'context', contextId: membershipContextId }),
  };
}

try {
  await step('isolated-host-and-engine-configuration', async () => {
    await startHost();
    await configureEngine();
  });
  await step('three-real-families-and-context-snapshots', async () => {
    seed = await seedFamilies();
  });
  await step(
    'cycles-sibling-names-membership-and-stale-writes',
    rejectedWrites,
  );
  if (!apiOnly) {
    await step('real-desktop-folder-gestures', async () => {
      await launchDesktop();
      const archive = await basicUi();
      await rootSaveUi(archive);
    });
    await step(
      'folder-only-membership-real-position-analysis',
      folderMembershipAnalysisUi,
    );
    await step(
      'adaptive-row-actions-dialogs-focus-and-permissions',
      rowActionsUi,
    );
    await step('revision-dialog-confirmed-close', revisionDialogUi);
    await step(
      'context-removal-abort-confirm-reinclude-and-global-delete',
      lossUi,
    );
    await step('loss-free-actions-and-protected-custom-roots', lossFreeUi);
    await step('DE-EN-wide-mobile-views', responsiveUi);
    await step('scope-specific-presentation-and-area-return', presentationUi);
  } else {
    limits.push(
      'API-only run: no Electron, drag gestures, save UI, loss dialogs, screenshots or Axe checks.',
    );
  }
  await step('restart-durability', async () => {
    await closeDesktop();
    const before = await durableSnapshot();
    await writeFile(
      path.join(artifacts, 'before-restart.json'),
      JSON.stringify(before, null, 2),
    );
    await restart();
    const after = await durableSnapshot();
    await writeFile(
      path.join(artifacts, 'after-restart.json'),
      JSON.stringify(after, null, 2),
    );
    assert.deepEqual(
      after,
      before,
      'Hierarchy, membership, links, notes and drafts survive restart',
    );
    if (!apiOnly) {
      await launchDesktop();
      await expect(
        page!.getByRole('radio', {
          name: label('folders.origins'),
          exact: true,
        }),
      ).toBeChecked();
      await manage(seed!.beta, false, 'origins');
      await screenshot('restart-context-work');
      await manage(undefined, false, 'origins');
      await manage(seed!.alpha);
      await screenshot('restart-independent-folder-view');
    }
  });
  if (!apiOnly)
    await step('accessibility-and-renderer-errors', async () => {
      assert.deepEqual(accessibilityFindings, [], 'All screenshots pass Axe');
      assert.deepEqual(errors, [], 'No renderer exceptions');
    });
} catch {
  failed = true;
  process.exitCode = 1;
} finally {
  try {
    await closeDesktop();
  } catch (error) {
    errors.push(String(error));
    failed = true;
  }
  try {
    await closeHost();
  } catch (error) {
    errors.push(String(error));
    failed = true;
  }
  if (failed) process.exitCode = 1;
  await persistProof();
  console.log(
    (failed ? 'FAILED: ' : 'COMPLETE: ') + path.join(artifacts, 'proof.json'),
  );
}
