// Opt-in after the desktop build: node tools/verify-import-runtime.ts <annotated.pgn> [other.pgn ...].
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  _electron as electron,
  expect,
  type Page,
  type Locator,
} from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import {
  composeHost,
  type ComposedHost,
} from '../app/bootstrap/host/composition-root.ts';
import { publishHostDiscovery } from '../app/infrastructure/adapters/platform/windows/index.ts';
import {
  connectHost,
  type PlysmithHostClient,
  type AnalysisRecordDto,
} from '../app/infrastructure/channels/host_client/index.ts';
import { messages } from '../app/infrastructure/channels/ui/renderer/messages.ts';
import { importMessages } from '../app/infrastructure/channels/ui/renderer/import-messages.ts';
import type { ChessTreeCandidate } from '../app/domain/inventory/chess-tree-candidate.ts';
import { ChessJsRulesAdapter } from '../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { PgnContentFormatAdapter } from '../app/infrastructure/adapters/content/pgn/index.ts';
import Database from 'better-sqlite3';

const repo = await realpath(process.cwd());
const inputPath = process.argv[2] ?? process.env.PLYSMITH_IMPORT_PGN;
assert.ok(inputPath, 'Set PLYSMITH_IMPORT_PGN or pass local PGN files.');
const packagePath = await realpath(path.resolve(inputPath));
const additionalPaths = await Promise.all(
  process.argv.slice(3).map((file) => realpath(path.resolve(file))),
);
assert.ok((await stat(packagePath)).isFile(), 'The PGN input must be a file.');
function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith('..' + path.sep))
  );
}
assert.ok(
  !inside(repo, packagePath) ||
    inside(path.join(repo, 'build/verification'), packagePath),
  'Keep external PGN outside the repository or in private build/verification, never in sources or fixtures.',
);
for (const file of additionalPaths) {
  assert.ok((await stat(file)).isFile());
  assert.ok(
    !inside(repo, file) || inside(path.join(repo, 'build/verification'), file),
  );
}
const artifacts = path.resolve(repo, 'build/verification/import', randomUUID());
const applicationHome = path.join(artifacts, 'home');
const stockfish =
  'C:/XProgramme/stockfish/stockfish-windows-x86-64-universal.exe';
const free = { kind: 'free' } as const;
const steps: { name: string; status: 'passed' | 'failed'; detail?: string }[] =
  [];
const errors: string[] = [];
const output: string[] = [];
const desktopProcessIds: number[] = [];
const screenshots: string[] = [];
const accessibility: { screenshot: string; violations: unknown }[] = [];
const limits = [
  'The native file picker is stubbed in the owned Electron process; trusted picker IPC, renderer and Host are exercised. No human native-dialog acceptance is claimed.',
];
let runtime: ComposedHost | undefined;
let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
let page: Page | undefined;
let client: PlysmithHostClient;
let locale: 'de-DE' | 'en-GB' = 'de-DE';
let folderId: string;
let contextId: string;
const packages: {
  name: string;
  imported: number;
  rejected: number;
  nodes: number;
  error?: string;
}[] = [];
let totalPublished = 0;
let overview: AnalysisRecordDto;
type TreeNode = Pick<
  NonNullable<AnalysisRecordDto['tree']>['nodes'][number],
  | 'nodeIndex'
  | 'parentNodeIndex'
  | 'siblingOrder'
  | 'anchorId'
  | 'move'
  | 'after'
>;
let branch: TreeNode | undefined;
const expected: ChessTreeCandidate[] = [];
let imported: AnalysisRecordDto[] = [];
let previewNames: string[] = [];
let editedNoteId: string;
let editedNoteBody: string;
let contextNoteId: string;
const contextNoteBody = 'Runtime acceptance: context-only note';
const renamedTitle = 'Runtime acceptance: renamed chapter';
let expectedNodes = 0;
let failed = false;
await mkdir(artifacts, { recursive: true });
console.log('Artifacts: ' + artifacts);

function label(key: string): string {
  const all = { ...messages[locale], ...importMessages[locale] } as Record<
    string,
    string
  >;
  assert.ok(all[key], 'Unknown UI label ' + key);
  return all[key];
}
async function proof() {
  await writeFile(
    path.join(artifacts, 'proof.json'),
    JSON.stringify(
      {
        applicationHome,
        ownedHostProcessId: process.pid,
        desktopProcessIds,
        screenshots,
        packagePath,
        expectedChapters: expected.length,
        expectedNodes,
        importedChapters: imported.length,
        importedNodes: imported.reduce(
          (sum, record) => sum + nodesOf(record).length,
          0,
        ),
        branchAnchorId: branch?.anchorId,
        editedNoteId,
        contextNoteId,
        steps,
        errors,
        accessibility,
        limits,
        folderId,
        contextId,
        packages,
        totalPublished,
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(path.join(artifacts, 'desktop-output.txt'), output.join(''));
}
async function step(name: string, action: () => Promise<void>) {
  console.log('RUN ' + name);
  try {
    await action();
    steps.push({ name, status: 'passed' });
    console.log('PASS ' + name);
  } catch (error) {
    failed = true;
    const detail =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    steps.push({ name, status: 'failed', detail });
    console.error(detail);
    if (page && !page.isClosed()) {
      await page
        .screenshot({
          path: path.join(artifacts, 'failure.png'),
          fullPage: true,
        })
        .catch(() => undefined);
      await writeFile(
        path.join(artifacts, 'failure-dom.html'),
        await page.content(),
      );
      await writeFile(
        path.join(artifacts, 'failure-dom.txt'),
        await page.locator('body').innerText(),
      );
    }
    throw error;
  } finally {
    await proof();
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
  if (!app) return;
  const owned = app;
  app = undefined;
  page = undefined;
  const child = owned.process();
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    await owned.evaluate(({ app: electronApp }) => {
      setTimeout(() => electronApp.quit(), 0);
    });
    await expect
      .poll(() => child.exitCode !== null || child.signalCode !== null, {
        timeout: 30_000,
      })
      .toBe(true);
  } catch (error) {
    child.kill();
    await expect
      .poll(() => child.exitCode !== null || child.signalCode !== null, {
        timeout: 10_000,
      })
      .toBe(true);
    throw error;
  }
}
async function closeHost() {
  const owned = runtime;
  runtime = undefined;
  await owned?.close();
}
async function restart() {
  await closeDesktop();
  await closeHost();
  await startHost();
}
async function launchDesktop() {
  app = await electron.launch({
    executablePath: path.join(repo, 'node_modules/electron/dist/electron.exe'),
    args: [
      path.join(repo, 'build/desktop/main.mjs'),
      '--application-home',
      applicationHome,
      '--install-root',
      repo,
    ],
    cwd: repo,
    timeout: 60_000,
  });
  const desktopPid = app.process().pid;
  if (desktopPid !== undefined) desktopProcessIds.push(desktopPid);
  for (const stream of [app.process().stdout, app.process().stderr])
    stream?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  page = await app.firstWindow({ timeout: 60_000 });
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page
    .getByRole('navigation', { name: 'Plysmith' })
    .waitFor({ timeout: 60_000 });
  await page
    .getByText(/^(Verbunden|Connected)$/)
    .first()
    .waitFor();
  await page.setViewportSize({ width: 1600, height: 1000 });
  const paths = await app.evaluate(({ app: electronApp }) => ({
    userData: electronApp.getPath('userData'),
    session: electronApp.getPath('sessionData'),
  }));
  assert.equal(paths.userData, path.join(applicationHome, 'desktop/profile'));
  assert.equal(
    paths.session,
    path.join(applicationHome, 'desktop/profile/session'),
  );
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    });
  }, packagePath);
}
async function screenshot(name: string) {
  assert.ok(page);
  await page.evaluate('document.fonts.ready');
  const screenshotPath = path.join(artifacts, name + '.png');
  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
  });
  screenshots.push(screenshotPath);
  const violations = (await new AxeBuilder({ page }).setLegacyMode().analyze())
    .violations;
  if (violations.length > 0)
    accessibility.push({ screenshot: name, violations });
  await writeFile(
    path.join(artifacts, name + '-axe.json'),
    JSON.stringify(violations, null, 2),
  );
  assert.deepEqual(violations, [], 'No accessibility violations');
  assert.ok(
    await page.evaluate<boolean>(
      'document.documentElement.scrollWidth <= innerWidth + 1',
    ),
    'No horizontal overflow',
  );
  assert.deepEqual(errors, [], 'No renderer errors');
}
async function inventory() {
  const result = await client.searchInventory({ pageSize: '100' });
  const items = [...result.items];
  let cursor = result.nextCursor;
  while (cursor) {
    const next = await client.searchInventory({ pageSize: '100', cursor });
    items.push(...next.items);
    cursor = next.nextCursor;
  }
  return { ...result, items };
}
async function openImport() {
  await page!
    .getByRole('button', { name: label('import.open'), exact: true })
    .click();
}
function dialog() {
  return page!.getByRole('dialog', {
    name: label('import.title'),
    exact: true,
  });
}
async function chooseAndPrepare(file = packagePath) {
  await app!.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    });
  }, file);
  await openImport();
  await dialog()
    .getByRole('button', { name: label('import.choose'), exact: true })
    .click();
  await expect(
    dialog().getByLabel(label('import.prefix'), { exact: true }),
  ).toBeVisible();
  await expect(
    dialog().getByLabel(label('import.prefix'), { exact: true }),
  ).toHaveValue(path.basename(file) + ' - ');
}
async function confirmWarnings() {
  const confirmation = dialog().getByRole('checkbox', {
    name: label('import.confirmWarnings'),
    exact: true,
  });
  if (await confirmation.count()) await confirmation.check();
}
async function closeImport() {
  await dialog()
    .getByRole('button', { name: label('import.close'), exact: true })
    .last()
    .click();
  await expect(dialog()).toBeHidden();
}
function assertNoImportStorage() {
  const database = new Database(
    path.join(applicationHome, 'data/plysmith.db'),
    { readonly: true },
  );
  try {
    assert.deepEqual(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'import_%'",
        )
        .all(),
      [],
    );
    assert.equal(
      database
        .prepare('PRAGMA table_info(item_revision)')
        .all()
        .some(
          (column) =>
            (column as { name: string }).name === 'import_publication_id',
        ),
      false,
    );
  } finally {
    database.close();
  }
}
function row(name: string) {
  return page!
    .locator('li[draggable="true"]')
    .filter({ has: page!.getByText(name, { exact: true }) });
}
async function activateAction(owner: Locator, name: string) {
  await owner.getByRole('button', { name, exact: true }).click();
}
async function manage(context = false) {
  await page!
    .getByRole('navigation', { name: 'Plysmith' })
    .getByRole('button', { name: label('activity.manage'), exact: true })
    .click();
  await page!
    .getByLabel(label('scope.label'), { exact: true })
    .selectOption(context ? 'context:' + contextId : 'free');
}

function nodesOf(record: AnalysisRecordDto): readonly TreeNode[] {
  return (
    record.tree?.nodes ??
    record.steps.map((entry, index) => ({
      nodeIndex: index,
      parentNodeIndex: index === 0 ? null : index - 1,
      siblingOrder: 0,
      anchorId: entry.anchorId,
      move: entry.move,
      after: entry.after,
    }))
  );
}
async function readRecord(context = false, anchorId?: string) {
  return client.getInventoryRevision(overview.itemId, overview.revisionId, {
    scopeKind: context ? 'context' : 'free',
    ...(context ? { contextId } : {}),
    ...(anchorId === undefined ? {} : { anchorId }),
  });
}
async function atAnchor(anchorId: string, context = false) {
  await expect
    .poll(
      async () =>
        (
          await client.getAnalysisWorkspace({
            scopeKind: context ? 'context' : 'free',
            ...(context ? { contextId } : {}),
          })
        ).record?.currentAnchorId,
    )
    .toBe(anchorId);
}
async function openAnalysis(context = false) {
  await manage(context);
  await activateAction(row(overview.displayName), label('activity.analyze'));
  await expect(
    page!.getByRole('heading', { name: overview.displayName, exact: true }),
  ).toBeVisible();
  await page!
    .getByRole('button', { name: label('analysis.path'), exact: true })
    .click();
  await atAnchor(overview.rootAnchorId, context);
}
async function navigateTo(target: TreeNode) {
  await openAnalysis();
  await revealVariations();
  await page!.locator(`[data-tree-anchor="${target.anchorId}"]`).click();
  await atAnchor(target.anchorId);
}
async function revealVariations() {
  for (let count = 0; count < 256; count++) {
    const toggle = page!
      .getByRole('button', {
        name: /^(Variante ausklappen|Expand variation):/,
      })
      .first();
    if ((await toggle.count()) === 0) return;
    await toggle.click();
  }
  throw new Error('Unexpected variation expansion loop.');
}
function noteArticle(body: string) {
  return page!.getByRole('article').filter({
    has: page!.getByText(body, { exact: true }),
  });
}
async function saveNote() {
  await page!
    .getByRole('button', { name: label('analysis.saveNoteEdit'), exact: true })
    .click();
}
async function addRootNote(body: string, context = false) {
  await openAnalysis(context);
  await page!
    .getByRole('button', {
      name: label('analysis.addNoteAtPathStart'),
      exact: true,
    })
    .click();
  await page!
    .getByRole('textbox', { name: label('analysis.newNote'), exact: true })
    .fill(body);
  await saveNote();
  await expect
    .poll(async () =>
      (await readRecord(context)).contributions.some(
        (entry) => entry.body === body.trim(),
      ),
    )
    .toBe(true);
}
function noteSnapshot(record: AnalysisRecordDto) {
  return [...record.contributions].sort((a, b) =>
    a.contributionId.localeCompare(b.contributionId),
  );
}
function assertImported(
  candidate: ChessTreeCandidate,
  record: AnalysisRecordDto,
) {
  const nodes = nodesOf(record);
  assert.equal(record.root.fen, candidate.root?.fen);
  assert.deepEqual(
    nodes.map((node) => [
      node.parentNodeIndex,
      node.siblingOrder,
      node.move.san,
      node.after.fen,
    ]),
    candidate.nodes.map((node) => [
      node.parentNodeIndex,
      node.siblingOrder,
      node.move.san,
      node.after.fen,
    ]),
  );
  const notes: [string, string][] = [];
  const add = (anchor: string, comments: readonly string[]) => {
    for (const body of comments) if (body.trim()) notes.push([anchor, body]);
  };
  add(record.rootAnchorId, candidate.initialComments);
  for (const node of candidate.nodes) {
    add(nodes[node.nodeIndex]!.anchorId, node.comments);
    add(
      node.parentNodeIndex === null
        ? record.rootAnchorId
        : nodes[node.parentNodeIndex]!.anchorId,
      node.startingComments,
    );
  }
  const sorted = (entries: readonly (readonly string[])[]) =>
    entries.map((entry) => JSON.stringify(entry)).sort();
  assert.deepEqual(
    sorted(record.contributions.map((note) => [note.anchorId, note.body])),
    sorted(notes),
  );
  assert.ok(record.contributions.every((note) => note.scopeKind === 'global'));
  assert.equal(
    new Set(record.contributions.map((note) => note.anchorId)).size,
    record.contributions.length,
    'A new import must produce at most one editable note per occurrence.',
  );
  assert.ok(
    record.contributions.every(
      (note) => !/\[%(?:csl|cal|eval|clk|emt)\b/.test(note.body),
    ),
    'Technical PGN annotations must not survive as imported notes.',
  );
  assert.ok(
    record.contributions.every(
      (note) => note.body.length <= 128_000 && note.body.isWellFormed(),
    ),
    'Imported comments must remain editable and well-formed Unicode.',
  );
}

try {
  await step(
    'Read the private UTF-8 PGN and derive the expected chapter, tree and note counts',
    async () => {
      const bytes = await readFile(packagePath);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      await new PgnContentFormatAdapter(new ChessJsRulesAdapter()).decode(
        (async function* () {
          yield text;
        })(),
        {
          signal: new AbortController().signal,
          onCandidate: async (candidate) => {
            expected.push(candidate);
          },
        },
      );
      assert.ok(expected.length > 0, 'The input must contain PGN chapters.');
      assert.ok(
        expected.every((candidate) => candidate.status !== 'rejected'),
        'All input chapters must be usable.',
      );
      assert.ok(
        expected.some(
          (candidate) =>
            candidate.initialComments.length > 0 ||
            candidate.nodes.some((node) => node.comments.length > 0),
        ),
        'Acceptance requires annotated PGN.',
      );
      expectedNodes = expected.reduce(
        (sum, candidate) => sum + candidate.nodes.length,
        0,
      );
      console.log(
        'Input: ' + expected.length + ' chapters, ' + expectedNodes + ' nodes',
      );
    },
  );
  await step(
    'Isolated fresh host, real Stockfish and empty import destinations',
    async () => {
      await access(stockfish);
      await access(path.join(repo, 'build/desktop/main.mjs'));
      await startHost();
      assert.equal((await inventory()).items.length, 0);
      await client.saveEngineProviderConfiguration('import-stockfish', {
        expectedConfigurationRevision: null,
        input: {
          instanceId: 'import-stockfish',
          displayName: 'Stockfish',
          providerType: 'stockfish-uci',
          executablePath: stockfish,
          arguments: [],
          threads: 1,
          hashMb: 16,
          detailLevels: { fast: 500, thorough: 50, very_deep: 5_000 },
          playoutBudget: 'thorough',
          startupTimeoutMs: 10_000,
          moveTimeoutMs: 10_000,
          stopTimeoutMs: 2_000,
          maxOutputBytes: 65_536,
        },
      });
      await restart();
      contextId = (
        await client.createWorkingContext({ displayName: 'PGN practice' })
      ).context.contextId;
      await launchDesktop();
    },
  );
  await step(
    'Desktop preview is ephemeral; prefix and folder are the only destinations',
    async () => {
      await manage(true);
      await chooseAndPrepare();
      await expect(
        dialog().getByLabel(label('import.folder'), { exact: true }),
      ).toHaveValue('new');
      await expect(
        dialog().getByLabel(label('import.folderName'), { exact: true }),
      ).toHaveValue(path.basename(packagePath));
      assert.equal((await inventory()).items.length, 0);
      assert.equal(
        (await client.getInventoryOrganization({})).folders.length,
        0,
      );
      assertNoImportStorage();
      await screenshot('import-preview-de');
      await page!.keyboard.press('Escape');
      await expect(dialog()).toBeHidden();
      await restart();
      await launchDesktop();
      await openImport();
      await expect(
        dialog().getByLabel(label('import.prefix'), { exact: true }),
      ).toHaveCount(0);
      await closeImport();
      assert.equal((await inventory()).items.length, 0);
    },
  );
  await step(
    'UI publishes namespaced ordinary objects and a new folder, never context membership',
    async () => {
      await chooseAndPrepare();
      previewNames = expected.map(
        (candidate) =>
          path.basename(packagePath) + ' - ' + candidate.suggestedName,
      );
      assert.equal(new Set(previewNames).size, expected.length);
      await confirmWarnings();
      await expect(
        dialog().getByRole('button', {
          name: label('import.publish'),
          exact: true,
        }),
      ).toBeEnabled();
      await screenshot('import-ready-de');
      await dialog()
        .getByRole('button', { name: label('import.publish'), exact: true })
        .click();
      await expect
        .poll(async () => (await inventory()).items.length)
        .toBe(expected.length);
      await closeImport();
      const organization = await client.getInventoryOrganization({});
      const folder = organization.folders.find(
        (entry) => entry.displayName === path.basename(packagePath),
      );
      assert.ok(folder);
      folderId = folder.folderId;
      const items = (await inventory()).items;
      assert.ok(
        items.every(
          (item) =>
            item.itemType === 'analysis' &&
            item.folderId === folderId &&
            item.contextIds.length === 0,
        ),
      );
      imported = [];
      for (const [index, name] of previewNames.entries()) {
        const item = items.find((entry) => entry.displayName === name);
        assert.ok(item);
        const record = await client.getInventoryRevision(
          item.itemId,
          item.currentRevisionId,
          { scopeKind: 'free' },
        );
        assertImported(expected[index]!, record);
        imported.push(record);
      }
      totalPublished += imported.length;
      packages.push({
        name: path.basename(packagePath),
        imported: imported.length,
        rejected: 0,
        nodes: expectedNodes,
      });
      assertNoImportStorage();
      overview =
        imported.find((record) =>
          nodesOf(record).some((node) => node.siblingOrder > 0),
        ) ?? imported[0]!;
      branch = nodesOf(overview).find((node) => node.siblingOrder > 0);
      await client.addContextReference(contextId, {
        itemId: overview.itemId,
        anchorId: overview.rootAnchorId,
      });
      await manage(true);
      await expect(row(overview.displayName)).toBeVisible();
      await screenshot('import-context-de');
    },
  );
  await step(
    'Navigate an existing branch through the UI and retain it across back/forward',
    async () => {
      if (branch === undefined) {
        limits.push(
          'The selected input has no RAV; branch navigation cannot be exercised.',
        );
        await openAnalysis();
        return;
      }
      await navigateTo(branch);
      const read = await readRecord(false, branch.anchorId);
      const selected = read.steps.find(
        (entry) => entry.anchorId === branch!.anchorId,
      );
      assert.equal(read.currentAnchorId, branch.anchorId);
      assert.equal(selected?.after.fen, branch.after.fen);
      assert.equal(selected?.move.san, branch.move.san);
      await page!
        .getByRole('button', {
          name: label('analysis.previousMove'),
          exact: true,
        })
        .click();
      await atAnchor(
        branch.parentNodeIndex === null
          ? overview.rootAnchorId
          : nodesOf(overview)[branch.parentNodeIndex]!.anchorId,
      );
      await page!
        .getByRole('button', { name: label('analysis.nextMove'), exact: true })
        .click();
      await atAnchor(branch.anchorId);
      await screenshot('import-analysis-variation');
    },
  );
  await step(
    'Edit an imported ordinary comment and create/delete a normal note through the UI',
    async () => {
      const current = await readRecord(false, branch?.anchorId);
      const visible = new Set([
        current.rootAnchorId,
        ...current.steps.map((entry) => entry.anchorId),
      ]);
      const visibleNotes = current.contributions.filter((entry) =>
        visible.has(entry.anchorId),
      );
      const uniqueNotes = visibleNotes.filter(
        (entry) =>
          visibleNotes.filter((other) => other.body === entry.body).length ===
          1,
      );
      const note =
        uniqueNotes.find((entry) => entry.anchorId !== current.rootAnchorId) ??
        uniqueNotes[0];
      assert.ok(
        note,
        'A visible imported contribution is required for the edit proof.',
      );
      editedNoteId = note.contributionId;
      const suffix = '\n\nRuntime acceptance: edited imported comment';
      let prefix = note.body.slice(0, 128_000 - suffix.length);
      if (/[\uD800-\uDBFF]$/.test(prefix)) prefix = prefix.slice(0, -1);
      const editedInput = prefix + suffix;
      editedNoteBody = editedInput.trim();
      await noteArticle(note.body)
        .getByRole('button', { name: label('analysis.editNote'), exact: true })
        .click();
      await page!
        .getByRole('textbox', { name: label('analysis.editNote'), exact: true })
        .fill(editedInput);
      await saveNote();
      await expect
        .poll(
          async () =>
            (await readRecord()).contributions.find(
              (entry) => entry.contributionId === editedNoteId,
            )?.body,
        )
        .toBe(editedNoteBody);
      const edited = (await readRecord()).contributions.find(
        (entry) => entry.contributionId === editedNoteId,
      );
      assert.ok(edited);
      assert.equal(edited.anchorId, note.anchorId);
      assert.equal(edited.scopeKind, 'global');
      assert.equal(edited.contributionVersion, note.contributionVersion + 1);
      await expect(noteArticle(editedNoteBody)).toBeVisible();
      const temporary = 'Runtime acceptance: temporary global note';
      await addRootNote(temporary);
      const created = (await readRecord()).contributions.find(
        (entry) => entry.body === temporary,
      );
      assert.ok(created);
      assert.equal(created.scopeKind, 'global');
      await noteArticle(temporary)
        .getByRole('button', {
          name: label('analysis.deleteNote'),
          exact: true,
        })
        .click();
      await noteArticle(temporary)
        .getByRole('button', { name: label('analysis.delete'), exact: true })
        .click();
      await expect
        .poll(async () =>
          (await readRecord()).contributions.some(
            (entry) => entry.contributionId === created.contributionId,
          ),
        )
        .toBe(false);
      await expect(noteArticle(temporary)).toHaveCount(0);
      await screenshot('import-comment-crud-de');
    },
  );
  await step(
    'Global imported notes and context-only notes remain independent',
    async () => {
      await addRootNote(contextNoteBody, true);
      const scoped = await readRecord(true);
      const note = scoped.contributions.find(
        (entry) => entry.body === contextNoteBody,
      );
      assert.ok(note);
      contextNoteId = note.contributionId;
      assert.equal(note.scopeKind, 'context');
      assert.equal(note.contextId, contextId);
      assert.equal(
        scoped.contributions.find(
          (entry) => entry.contributionId === editedNoteId,
        )?.body,
        editedNoteBody,
      );
      assert.equal(
        (await readRecord()).contributions.some(
          (entry) => entry.contributionId === contextNoteId,
        ),
        false,
      );
      assert.equal(
        (await inventory()).items.find(
          (entry) => entry.itemId === overview.itemId,
        )?.folderId,
        folderId,
      );
      await screenshot('import-context-notes-de');
      await openAnalysis();
      await expect(noteArticle(contextNoteBody)).toHaveCount(0);
      overview = await readRecord();
    },
  );
  await step(
    'Rename preserves every RAV and ordinary global/context note',
    async () => {
      const before = await readRecord();
      const contextBefore = await readRecord(true);
      await manage();
      await activateAction(row(before.displayName), label('inventory.rename'));
      const rename = page!.getByRole('dialog');
      await rename
        .getByLabel(label('inventory.displayName'), { exact: true })
        .fill(renamedTitle);
      await rename
        .getByRole('button', {
          name: label('inventory.saveRevision'),
          exact: true,
        })
        .click();
      await expect(rename).toBeHidden();
      const item = (await inventory()).items.find(
        (entry) => entry.itemId === before.itemId,
      );
      assert.ok(item);
      assert.notEqual(item.currentRevisionId, before.revisionId);
      overview = await client.getInventoryRevision(
        item.itemId,
        item.currentRevisionId,
        { scopeKind: 'free' },
      );
      assert.equal(overview.displayName, renamedTitle);
      assert.deepEqual(nodesOf(overview), nodesOf(before));
      assert.deepEqual(noteSnapshot(overview), noteSnapshot(before));
      assert.deepEqual(
        noteSnapshot(await readRecord(true)),
        noteSnapshot(contextBefore),
      );
      await screenshot('import-renamed');
    },
  );
  await step(
    'Full restart retains the edited imported comment in the UI and context separation',
    async () => {
      await restart();
      await launchDesktop();
      const target = branch ?? nodesOf(overview)[0];
      if (target) await navigateTo(target);
      else await openAnalysis();
      const read = await readRecord();
      assert.deepEqual(noteSnapshot(read), noteSnapshot(overview));
      assert.equal(
        read.contributions.find(
          (entry) => entry.contributionId === editedNoteId,
        )?.body,
        editedNoteBody,
      );
      await expect(noteArticle(editedNoteBody)).toBeVisible();
      assert.equal(
        read.contributions.some(
          (entry) => entry.contributionId === contextNoteId,
        ),
        false,
      );
      await openAnalysis(true);
      await expect(noteArticle(contextNoteBody)).toBeVisible();
      assert.equal(
        (await readRecord(true)).contributions.find(
          (entry) => entry.contributionId === contextNoteId,
        )?.body,
        contextNoteBody,
      );
      await screenshot('import-comment-restart-de');
    },
  );
  await step(
    'Play an imported position against the existing real Stockfish executable',
    async () => {
      const start = branch ?? nodesOf(overview)[0];
      if (start) await navigateTo(start);
      else await openAnalysis();
      // The UI transition releases analysis focus before requesting an engine move.
      await page!
        .getByRole('main')
        .getByRole('button', { name: label('activity.playout'), exact: true })
        .click();
      await page!
        .getByRole('combobox', {
          name: label('playout.chooseOpponent'),
          exact: true,
        })
        .selectOption('import-stockfish');
      await page!
        .getByRole('button', {
          name: label('playout.providerMovesFirst'),
          exact: true,
        })
        .click();
      await expect
        .poll(
          async () => {
            const read = await client.getPlayout({ scopeKind: 'free' });
            return read?.draft.status.kind;
          },
          { timeout: 30_000 },
        )
        .toBe('active');
      const game = await client.getPlayout({ scopeKind: 'free' });
      assert.ok(game);
      assert.equal(game.draft.status.kind, 'active');
      assert.deepEqual(game.draft.root, start?.after ?? overview.root);
      assert.equal(game.draft.policy.providerInstanceId, 'import-stockfish');
      assert.ok(game.draft.steps.length > 0);
      const stopped = await client.stopPlayout({
        scope: free,
        draftId: game.draft.draftId,
        expectedDraftRevision: game.draft.draftRevision,
      });
      await client.completePlayout({
        scope: free,
        draftId: stopped.draft.draftId,
        expectedDraftRevision: stopped.draft.draftRevision,
        completionId: randomUUID(),
        displayName: 'PGN against Stockfish',
        languageTag: 'de-DE',
        manualResult: 'unfinished',
      });
      await manage();
      assert.equal((await inventory()).items.length, expected.length + 1);
      await expect(row('PGN against Stockfish')).toBeVisible();
      await screenshot('import-derived-practice');
    },
  );
  await step(
    'Current inventory name conflicts, proposals and DE/EN narrow layout',
    async () => {
      await chooseAndPrepare();
      await expect(
        dialog().getByLabel(label('import.folder'), { exact: true }),
      ).toHaveValue(folderId);
      await expect(
        dialog().getByText(label('import.conflict')).first(),
      ).toBeVisible();
      await expect(
        dialog().getByRole('button', {
          name: label('import.publish'),
          exact: true,
        }),
      ).toBeDisabled();
      await screenshot('import-name-conflicts');
      const prefix = dialog().getByLabel(label('import.prefix'), {
        exact: true,
      });
      const firstName = dialog().getByLabel(label('import.name') + ' 1', {
        exact: true,
      });
      const secondName = dialog().getByLabel(label('import.name') + ' 2', {
        exact: true,
      });
      const originalFirst = await firstName.inputValue();
      const originalSecond = await secondName.inputValue();
      const originalPrefix = await prefix.inputValue();
      // Global changes while the dialog stays open must invalidate its name check.
      const extraInput = await client.registerImportInput({
        inputLocator: packagePath,
      });
      const extraPreview = await client.prepareImport({
        inputHandle: extraInput.inputHandle,
        languageTag: locale,
      });
      const extra = await client.publishImport({
        previewId: extraPreview.previewId,
        candidates: [
          {
            sourceOrder: 0,
            itemType: 'analysis',
            displayName:
              previewNames[
                imported.findIndex((item) => item.itemId === overview.itemId)
              ]!,
          },
        ],
        folder: { kind: 'unfiled' },
        confirmWarnings: true,
      });
      await expect(dialog().getByText(label('import.conflict'))).toHaveCount(
        expected.length,
      );
      const deletion = await client.previewInventoryItemDeletion(
        extra.items[0]!.itemId,
      );
      await client.deleteInventoryItem(deletion.itemId, {
        expectedCurrentRevisionId: deletion.currentRevisionId,
        expectedDataRevision: deletion.dataRevision,
      });
      await expect(dialog().getByText(label('import.conflict'))).toHaveCount(
        expected.length - 1,
      );
      await dialog()
        .getByRole('button', {
          name: label('import.clearSelection'),
          exact: true,
        })
        .click();
      await dialog()
        .getByRole('checkbox', {
          name: '„' + (originalPrefix + originalFirst).trim() + '“ auswählen',
          exact: true,
        })
        .check();
      await dialog()
        .getByRole('checkbox', {
          name: '„' + (originalPrefix + originalSecond).trim() + '“ auswählen',
          exact: true,
        })
        .check();
      await prefix.fill('a'.repeat(156));
      await firstName.fill('XYZ');
      await secondName.fill('XYZ');
      await dialog()
        .getByRole('button', { name: label('import.names'), exact: true })
        .click();
      await expect(secondName).toHaveValue('XYZ (2)');
      await expect(prefix).toHaveValue('a'.repeat(156));
      await expect(
        dialog().getByRole('button', {
          name: label('import.publish'),
          exact: true,
        }),
      ).toBeDisabled();
      await expect(
        dialog().getByText(label('import.nameLength')),
      ).toBeVisible();
      await firstName.fill(originalFirst);
      await secondName.fill(originalSecond);
      await prefix.fill(' ' + originalPrefix);
      await dialog()
        .getByRole('button', { name: label('import.selectAll'), exact: true })
        .click();
      await dialog()
        .getByRole('button', { name: label('import.names'), exact: true })
        .click();
      await expect(prefix).toHaveValue(' ' + originalPrefix);
      assert.ok(!(await secondName.inputValue()).startsWith(originalPrefix));
      await expect(dialog().getByText(label('import.conflict'))).toHaveCount(0);
      await confirmWarnings();
      await expect(
        dialog().getByRole('button', {
          name: label('import.publish'),
          exact: true,
        }),
      ).toBeEnabled();
      await screenshot('import-name-proposals');
      await page!.setViewportSize({ width: 390, height: 844 });
      await screenshot('import-narrow-de');
      await page!.keyboard.press('Escape');
      await expect(dialog()).toBeHidden();
      await client.setUiLanguage({
        uiLocale: 'en-GB',
        expectedRevision: (await client.getUserPreferences())
          .preferenceRevision,
      });
      locale = 'en-GB';
      await chooseAndPrepare();
      await screenshot('import-narrow-en');
      await page!.setViewportSize({ width: 1600, height: 1000 });
      await screenshot('import-wide-en');
      await page!.keyboard.press('Escape');
      await expect(dialog()).toBeHidden();
      assert.equal((await inventory()).items.length, expected.length + 1);
    },
  );
  for (const file of additionalPaths) {
    await step('External desktop import: ' + path.basename(file), async () => {
      await manage();
      const candidates: ChessTreeCandidate[] = [];
      let decodeError: unknown;
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(
          await readFile(file),
        );
        await new PgnContentFormatAdapter(new ChessJsRulesAdapter()).decode(
          (async function* () {
            yield text;
          })(),
          {
            signal: new AbortController().signal,
            onCandidate: async (candidate) => {
              candidates.push(candidate);
            },
          },
        );
      } catch (error) {
        decodeError = error;
      }
      const before = (await inventory()).items.length;
      const beforeFolders = (await client.getInventoryOrganization({})).folders
        .length;
      if (decodeError) {
        await app!.evaluate(({ dialog }, filePath) => {
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [filePath],
          });
        }, file);
        await openImport();
        await dialog()
          .getByRole('button', { name: label('import.choose'), exact: true })
          .click();
        await expect(dialog().getByRole('alert')).toBeVisible();
        assert.equal((await inventory()).items.length, before);
        assert.equal(
          (await client.getInventoryOrganization({})).folders.length,
          beforeFolders,
        );
        packages.push({
          name: path.basename(file),
          imported: 0,
          rejected: candidates.filter((c) => c.status === 'rejected').length,
          nodes: 0,
          error: String(decodeError),
        });
        await page!.keyboard.press('Escape');
        await expect(dialog()).toBeHidden();
        return;
      }
      const usable = candidates.filter(
        (candidate) => candidate.status !== 'rejected',
      );
      assert.ok(usable.length);
      await chooseAndPrepare(file);
      const game = path.basename(file).startsWith('world-championship');
      if (game) {
        await dialog()
          .getByRole('radiogroup', {
            name: label('import.bulkType'),
            exact: true,
          })
          .getByRole('radio', { name: label('itemType.game'), exact: true })
          .press('Space');
      }
      const proposals = dialog().getByRole('button', {
        name: label('import.names'),
        exact: true,
      });
      await expect
        .poll(
          async () =>
            (await proposals.isEnabled()) ||
            (await dialog()
              .getByRole('button', {
                name: label('import.publish'),
                exact: true,
              })
              .isEnabled()) ||
            (await dialog()
              .getByRole('checkbox', {
                name: label('import.confirmWarnings'),
                exact: true,
              })
              .count()) > 0,
        )
        .toBe(true);
      if (await proposals.isEnabled()) {
        await proposals.click();
      }
      await confirmWarnings();
      await expect(
        dialog().getByRole('button', {
          name: label('import.publish'),
          exact: true,
        }),
      ).toBeEnabled();
      const publishedNames = new Map<number, string>();
      for (const candidate of usable) {
        const suffix = await dialog()
          .getByLabel(
            label('import.name') + ' ' + (candidate.sourceOrder + 1),
            { exact: true },
          )
          .inputValue();
        publishedNames.set(
          candidate.sourceOrder,
          (path.basename(file) + ' - ' + suffix).trim(),
        );
      }
      await dialog()
        .getByRole('button', { name: label('import.publish'), exact: true })
        .click();
      await expect
        .poll(async () => (await inventory()).items.length)
        .toBe(before + usable.length);
      await closeImport();
      const destination = (
        await client.getInventoryOrganization({})
      ).folders.find((entry) => entry.displayName === path.basename(file));
      assert.ok(destination);
      const items = (await inventory()).items.filter(
        (item) => item.folderId === destination.folderId,
      );
      assert.equal(items.length, usable.length);
      for (const candidate of usable) {
        const item = items.find(
          (entry) =>
            entry.displayName === publishedNames.get(candidate.sourceOrder),
        );
        assert.ok(item, 'Expected prefixed chapter ' + candidate.suggestedName);
        assert.equal(item.itemType, game ? 'game' : 'analysis');
        assert.deepEqual(item.contextIds, []);
        assertImported(
          candidate,
          await client.getInventoryRevision(
            item.itemId,
            item.currentRevisionId,
            { scopeKind: 'free' },
          ),
        );
      }
      totalPublished += usable.length;
      packages.push({
        name: path.basename(file),
        imported: usable.length,
        rejected: candidates.length - usable.length,
        nodes: usable.reduce(
          (sum, candidate) => sum + candidate.nodes.length,
          0,
        ),
      });
      assertNoImportStorage();
      await screenshot('package-' + path.basename(file, '.pgn'));
    });
  }
  await step(
    'Final restart preserves all chapters, renamed branches, notes and membership',
    async () => {
      await restart();
      await launchDesktop();
      const items = (await inventory()).items;
      assert.equal(items.length, totalPublished + 1);
      assert.equal(
        items.filter((entry) => entry.contextIds.includes(contextId)).length,
        1,
      );
      for (const original of imported) {
        const item = items.find((entry) => entry.itemId === original.itemId);
        assert.ok(item);
        assert.equal(item.folderId, folderId);
        assert.equal(
          item.contextIds.includes(contextId),
          item.itemId === overview.itemId,
        );
        const read = await client.getInventoryRevision(
          item.itemId,
          item.currentRevisionId,
          { scopeKind: 'free' },
        );
        assert.deepEqual(nodesOf(read), nodesOf(original));
        const baseline = item.itemId === overview.itemId ? overview : original;
        assert.deepEqual(noteSnapshot(read), noteSnapshot(baseline));
      }
      assert.equal(
        (await readRecord(true)).contributions.find(
          (entry) => entry.contributionId === contextNoteId,
        )?.body,
        contextNoteBody,
      );
      assertNoImportStorage();
      await manage();
      await page!
        .getByPlaceholder(label('manage.searchPlaceholder'), { exact: true })
        .fill(renamedTitle);
      await page!
        .getByRole('button', {
          name: label('manage.searchAction'),
          exact: true,
        })
        .click();
      await openAnalysis();
      await screenshot('import-final-en');
      await page!.setViewportSize({ width: 390, height: 844 });
      await screenshot('import-notes-narrow-en');
    },
  );
  const italianIndex = imported.findIndex((record) =>
    nodesOf(record).some(
      (node) =>
        node.siblingOrder > 0 &&
        node.move.san === 'Nf6' &&
        nodesOf(record).some(
          (child) =>
            child.parentNodeIndex === node.nodeIndex &&
            child.move.san === 'Ng5',
        ),
    ),
  );
  if (italianIndex !== -1) {
    for (const contextual of [false, true]) {
      await step(
        `Consecutive unsaved takebacks remove Ng5 and Nf6 (context: ${contextual})`,
        async () => {
          await page!.setViewportSize({ width: 1600, height: 1000 });
          if (contextual) {
            const input = await client.registerImportInput({
              inputLocator: packagePath,
            });
            const prepared = await client.prepareImport({
              inputHandle: input.inputHandle,
              languageTag: locale,
            });
            const published = await client.publishImport({
              previewId: prepared.previewId,
              candidates: [
                {
                  sourceOrder: expected[italianIndex]!.sourceOrder,
                  itemType: 'analysis',
                  displayName: 'Runtime acceptance: context takebacks',
                },
              ],
              folder: { kind: 'existing', folderId },
              confirmWarnings: true,
            });
            overview = await client.getInventoryRevision(
              published.items[0]!.itemId,
              published.items[0]!.revisionId,
              { scopeKind: 'free' },
            );
            await client.addContextReference(contextId, {
              itemId: overview.itemId,
              anchorId: overview.rootAnchorId,
            });
          } else {
            const item = (await inventory()).items.find(
              (entry) => entry.itemId === imported[italianIndex]!.itemId,
            )!;
            overview = await client.getInventoryRevision(
              item.itemId,
              item.currentRevisionId,
              { scopeKind: 'free' },
            );
          }
          const original = overview;
          const nodes = nodesOf(original);
          const nf6 = nodes.find(
            (node) =>
              node.siblingOrder > 0 &&
              node.move.san === 'Nf6' &&
              nodes.some(
                (child) =>
                  child.parentNodeIndex === node.nodeIndex &&
                  child.move.san === 'Ng5',
              ),
          )!;
          const ng5 = nodes.find(
            (node) => node.parentNodeIndex === nf6.nodeIndex,
          )!;
          assert.equal(ng5.move.san, 'Ng5');
          assert.equal(
            nodes.some((node) => node.parentNodeIndex === ng5.nodeIndex),
            false,
          );
          const parent = nodes[nf6.parentNodeIndex!]!;
          const scope = {
            scopeKind: contextual ? ('context' as const) : ('free' as const),
            ...(contextual ? { contextId } : {}),
          };
          await openAnalysis(contextual);
          await revealVariations();
          await page!.locator(`[data-tree-anchor="${ng5.anchorId}"]`).click();
          await atAnchor(ng5.anchorId, contextual);
          let draftId: string | undefined;
          let draftRevision = 0;
          for (const cut of [nf6, parent]) {
            await page!
              .getByRole('button', {
                name: label('analysis.takeBackLastMove'),
                exact: true,
              })
              .click();
            await expect
              .poll(async () => {
                const draft = (await client.getAnalysisWorkspace(scope))
                  .scratch;
                return draft?.origin.kind === 'inventory_anchor'
                  ? draft.origin.anchorId
                  : undefined;
              })
              .toBe(cut.anchorId);
            const draft = (await client.getAnalysisWorkspace(scope)).scratch!;
            if (draftId !== undefined) {
              assert.equal(draft.scratchId, draftId);
              assert.equal(draft.scratchRevision, draftRevision + 1);
            }
            draftId = draft.scratchId;
            draftRevision = draft.scratchRevision;
            assert.deepEqual(draft.root, cut.after);
            if (!contextual && cut.anchorId === nf6.anchorId) {
              await restart();
              await launchDesktop();
              assert.deepEqual(
                (await client.getAnalysisWorkspace(scope)).scratch,
                draft,
              );
              await expect(
                page!.getByRole('heading', {
                  name: overview.displayName,
                  exact: true,
                }),
              ).toBeVisible();
            }
          }
          const review = page!.getByRole('button', {
            name: label('draft.reviewChange'),
            exact: true,
          });
          if (await review.isVisible()) await review.click();
          const save = page!.getByRole('button', {
            name: label('inventory.saveRevision'),
            exact: true,
          });
          await expect(save).toBeEnabled();
          await screenshot(`italian-repeated-takeback-${contextual}-preview`);
          await save.click();
          await expect
            .poll(
              async () => (await client.getAnalysisWorkspace(scope)).scratch,
            )
            .toBeUndefined();
          const item = (await inventory()).items.find(
            (entry) => entry.itemId === original.itemId,
          )!;
          const saved = await client.getInventoryRevision(
            item.itemId,
            item.currentRevisionId,
            scope,
          );
          const removed = new Set([nf6.anchorId, ng5.anchorId]);
          assert.deepEqual(
            nodesOf(saved).map((node) => node.anchorId),
            nodes
              .filter((node) => !removed.has(node.anchorId))
              .map((node) => node.anchorId),
          );
          assert.deepEqual(
            noteSnapshot(saved),
            noteSnapshot(original).filter(
              (note) => !removed.has(note.anchorId),
            ),
          );
          assert.deepEqual(nodesOf(await readRecord(contextual)), nodes);
          overview = saved;
          await restart();
          await launchDesktop();
          assert.deepEqual(
            nodesOf(await readRecord(contextual)),
            nodesOf(saved),
          );
          await openAnalysis(contextual);
          await revealVariations();
          await expect(
            page!.locator(`[data-tree-anchor="${nf6.anchorId}"]`),
          ).toHaveCount(0);
          await screenshot(`italian-repeated-takeback-${contextual}-saved`);
        },
      );
    }
  }
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  for (const close of [closeDesktop, closeHost]) {
    try {
      await close();
    } catch (error) {
      failed = true;
      errors.push(String(error));
    }
  }
  await proof();
}
await delay(10);
if (failed) process.exitCode = 1;
