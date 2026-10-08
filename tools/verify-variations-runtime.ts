// Opt-in after build: real isolated Host and Electron acceptance of native variations.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  _electron as electron,
  expect,
  type Page,
  type Locator,
  type Request,
  type ConsoleMessage,
} from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import Database from 'better-sqlite3';
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

const repo = process.cwd();
const artifacts = path.join(
  repo,
  'build/verification/variations',
  randomUUID(),
);
const applicationHome = path.join(artifacts, 'home');
const free = { kind: 'free' } as const;
const draftsOnly = process.argv.includes('--drafts-only');
const manualOnly = process.argv.includes('--manual-only');
const configurationRestartOnly = process.argv.includes(
  '--configuration-restart-only',
);
const draftCase = process.argv
  .find((value) => value.startsWith('--draft-case='))
  ?.slice(13);
const draftCases = ['note-switches', 'record-form', 'remote-note'] as const;
assert.ok(
  draftCase === undefined ||
    (draftsOnly && draftCases.some((name) => name === draftCase)),
  '--draft-case requires --drafts-only and a known form-draft case.',
);
const steps: string[] = [];
const errors: string[] = [];
const screenshots: string[] = [];
let host: ComposedHost | undefined;
let client: PlysmithHostClient;
let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
let page!: Page;
let locale: 'de-DE' | 'en-GB' = 'de-DE';
let record!: AnalysisRecordDto;
await mkdir(artifacts, { recursive: true });
console.log('Artifacts: ' + artifacts);
const label = (id: string) => (messages[locale] as Record<string, string>)[id]!;
async function step(name: string, action: () => Promise<void>) {
  console.log('RUN ' + name);
  try {
    await action();
  } catch (error) {
    if (app && page) {
      await page.screenshot({
        path: path.join(artifacts, 'failure.png'),
        fullPage: true,
      });
      await writeFile(
        path.join(artifacts, 'failure.html'),
        await page.content(),
      );
    }
    throw error;
  }
  steps.push(name);
  console.log('PASS ' + name);
}
async function startHost() {
  host = await composeHost({
    applicationHome,
    defaultsDirectory: path.join(repo, 'configuration/defaults'),
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
  await publishHostDiscovery(applicationHome, discovery);
  client = await connectHost(discovery);
}
async function launch() {
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
    timeout: 60000,
  });
  page = await app.firstWindow({ timeout: 60000 });
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page
    .getByRole('navigation', { name: 'Plysmith' })
    .waitFor({ timeout: 60000 });
  await page
    .getByText(/^(Verbunden|Connected)$/)
    .first()
    .waitFor();
  const window = await app.browserWindow(page);
  await window.evaluate((window) => {
    window.setContentSize(1600, 1000);
    window.show();
    window.focus();
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  // Electron can defer the first viewport paint after restarting its window.
  await page.screenshot();
}
async function closeDesktop() {
  const owned = app;
  app = undefined;
  if (!owned) return;
  const process = owned.process();
  try {
    await owned.close();
    await expect
      .poll(() => process.exitCode !== null || process.signalCode !== null, {
        timeout: 30000,
      })
      .toBe(true);
  } finally {
    if (process.exitCode === null && process.signalCode === null)
      process.kill();
  }
}
async function read() {
  const inventory = await client.searchInventory({});
  const item = inventory.items.find((item) => item.itemId === record.itemId)!;
  return client.getInventoryRevision(item.itemId, item.currentRevisionId, {
    scopeKind: 'free',
  });
}
async function open() {
  await page
    .getByRole('navigation', { name: 'Plysmith' })
    .getByRole('button', { name: label('activity.manage'), exact: true })
    .click();
  const row = page
    .locator('li[draggable="true"]')
    .filter({ has: page.getByText(record.displayName, { exact: true }) });
  const button = row.getByRole('button', {
    name: label('activity.analyze'),
    exact: true,
  });
  const observed: string[] = [];
  const requestTrace = (request: Request) => {
    if (request.resourceType() === 'fetch')
      observed.push(request.method() + ' ' + new URL(request.url()).pathname);
  };
  const pointerTrace = (message: ConsoleMessage) => {
    if (message.text().startsWith('acceptance.open.'))
      observed.push(message.text());
  };
  page.on('request', requestTrace);
  page.on('console', pointerTrace);
  try {
    await button.evaluate((element) => {
      for (const type of ['pointerdown', 'pointerup', 'click', 'dragstart'])
        element.addEventListener(
          type,
          () => console.info('acceptance.open.' + type),
          { once: true },
        );
    });
    await button.click();
    await page
      .getByRole('heading', { name: record.displayName, exact: true })
      .waitFor();
  } catch (error) {
    await writeFile(
      path.join(artifacts, 'open-diagnostics.json'),
      JSON.stringify({ observed }, null, 2),
    );
    throw error;
  } finally {
    page.off('request', requestTrace);
    page.off('console', pointerTrace);
  }
}
async function move(from: string, to: string) {
  await expect(page.getByRole('grid')).toHaveAttribute(
    'aria-readonly',
    'false',
  );
  await page
    .getByRole('gridcell', { name: new RegExp('^' + from + ',') })
    .click();
  await page
    .getByRole('gridcell', { name: new RegExp('^' + to + ',') })
    .click();
}
async function revealVariations(container: Page | Locator = page) {
  for (let count = 0; count < 100; count++) {
    const toggle = container
      .getByRole('button', {
        name: /^(Variante ausklappen|Expand variation):/,
      })
      .first();
    if ((await toggle.count()) === 0) return;
    await toggle.click();
  }
  throw new Error('Unexpected variation expansion loop.');
}
async function reviewPath() {
  const review = page.getByRole('button', {
    name: label('draft.reviewChange'),
    exact: true,
  });
  await expect
    .poll(
      async () =>
        (await review.isVisible()) ||
        (await page
          .getByRole('button', {
            name: label('inventory.saveRevision'),
            exact: true,
          })
          .isVisible()),
    )
    .toBe(true);
  if (await review.isVisible()) await review.click();
}
async function saveAsVariation() {
  await reviewPath();
  await page
    .getByRole('button', {
      name: label('inventory.mode.add_variation'),
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('button', {
      name: label('inventory.saveRevision'),
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(label('inventory.automaticContextLosses'), { exact: true }),
  ).toHaveCount(0);
}
async function awaitSaved(revision: number) {
  await expect.poll(async () => (await read()).revisionNumber).toBe(revision);
  await expect(page.locator('[data-tree-draft]')).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: label('inventory.saveRevision'),
      exact: true,
    }),
  ).toHaveCount(0);
}
async function shot(name: string) {
  await page.evaluate('document.fonts.ready');
  const file = path.join(artifacts, name + '.png');
  await page.screenshot({ path: file, fullPage: true });
  screenshots.push(file);
  assert.ok(
    await page.evaluate(
      'document.documentElement.scrollWidth <= innerWidth + 1',
    ),
  );
  assert.deepEqual(
    (await new AxeBuilder({ page }).setLegacyMode().analyze()).violations,
    [],
  );
  assert.deepEqual(errors, []);
}

async function verifyFormDrafts() {
  const failures: unknown[] = [];
  for (const name of draftCases) {
    if (draftCase !== undefined && draftCase !== name) continue;
    try {
      await step('form drafts: ' + name, async () => {
        const created = await client.updateAnalysisScratch({
          scope: free,
          expectedScratchId: null,
          expectedScratchRevision: null,
          action: { kind: 'start', origin: { kind: 'initial_position' } },
        });
        const saved = await client.createAnalysisRecord({
          scope: free,
          expectedScratchId: created.scratch!.scratchId,
          expectedScratchRevision: created.scratch!.scratchRevision,
          displayName: 'Draft checks ' + name,
          languageTag: 'en-GB',
        });
        record = await client.getInventoryRevision(
          saved.itemId,
          saved.revisionId,
          { scopeKind: 'free' },
        );
        for (const body of ['First note', 'Second note']) {
          await client.createPositionNote({
            scope: free,
            itemId: record.itemId,
            revisionId: record.revisionId,
            anchorId: record.rootAnchorId,
            body,
            languageTag: 'en-GB',
            noteScope: { kind: 'global' },
          });
        }
        const { context } = await client.createWorkingContext({
          displayName: 'Draft context ' + name,
        });
        await client.addContextReference(context.contextId, {
          itemId: record.itemId,
          anchorId: record.rootAnchorId,
        });
        await client.setWorkScopeResume({
          scope: { kind: 'context', contextId: context.contextId },
          area: 'analyze',
          expectedResumeVersion: null,
          mode: 'analyze',
          itemId: record.itemId,
          revisionId: record.revisionId,
          anchorId: record.rootAnchorId,
        });
        await launch();
        await page
          .getByLabel(label('scope.label'), { exact: true })
          .selectOption('free');
        await open();
        const edit = () =>
          page.getByRole('textbox', {
            name: label('analysis.editNote'),
            exact: true,
          });
        const editNote = async (body: string) => {
          await page
            .locator('article[data-note-scope]')
            .filter({ hasText: body })
            .getByRole('button', {
              name: label('analysis.editNote'),
              exact: true,
            })
            .click();
        };
        const activity = async (id: string) => {
          await page
            .getByRole('navigation', { name: 'Plysmith' })
            .getByRole('button', { name: label('activity.' + id), exact: true })
            .click();
        };
        if (name === 'note-switches') {
          await editNote('First note');
          await edit().fill('Unsaved first note');
          await editNote('Second note');
          await edit().fill('Unsaved second note');
          await editNote('First note');
          await expect(edit()).toHaveValue('Unsaved first note');
          await activity('manage');
          await activity('analyze');
          await expect(edit()).toHaveValue('Unsaved first note');
          await page
            .getByLabel(label('scope.label'), { exact: true })
            .selectOption('context:' + context.contextId);
          await expect(edit()).toHaveCount(0);
          await editNote('First note');
          await edit().fill('Context draft');
          await page
            .getByLabel(label('scope.label'), { exact: true })
            .selectOption('free');
          await expect(edit()).toHaveValue('Unsaved first note');
          await editNote('Second note');
          await expect(edit()).toHaveValue('Unsaved second note');
          assert.deepEqual(
            (await read()).contributions.map((note) => note.body).sort(),
            ['First note', 'Second note'],
          );
        } else if (name === 'record-form') {
          await move('e2', 'e4');
          await reviewPath();
          await page
            .getByRole('button', {
              name: label('analysis.saveAsRecord'),
              exact: true,
            })
            .click();
          await page.locator('#analysis-title').fill('Free draft title');
          await page.locator('#analysis-record-note').fill('Free draft note');
          await page
            .getByLabel(label('scope.label'), { exact: true })
            .selectOption('context:' + context.contextId);
          await move('d2', 'd4');
          await reviewPath();
          await page
            .getByRole('button', {
              name: label('analysis.saveAsRecord'),
              exact: true,
            })
            .click();
          await expect(page.locator('#analysis-title')).toHaveValue('');
          await expect(page.locator('#analysis-record-note')).toHaveValue('');
          await page.locator('#analysis-title').fill('Context draft title');
          await page
            .locator('#analysis-record-note')
            .fill('Context draft note');
          await page
            .getByLabel(label('scope.label'), { exact: true })
            .selectOption('free');
          await reviewPath();
          await expect(page.locator('#analysis-title')).toHaveValue(
            'Free draft title',
          );
          await expect(page.locator('#analysis-record-note')).toHaveValue(
            'Free draft note',
          );
          await activity('manage');
          await activity('analyze');
          await reviewPath();
          await expect(page.locator('#analysis-title')).toHaveValue(
            'Free draft title',
          );
          await page
            .getByLabel(label('scope.label'), { exact: true })
            .selectOption('context:' + context.contextId);
          await reviewPath();
          await expect(page.locator('#analysis-title')).toHaveValue(
            'Context draft title',
          );
          await expect(page.locator('#analysis-record-note')).toHaveValue(
            'Context draft note',
          );
        } else {
          await editNote('First note');
          await edit().fill('Recover this text');
          const note = (await read()).contributions.find(
            (note) => note.body === 'First note',
          )!;
          await client.deleteAnalysisNote(note.contributionId, {
            scope: free,
            expectedContributionVersion: note.contributionVersion,
          });
          await expect(edit()).toHaveCount(0);
          await expect(
            page.locator('textarea').filter({ visible: true }),
          ).toHaveValue('Recover this text');
          await expect(
            page.getByRole('button', {
              name: label('analysis.path'),
              exact: true,
            }),
          ).toBeEnabled();
          await activity('manage');
          await activity('analyze');
          await expect(
            page.locator('textarea').filter({ visible: true }),
          ).toHaveValue('Recover this text');
          await page.setViewportSize({ width: 390, height: 844 });
          await shot('recovered-note-small');
        }
      });
    } catch (error) {
      failures.push(error);
      console.error('FAIL form drafts: ' + name, error);
    } finally {
      await closeDesktop();
      const scratch = (await client.getAnalysisWorkspace({ scopeKind: 'free' }))
        .scratch;
      if (scratch !== undefined)
        await client.updateAnalysisScratch({
          scope: free,
          expectedScratchId: scratch.scratchId,
          expectedScratchRevision: scratch.scratchRevision,
          action: { kind: 'discard' },
        });
    }
  }
  if (failures.length > 0)
    throw new AggregateError(failures, 'Form draft regressions');
}
async function verifyVariations() {
  await step('isolated real Stockfish analysis provider', async () => {
    const executablePath =
      'C:/XProgramme/stockfish/stockfish-windows-x86-64-universal.exe';
    await access(executablePath);
    await client.saveEngineProviderConfiguration('layout-stockfish', {
      expectedConfigurationRevision: null,
      input: {
        instanceId: 'layout-stockfish',
        displayName: 'Stockfish',
        providerType: 'stockfish-uci',
        executablePath,
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
    await host!.close();
    host = undefined;
    await startHost();
  });
  if (configurationRestartOnly) {
    await verifyConfigurationRestart();
    return;
  }
  if (manualOnly) {
    await launch();
    await verifyManualCorrections();
    return;
  }
  await step('native analysis without import', async () => {
    let scratch = (
      await client.updateAnalysisScratch({
        scope: free,
        expectedScratchId: null,
        expectedScratchRevision: null,
        action: { kind: 'start', origin: { kind: 'initial_position' } },
      })
    ).scratch!;
    for (const value of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']) {
      scratch = (
        await client.updateAnalysisScratch({
          scope: free,
          expectedScratchId: scratch.scratchId,
          expectedScratchRevision: scratch.scratchRevision,
          action: {
            kind: 'apply_move',
            move: { kind: 'notation', value, locale: 'en-GB' },
          },
        })
      ).scratch!;
    }
    const created = await client.createAnalysisRecord({
      scope: free,
      expectedScratchId: scratch.scratchId,
      expectedScratchRevision: scratch.scratchRevision,
      displayName: 'Opening library',
      languageTag: 'en-GB',
    });
    record = await client.getInventoryRevision(
      created.itemId,
      created.revisionId,
      { scopeKind: 'free' },
    );
  });
  await launch();
  await open();
  await step(
    'panel drag, keyboard, cancellation, limits and area persistence',
    async () => {
      const divider = page.getByRole('separator');
      await expect(divider).toHaveAttribute('aria-valuenow', '55');
      const box = (await divider.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y - 100, { steps: 8 });
      await page.mouse.up();
      const dragged = Number(await divider.getAttribute('aria-valuenow'));
      assert.ok(dragged < 55);
      await divider.press('ArrowDown');
      assert.ok(Number(await divider.getAttribute('aria-valuenow')) > dragged);
      await divider.press('Home');
      assert.equal(
        await divider.getAttribute('aria-valuenow'),
        await divider.getAttribute('aria-valuemin'),
      );
      await divider.press('End');
      assert.equal(
        await divider.getAttribute('aria-valuenow'),
        await divider.getAttribute('aria-valuemax'),
      );
      const engine = page.locator(
        'section[aria-labelledby="engine-analysis-title"]',
      );
      const groups = engine.getByRole('list');
      await expect(groups.getByRole('listitem').first()).toBeVisible();
      // Stress a wrapped provider toolbar without requiring Maia weights in this test home.
      const controls = engine.locator('select').first().locator('..');
      await controls.evaluate((element) => (element.style.minHeight = '240px'));
      assert.ok((await groups.boundingBox())!.height >= 79);
      await controls.evaluate((element) => (element.style.minHeight = ''));
      await divider.press('ArrowUp');
      const remembered = await divider.getAttribute('aria-valuenow');
      const after = (await divider.boundingBox())!;
      await page.mouse.move(
        after.x + after.width / 2,
        after.y + after.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(after.x + after.width / 2, after.y - 80, {
        steps: 5,
      });
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await expect(divider).toHaveAttribute('aria-valuenow', remembered!);
      await page
        .getByRole('navigation', { name: 'Plysmith' })
        .getByRole('button', { name: label('activity.manage'), exact: true })
        .click();
      await expect
        .poll(async () => (await client.getStartupResume()).area)
        .toBe('manage');
      await page
        .getByRole('navigation', { name: 'Plysmith' })
        .getByRole('button', { name: label('activity.analyze'), exact: true })
        .click();
      await expect(page.getByRole('separator')).toHaveAttribute(
        'aria-valuenow',
        remembered!,
      );
      await expect
        .poll(async () => (await client.getStartupResume()).area)
        .toBe('analyze');
      await page
        .getByRole('combobox', {
          name: label('positionAnalysis.budget'),
          exact: true,
        })
        .selectOption('thorough');
      await closeDesktop();
      await launch();
      await expect(
        page.getByRole('combobox', {
          name: label('positionAnalysis.budget'),
          exact: true,
        }),
      ).toHaveValue('thorough');
      await expect(page.getByRole('separator')).toHaveAttribute(
        'aria-valuenow',
        remembered!,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByRole('separator')).toHaveCount(0);
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.screenshot();
      await expect(page.getByRole('separator')).toHaveAttribute(
        'aria-valuenow',
        remembered!,
      );
      await shot('resized-panels-with-stockfish');
      // Exercise the existing save workflows at the smallest move-pane size.
      await page.getByRole('separator').press('Home');
    },
  );
  const e4 = record.steps[0]!.anchorId;
  await step(
    'scratch middle is readonly and its actual end remains playable',
    async () => {
      await page.locator(`[data-tree-anchor="${e4}"]`).click();
      await move('c7', 'c5');
      await move('g1', 'f3');
      await expect
        .poll(async () => {
          const workspace = await client.getAnalysisWorkspace({
            scopeKind: 'free',
          });
          return [workspace.scratch?.steps.length, workspace.scratch?.cursor];
        })
        .toEqual([2, 2]);
      const before = (await client.getAnalysisWorkspace({ scopeKind: 'free' }))
        .scratch!;
      await page
        .getByRole('button', {
          name: label('analysis.previousMove'),
          exact: true,
        })
        .click();
      await expect(page.getByRole('grid')).toHaveAttribute(
        'aria-readonly',
        'true',
      );
      await page.getByRole('gridcell', { name: /^g1,/ }).click();
      await expect(
        page.locator('[data-chess-board-square][aria-selected="true"]'),
      ).toHaveCount(0);
      const middle = (await client.getAnalysisWorkspace({ scopeKind: 'free' }))
        .scratch!;
      assert.equal(middle.cursor, 1);
      assert.deepEqual(middle.steps, before.steps);
      await page.getByRole('gridcell', { name: /^g1,/ }).focus();
      await page.getByRole('gridcell', { name: /^g1,/ }).press('ArrowLeft');
      await expect(page.getByRole('gridcell', { name: /^f1,/ })).toBeFocused();
      await shot('scratch-middle-readonly');
      await page
        .getByRole('button', { name: label('analysis.nextMove'), exact: true })
        .click();
      await move('d7', 'd6');
      await expect
        .poll(
          async () =>
            (await client.getAnalysisWorkspace({ scopeKind: 'free' })).scratch
              ?.cursor,
        )
        .toBe(3);
      await reviewPath();
      await page
        .getByRole('button', { name: label('analysis.discard'), exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await client.getAnalysisWorkspace({ scopeKind: 'free' })).scratch,
        )
        .toBeUndefined();
      assert.equal((await read()).revisionNumber, 1);
    },
  );
  await step(
    'create variation from board and save optional editable comment',
    async () => {
      await page.locator(`[data-tree-anchor="${e4}"]`).click();
      await move('c7', 'c5');
      await reviewPath();
      await page
        .getByRole('button', {
          name: label('inventory.mode.add_variation'),
          exact: true,
        })
        .click();
      await reviewPath();
      await page.getByLabel(label('analysis.variationComment')).check();
      await expect(
        page.getByText(label('inventory.automaticContextLosses'), {
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        page.getByLabel(label('analysis.pathNoteComment')),
      ).toHaveValue(/c5/);
      await page
        .getByLabel(label('analysis.pathNoteComment'))
        .fill('1... c5\nSicilian counterplay');
      await page
        .getByRole('button', {
          name: label('inventory.saveRevision'),
          exact: true,
        })
        .click();
      await awaitSaved(2);
      record = await read();
      assert.deepEqual(
        record.steps.map((step) => step.move.san),
        ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'],
      );
      assert.equal(record.tree?.nodes.length, 7);
      assert.ok(
        record.contributions.some(
          (note) =>
            note.body === '1... c5\nSicilian counterplay' &&
            note.moves.length === 0,
        ),
      );
    },
  );
  const c5 = record.tree!.nodes.find((node) => node.move.san === 'c5')!;
  await expect(page.locator(`[data-tree-anchor="${c5.anchorId}"]`)).toHaveCount(
    0,
  );
  await revealVariations();
  await step(
    'explicit main-line selection resets branch intent while arrows retain it',
    async () => {
      await page.locator(`[data-tree-anchor="${c5.anchorId}"]`).click();
      await page.locator(`[data-tree-anchor="${e4}"]`).click();
      await page
        .getByRole('button', { name: label('analysis.nextMove'), exact: true })
        .click();
      await expect(
        page.locator(`[data-tree-anchor="${record.steps[1]!.anchorId}"]`),
      ).toHaveAttribute('aria-current', 'step');
      await page.locator(`[data-tree-anchor="${c5.anchorId}"]`).click();
      await page
        .getByRole('button', {
          name: label('analysis.previousMove'),
          exact: true,
        })
        .click();
      await page
        .getByRole('button', { name: label('analysis.nextMove'), exact: true })
        .click();
      await expect(
        page.locator(`[data-tree-anchor="${c5.anchorId}"]`),
      ).toHaveAttribute('aria-current', 'step');
    },
  );
  await step(
    'comment-only at a stored branch anchor is an editable independent text copy',
    async () => {
      await page.locator(`[data-tree-anchor="${c5.anchorId}"]`).click();
      await expect(
        page.getByRole('button', {
          name: label('analysis.createVariation'),
          exact: true,
        }),
      ).toHaveCount(0);
      await move('g1', 'f3');
      await reviewPath();
      await page
        .getByRole('button', {
          name: label('analysis.prepareNote'),
          exact: true,
        })
        .click();
      const field = page.getByLabel(label('analysis.pathNoteComment'));
      await expect(field).toBeVisible();
      await expect(
        page
          .locator('[data-tree-draft] [data-analysis-path-actions]')
          .getByLabel(label('analysis.pathNoteComment')),
      ).toBeVisible();
      await expect(
        page.locator('[data-tree-draft] [data-tree-anchor]'),
      ).toHaveCount(0);
      await expect(field).toHaveValue(/Sf3/);
      await field.fill('2. Sf3\nFlexible development');
      await page
        .getByRole('navigation', { name: 'Plysmith' })
        .getByRole('button', { name: label('activity.manage'), exact: true })
        .click();
      await page
        .getByRole('navigation', { name: 'Plysmith' })
        .getByRole('button', { name: label('activity.analyze'), exact: true })
        .click();
      await expect(field).toHaveValue('2. Sf3\nFlexible development');
      await page
        .getByRole('button', {
          name: label('analysis.saveNoteEdit'),
          exact: true,
        })
        .click();
      await expect
        .poll(async () =>
          (await read()).contributions.some(
            (note) =>
              note.body === '2. Sf3\nFlexible development' &&
              note.anchorId === c5.anchorId &&
              note.moves.length === 0,
          ),
        )
        .toBe(true);
      assert.equal((await read()).tree?.nodes.length, 7);
      await expect(
        page.getByLabel(label('analysis.pathNoteComment')),
      ).toHaveCount(0);
    },
  );
  await step(
    'siblings remain visible when navigating and collapsing is explicit',
    async () => {
      await revealVariations();
      await page
        .locator(`[data-tree-anchor="${record.steps[1]!.anchorId}"]`)
        .click();
      await expect(
        page.locator(`[data-tree-anchor="${c5.anchorId}"]`),
      ).toBeVisible();
      await page.locator(`[data-tree-anchor="${c5.anchorId}"]`).click();
      await expect(
        page.locator(`[data-tree-anchor="${record.steps[1]!.anchorId}"]`),
      ).toBeVisible();
      const collapse = page
        .getByRole('button', {
          name: /^(Variante einklappen|Collapse variation)/,
        })
        .first();
      await collapse.click();
      await page
        .getByRole('button', {
          name: /^(Variante ausklappen|Expand variation)/,
        })
        .first()
        .click();
      await shot('branched-list-de-wide');
    },
  );
  await step('own analysis retains actual origin', async () => {
    await page.locator(`[data-tree-anchor="${c5.anchorId}"]`).click();
    await move('g1', 'f3');
    await reviewPath();
    await page
      .getByRole('button', {
        name: label('analysis.saveAsRecord'),
        exact: true,
      })
      .click();
    await expect(
      page
        .locator('[data-tree-draft] [data-analysis-path-actions]')
        .getByLabel(label('analysis.recordTitle')),
    ).toBeVisible();
    await page
      .getByLabel(label('analysis.recordTitle'))
      .fill('Sicilian development');
    await page
      .getByRole('button', {
        name: label('analysis.saveAsAnalysis'),
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Sicilian development', exact: true }),
    ).toBeVisible();
    const item = (await client.searchInventory({})).items.find(
      (item) => item.displayName === 'Sicilian development',
    )!;
    const own = await client.getInventoryRevision(
      item.itemId,
      item.currentRevisionId,
      { scopeKind: 'free' },
    );
    assert.equal(own.sourceLine?.sourceItemId, record.itemId);
    assert.equal(own.sourceLine?.sourceAnchorId, c5.anchorId);
    assert.equal((await read()).tree?.nodes.length, 7);
  });
  await open();
  await step('DE and EN small and wide viewports', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await shot('branched-list-de-small');
    await closeDesktop();
    const preferences = await client.getUserPreferences();
    await client.setUiLanguage({
      uiLocale: 'en-GB',
      expectedRevision: preferences.preferenceRevision,
    });
    locale = 'en-GB';
    await launch();
    await open();
    await shot('branched-list-en-wide');
    await page.setViewportSize({ width: 390, height: 844 });
    await shot('branched-list-en-small');
  });
  await step(
    'Host and Desktop restart preserves branches and notes',
    async () => {
      await closeDesktop();
      await host!.close();
      host = undefined;
      await startHost();
      assert.equal((await read()).tree?.nodes.length, 7);
      assert.ok(
        (await read()).contributions.some((note) =>
          note.body.includes('Sicilian counterplay'),
        ),
      );
      await launch();
      await open();
      await revealVariations();
      await expect(
        page.locator(`[data-tree-anchor="${c5.anchorId}"]`),
      ).toBeVisible();
    },
  );
  await step(
    'global variation and context-only comment remain separate across area changes',
    async () => {
      const { context } = await client.createWorkingContext({
        displayName: 'Opening training',
      });
      await client.addContextReference(context.contextId, {
        itemId: record.itemId,
        anchorId: e4,
      });
      const other = await client.createWorkingContext({
        displayName: 'Other opening training',
      });
      await client.addContextReference(other.context.contextId, {
        itemId: record.itemId,
        anchorId: record.rootAnchorId,
      });
      await page
        .getByLabel(label('scope.label'), { exact: true })
        .selectOption('context:' + context.contextId);
      await open();
      await page.locator(`[data-tree-anchor="${e4}"]`).click();

      await move('c7', 'c6');
      await move('g1', 'f3');
      await page
        .getByRole('button', {
          name: label('analysis.previousMove'),
          exact: true,
        })
        .click();
      await expect(page.getByRole('grid')).toHaveAttribute(
        'aria-readonly',
        'true',
      );
      await page.getByRole('gridcell', { name: /^g1,/ }).click();
      await expect(
        page.locator('[data-chess-board-square][aria-selected="true"]'),
      ).toHaveCount(0);
      await page
        .getByRole('button', { name: label('analysis.nextMove'), exact: true })
        .click();
      await expect(page.getByRole('grid')).toHaveAttribute(
        'aria-readonly',
        'false',
      );
      await page
        .getByRole('button', {
          name: label('analysis.takeBackLastMove'),
          exact: true,
        })
        .click();
      await saveAsVariation();
      await expect(
        page.getByRole('gridcell', { name: /^c6,/ }),
      ).toHaveAttribute('data-chess-board-occupied', 'true');
      await page.getByLabel(label('analysis.variationComment')).check();
      const comment = '1... c6\nContext-specific plan';
      await page.getByLabel(label('analysis.pathNoteComment')).fill(comment);
      await expect(page.getByRole('radio', { name: /Only in/ })).toBeChecked();
      await page
        .getByRole('navigation', { name: 'Plysmith' })
        .getByRole('button', { name: label('activity.manage'), exact: true })
        .click();
      await page
        .getByRole('navigation', { name: 'Plysmith' })
        .getByRole('button', { name: label('activity.analyze'), exact: true })
        .click();
      await reviewPath();
      await expect(
        page.getByLabel(label('analysis.pathNoteComment')),
      ).toHaveValue(comment);
      await expect(
        page.getByRole('gridcell', { name: /^c6,/ }),
      ).toHaveAttribute('data-chess-board-occupied', 'true');
      await shot('variation-context-comment');
      await page
        .getByRole('button', {
          name: label('inventory.saveRevision'),
          exact: true,
        })
        .click();
      await awaitSaved(3);
      const global = await read();
      assert.equal(global.tree?.nodes.length, 8);
      assert.equal(
        global.contributions.some((note) => note.body === comment),
        false,
      );
      const scoped = await client.getInventoryRevision(
        global.itemId,
        global.revisionId,
        { scopeKind: 'context', contextId: context.contextId },
      );
      assert.ok(
        scoped.contributions.some(
          (note) =>
            note.body === comment &&
            note.scopeKind === 'context' &&
            note.moves.length === 0,
        ),
      );
      assert.deepEqual(
        scoped.steps.map((entry) => entry.move.san),
        global.steps.map((entry) => entry.move.san),
      );
    },
  );
  await step(
    'neutral global notes, sticky context notes, silent scope and explicit editing',
    async () => {
      const globalNote = page
        .locator('article[data-note-scope="global"]')
        .filter({ hasText: 'Sicilian counterplay' });
      const contextNote = page
        .locator('article[data-note-scope="context"]')
        .filter({ hasText: 'Context-specific plan' });
      for (const [note, scopeLabel] of [
        [globalNote, label('analysis.generalNote')],
        [contextNote, label('analysis.contextNote')],
      ] as const) {
        await expect(note).toHaveAttribute('aria-label', scopeLabel);
        await expect(note.locator('time')).toHaveCount(0);
        await expect(note.getByText(scopeLabel, { exact: true })).toHaveCount(
          0,
        );
        await note
          .getByRole('button', {
            name: label('analysis.editNote'),
            exact: true,
          })
          .click();
        await expect(note.getByText(scopeLabel, { exact: true })).toBeVisible();
        await note
          .getByRole('button', { name: label('analysis.cancel'), exact: true })
          .click();
        await expect(note.getByText(scopeLabel, { exact: true })).toHaveCount(
          0,
        );
      }
      assert.deepEqual(
        await globalNote.evaluate((element) => ({
          background:
            element.ownerDocument.defaultView!.getComputedStyle(element)
              .backgroundColor,
          text: element.ownerDocument.defaultView!.getComputedStyle(
            element.querySelector('p')!,
          ).color,
        })),
        { background: 'rgb(245, 246, 248)', text: 'rgb(66, 75, 86)' },
      );
      assert.deepEqual(
        await contextNote.evaluate((element) => ({
          background:
            element.ownerDocument.defaultView!.getComputedStyle(element)
              .backgroundColor,
          text: element.ownerDocument.defaultView!.getComputedStyle(
            element.querySelector('p')!,
          ).color,
        })),
        { background: 'rgb(255, 247, 223)', text: 'rgb(73, 58, 28)' },
      );
      await page
        .getByRole('button', {
          name: label('analysis.addNoteAtPathStart'),
          exact: true,
        })
        .click();
      const draft = page.locator('article[data-note-draft-scope]');
      await expect(draft).toHaveAttribute('data-note-draft-scope', 'context');
      await draft
        .getByText(label('analysis.generalNote'), { exact: true })
        .click();
      await expect(
        draft.getByRole('radio', {
          name: label('analysis.generalNote'),
          exact: true,
        }),
      ).toBeChecked();
      await expect(draft).toHaveAttribute('data-note-draft-scope', 'global');
      assert.equal(
        await draft.evaluate(
          (element) =>
            element.ownerDocument.defaultView!.getComputedStyle(element)
              .backgroundColor,
        ),
        'rgb(245, 246, 248)',
      );
      await draft
        .getByRole('button', { name: label('analysis.cancel'), exact: true })
        .click();
      await page.getByRole('separator').press('End');
      await page
        .getByRole('region', { name: label('analysis.moveList'), exact: true })
        .evaluate((element) => (element.scrollTop = 0));
      await shot('neutral-and-context-notes');
      await page.setViewportSize({ width: 1024, height: 768 });
      await shot('panels-medium');
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByRole('separator')).toHaveCount(0);
      await shot('notes-small');
    },
  );
  await step(
    'nested native drafts and branches stay inside their owning variation',
    async () => {
      await page.setViewportSize({ width: 1600, height: 1000 });
      await revealVariations();
      await page.locator(`[data-tree-anchor="${c5.anchorId}"]`).click();

      await move('g1', 'f3');
      await move('d7', 'd6');
      const parentLine = page.locator(`[data-tree-line="${c5.anchorId}"]`);
      await expect(parentLine.locator('[data-tree-draft]')).toHaveCount(1);
      await expect(page.locator('[data-tree-draft]')).toHaveCount(1);
      await expect(
        parentLine.locator('[data-analysis-path-actions]'),
      ).toHaveCount(1);
      await saveAsVariation();
      await page
        .getByRole('button', {
          name: label('inventory.saveRevision'),
          exact: true,
        })
        .click();
      await awaitSaved(4);
      record = await read();
      await revealVariations();
      const nested = record.tree!.nodes.find(
        (node) =>
          node.parentNodeIndex === c5.nodeIndex && node.move.san === 'Nf3',
      )!;
      assert.ok(nested);
      assert.equal(nested.siblingOrder, 1);
      const nestedLine = parentLine.locator(
        `[data-tree-line="${nested.anchorId}"]`,
      );
      assert.ok(
        await parentLine
          .locator(`[data-tree-anchor="${c5.anchorId}"]`)
          .evaluate((element) =>
            element.closest('li')!.textContent!.trim().startsWith('1...'),
          ),
      );
      await expect(nestedLine).toHaveCount(1);
      await nestedLine
        .locator(`[data-tree-anchor="${nested.anchorId}"]`)
        .click();

      await move('b8', 'c6');
      await expect(nestedLine.locator('[data-tree-draft]')).toHaveCount(1);
      await saveAsVariation();
      await page
        .getByRole('button', {
          name: label('inventory.saveRevision'),
          exact: true,
        })
        .click();
      await awaitSaved(5);
      record = await read();
      await revealVariations();
      const deep = record.tree!.nodes.find(
        (node) =>
          node.parentNodeIndex === nested.nodeIndex && node.move.san === 'Nc6',
      )!;
      assert.ok(deep);
      await expect(
        nestedLine.locator(`[data-tree-line="${deep.anchorId}"]`),
      ).toHaveCount(1);
      const anchors = await page
        .locator('[data-tree-anchor]')
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-tree-anchor')),
        );
      assert.equal(new Set(anchors).size, record.tree!.nodes.length);
      assert.equal(anchors.length, record.tree!.nodes.length);
      assert.ok(
        anchors.indexOf(c5.anchorId) >
          anchors.indexOf(record.steps[1]!.anchorId),
      );
      assert.ok(
        anchors.indexOf(deep.anchorId) <
          anchors.indexOf(record.steps[2]!.anchorId),
      );
      await page.getByRole('separator').press('End');
      await parentLine
        .getByRole('button', { name: /^Collapse variation: 1\.\.\. c5$/ })
        .click();
      await expect(
        page.locator(`[data-tree-line="${deep.anchorId}"]`),
      ).toHaveCount(0);
      await expect(
        page.locator(`[data-tree-anchor="${record.steps[2]!.anchorId}"]`),
      ).toBeVisible();
      await parentLine
        .getByRole('button', { name: /^Expand variation: 1\.\.\. c5$/ })
        .click();
      await expect(
        nestedLine.locator(`[data-tree-line="${deep.anchorId}"]`),
      ).toHaveCount(1);
      await shot('inline-nested-variations-wide');
      await page.setViewportSize({ width: 390, height: 844 });
      await shot('inline-nested-variations-small');
    },
  );
  await step(
    'Manage preview pairs half-moves, nests variants and navigates canonical positions',
    async () => {
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page
        .getByRole('navigation', { name: 'Plysmith' })
        .getByRole('button', { name: label('activity.manage'), exact: true })
        .click();
      const row = page
        .locator('li[draggable="true"]')
        .filter({ has: page.getByText(record.displayName, { exact: true }) });
      const selection = row.getByRole('button', {
        name: /^Opening library Analysis/,
      });
      if ((await selection.getAttribute('aria-pressed')) !== 'true')
        await selection.click();
      const preview = page.locator('[data-inventory-content-preview]');
      await expect(preview).toBeVisible();
      await revealVariations(preview);
      const pair = preview.locator('[data-tree-move-pair]').first();
      await expect(pair.locator('[data-tree-anchor]')).toHaveCount(2);
      const boxes = await pair.locator('[data-tree-anchor]').all();
      const first = (await boxes[0]!.boundingBox())!;
      const second = (await boxes[1]!.boundingBox())!;
      assert.equal(first.y, second.y);
      assert.ok(second.x >= first.x + first.width - 1);
      await preview.locator(`[data-tree-anchor="${c5.anchorId}"]`).click();
      await expect(
        preview.locator(`[data-tree-anchor="${c5.anchorId}"]`),
      ).toHaveAttribute('aria-current', 'step');
      await expect(
        preview.getByRole('gridcell', { name: /^c5, Black pawn$/ }),
      ).toBeVisible();
      await preview
        .getByRole('button', {
          name: label('analysis.previousMove'),
          exact: true,
        })
        .click();
      await expect(
        preview.locator(`[data-tree-anchor="${e4}"]`),
      ).toHaveAttribute('aria-current', 'step');
      await shot('compact-preview-wide');
      await page.setViewportSize({ width: 390, height: 844 });
      await shot('compact-preview-small');
      await closeDesktop();
      await host!.close();
      host = undefined;
      await startHost();
      await launch();
      assert.equal((await read()).tree!.nodes.length, 11);
    },
  );
  await step(
    'takeback on the last variation move protects context notes and preserves siblings',
    async () => {
      await open();
      await revealVariations();
      record = await read();
      const c5Child = record.tree!.nodes.find(
        (node) =>
          node.parentNodeIndex === c5.nodeIndex && node.move.san === 'Nf3',
      )!;
      const deep = record.tree!.nodes.find(
        (node) =>
          node.parentNodeIndex === c5Child.nodeIndex && node.move.san === 'Nc6',
      )!;
      const historicalRevision = record.revisionId;
      await page.locator(`[data-tree-anchor="${deep.anchorId}"]`).click();
      await page
        .locator(`[data-tree-anchor="${deep.anchorId}"]`)
        .locator('..')
        .getByRole('button', { name: label('analysis.addNote'), exact: true })
        .click();
      await page
        .getByRole('textbox', { name: label('analysis.newNote'), exact: true })
        .fill('Do not lose this context-specific variation note.');
      await page
        .getByRole('button', {
          name: label('analysis.saveNoteEdit'),
          exact: true,
        })
        .click();
      await expect(
        page.locator('article[data-note-scope]').filter({
          hasText: 'Do not lose this context-specific variation note.',
        }),
      ).toBeVisible();
      await expect(page.locator('article[data-note-draft-scope]')).toHaveCount(
        0,
      );
      await page
        .getByRole('button', {
          name: label('analysis.takeBackLastMove'),
          exact: true,
        })
        .click();
      await reviewPath();
      await expect(
        page.getByText(
          /The note at a removed position will be removed from this working context/,
        ),
      ).toBeVisible();
      await expect(
        page.locator('[data-tree-draft] [data-analysis-path-actions]'),
      ).toHaveCount(1);
      await shot('variation-takeback-with-note-protection');
      await page
        .getByRole('button', {
          name: label('inventory.saveRevision'),
          exact: true,
        })
        .click();
      await awaitSaved(6);
      record = await read();
      assert.equal(record.tree!.nodes.length, 10);
      assert.equal(
        record.tree!.nodes.some((node) => node.anchorId === deep.anchorId),
        false,
      );
      assert.ok(record.tree!.nodes.some((node) => node.move.san === 'c6'));
      const scope = await client.getStartupResume();
      assert.equal(scope.scope.kind, 'context');
      const historical = await client.getInventoryRevision(
        record.itemId,
        historicalRevision,
        {
          scopeKind: 'context',
          contextId:
            scope.scope.kind === 'context' ? scope.scope.contextId : '',
        },
      );
      assert.equal(
        historical.contributions.some(
          (note) =>
            note.body === 'Do not lose this context-specific variation note.',
        ),
        false,
      );
      const database = new Database(
        path.join(applicationHome, 'data', 'plysmith.db'),
        { readonly: true },
      );
      try {
        assert.deepEqual(
          database
            .prepare('SELECT status FROM workspace_contribution WHERE body = ?')
            .get('Do not lose this context-specific variation note.'),
          { status: 'archived' },
        );
      } finally {
        database.close();
      }
      assert.equal(historical.tree!.nodes.length, 11);
    },
  );
  await step(
    'delete a whole nested variation from its symbol row without changing the main line',
    async () => {
      await revealVariations();
      const nested = record.tree!.nodes.find(
        (node) =>
          node.parentNodeIndex === c5.nodeIndex && node.move.san === 'Nf3',
      )!;
      await page
        .locator(`[data-tree-line="${nested.anchorId}"]`)
        .getByRole('button', {
          name: /^Delete variation:/,
        })
        .click();
      await reviewPath();
      await expect(
        page.locator('[data-tree-draft] [data-analysis-path-actions]'),
      ).toHaveCount(1);
      await page
        .getByRole('button', {
          name: label('inventory.saveRevision'),
          exact: true,
        })
        .click();
      await awaitSaved(7);
      record = await read();
      assert.equal(record.tree!.nodes.length, 8);
      assert.deepEqual(
        record.steps.map((entry) => entry.move.san),
        ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'],
      );
      await expect(
        page.locator(`[data-tree-anchor="${c5.anchorId}"]`),
      ).toHaveCount(0);
    },
  );
  await step(
    'delete a collapsed parent variation, then restart with the remaining main line and sibling',
    async () => {
      await page
        .locator(`[data-tree-line="${c5.anchorId}"]`)
        .getByRole('button', {
          name: /^Delete variation:/,
        })
        .click();
      await reviewPath();
      await page
        .getByRole('button', {
          name: label('inventory.saveRevision'),
          exact: true,
        })
        .click();
      await awaitSaved(8);
      record = await read();
      assert.equal(record.tree!.nodes.length, 7);
      assert.equal(
        record.tree!.nodes.some((node) => node.move.san === 'c5'),
        false,
      );
      assert.ok(record.tree!.nodes.some((node) => node.move.san === 'c6'));
      for (let cycle = 0; cycle < 3; cycle += 1) {
        await closeDesktop();
        await host!.close();
        host = undefined;
        await startHost();
        await launch();
        await open();
        assert.equal((await read()).tree!.nodes.length, 7);
      }
      await expect(
        page.getByRole('button', { name: /^Expand variation: 1\.\.\. c6$/ }),
      ).toBeVisible();
      await expect(page.locator('[data-tree-anchor]')).toHaveCount(6);
      await shot('quiet-main-line-after-variation-deletion');
      assert.deepEqual(errors, []);
    },
  );
  await step(
    'metadata rename shows real draft loss before saving and stays direct without loss',
    async () => {
      const root = (
        await client.updateAnalysisScratch({
          scope: free,
          expectedScratchId: null,
          expectedScratchRevision: null,
          action: { kind: 'start', origin: { kind: 'initial_position' } },
        })
      ).scratch!;
      const created = await client.createAnalysisRecord({
        scope: free,
        expectedScratchId: root.scratchId,
        expectedScratchRevision: root.scratchRevision,
        displayName: 'Rename loss check',
        languageTag: 'en-GB',
      });
      record = await client.getInventoryRevision(
        created.itemId,
        created.revisionId,
        { scopeKind: 'free' },
      );
      const { context } = await client.createWorkingContext({
        displayName: 'Rename training',
      });
      await client.addContextReference(context.contextId, {
        itemId: record.itemId,
        anchorId: record.rootAnchorId,
      });
      const competing = await client.startInventoryRevision(record.itemId, {
        scope: { kind: 'context', contextId: context.contextId },
        baseRevisionId: record.revisionId,
        anchorId: record.rootAnchorId,
        mode: 'metadata',
        displayName: 'Unsaved training name',
        expectedScratchId: null,
        expectedScratchRevision: null,
      });
      await page
        .getByLabel(label('scope.label'), { exact: true })
        .selectOption('context:' + context.contextId);
      await page
        .getByRole('navigation', { name: 'Plysmith' })
        .getByRole('button', { name: label('activity.manage'), exact: true })
        .click();
      const rename = async (name: string) => {
        await page
          .locator('li[draggable="true"]')
          .filter({ has: page.getByText(record.displayName, { exact: true }) })
          .getByRole('button', { name: label('inventory.rename'), exact: true })
          .click();
        await page
          .getByLabel(label('inventory.displayName'), { exact: true })
          .fill(name);
        await page
          .getByRole('button', {
            name: label('inventory.saveRevision'),
            exact: true,
          })
          .click();
      };
      await rename('Reviewed rename');
      await expect(
        page.getByText(label('inventory.automaticContextLosses'), {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText('1 unsaved analysis with changes will be discarded.', {
          exact: true,
        }),
      ).toBeVisible();
      assert.equal((await read()).revisionNumber, 1);
      assert.equal(
        (
          await client.getAnalysisWorkspace({
            scopeKind: 'context',
            contextId: context.contextId,
          })
        ).scratch?.scratchId,
        competing.scratch.scratchId,
      );
      await shot('metadata-rename-real-draft-loss');
      await page
        .getByRole('button', {
          name: label('inventory.saveRevision'),
          exact: true,
        })
        .click();
      await expect.poll(async () => (await read()).revisionNumber).toBe(2);
      assert.equal(
        (
          await client.getAnalysisWorkspace({
            scopeKind: 'context',
            contextId: context.contextId,
          })
        ).scratch,
        undefined,
      );
      record = await read();
      await rename('Harmless rename');
      await expect.poll(async () => (await read()).revisionNumber).toBe(3);
      await expect(
        page.getByText(label('inventory.automaticContextLosses'), {
          exact: true,
        }),
      ).toHaveCount(0);
      await shot('metadata-rename-without-noise');
    },
  );
  await step(
    'metadata form retains edited fields across a real external revision refresh',
    async () => {
      record = await read();
      await page
        .getByLabel(label('scope.label'), { exact: true })
        .selectOption('free');
      await page
        .getByRole('navigation', { name: 'Plysmith' })
        .getByRole('button', { name: label('activity.manage'), exact: true })
        .click();
      await page
        .locator('li[draggable="true"]')
        .filter({ has: page.getByText(record.displayName, { exact: true }) })
        .getByRole('button', { name: label('inventory.rename'), exact: true })
        .click();
      assert.equal(locale, 'en-GB');
      await expect(
        page.getByRole('button', { name: 'Dismiss', exact: true }).first(),
      ).toBeAttached();
      await expect(
        page.getByRole('button', { name: 'Schließen', exact: true }),
      ).toHaveCount(0);
      const name = page.getByRole('textbox', {
        name: label('inventory.displayName'),
        exact: true,
      });
      const summary = page.getByRole('textbox', {
        name: label('inventory.summary'),
        exact: true,
      });
      await name.fill('Preserved local title');
      await summary.fill('Preserved local summary');
      const external = await client.startInventoryRevision(record.itemId, {
        scope: free,
        baseRevisionId: record.revisionId,
        anchorId: record.rootAnchorId,
        mode: 'metadata',
        displayName: 'Remote metadata title',
        summary: 'Remote metadata summary',
        expectedScratchId: null,
        expectedScratchRevision: null,
      });
      const request = {
        scope: free,
        expectedScratchId: external.scratch.scratchId,
        expectedScratchRevision: external.scratch.scratchRevision,
      };
      const preview = await client.previewInventoryRevision(request);
      const saved = await client.saveInventoryRevision({
        ...request,
        previewFingerprint: preview.previewFingerprint,
      });
      await page
        .getByText('Remote metadata title', { exact: true })
        .first()
        .waitFor();
      await expect(name).toHaveValue('Preserved local title');
      await expect(summary).toHaveValue('Preserved local summary');
      await shot('metadata-local-input-after-remote-refresh');
      const save = page.getByRole('button', {
        name: label('inventory.saveRevision'),
        exact: true,
      });
      await expect(save).toBeEnabled();
      await save.click();
      await expect
        .poll(async () => (await read()).revisionNumber)
        .toBe(saved.revisionNumber + 1);
      record = await read();
      assert.equal(record.displayName, 'Preserved local title');
      assert.equal(record.summary, 'Preserved local summary');
    },
  );
  await step(
    'stopped playout form survives area and context switches and saves the visible result',
    async () => {
      const { context } = await client.createWorkingContext({
        displayName: 'Playout form retention',
      });
      const scope = { kind: 'context', contextId: context.contextId } as const;
      await client.addContextReference(context.contextId, {
        itemId: record.itemId,
        anchorId: record.rootAnchorId,
      });
      await client.startPlayout({
        scope,
        start: { kind: 'initial_position' },
        providerInstanceId: 'layout-stockfish',
        capability: 'best_move',
        opening: {
          kind: 'user_move',
          move: { kind: 'notation', value: 'e4', locale: 'en-GB' },
        },
      });
      await expect
        .poll(
          async () =>
            (
              await client.getPlayout({
                scopeKind: 'context',
                contextId: context.contextId,
              })
            )?.draft.status.kind,
          { timeout: 30000 },
        )
        .toBe('active');
      const active = (await client.getPlayout({
        scopeKind: 'context',
        contextId: context.contextId,
      }))!;
      await client.stopPlayout({
        scope,
        draftId: active.draft.draftId,
        expectedDraftRevision: active.draft.draftRevision,
      });
      const scopePicker = page.getByLabel(label('scope.label'), {
        exact: true,
      });
      await scopePicker.selectOption('context:' + context.contextId);
      const navigation = page.getByRole('navigation', { name: 'Plysmith' });
      await navigation
        .getByRole('button', { name: label('activity.playout'), exact: true })
        .click();
      const title = page.getByRole('textbox', {
        name: label('playout.gameTitle'),
        exact: true,
      });
      const result = page.getByRole('combobox', {
        name: label('inventory.content.outcome'),
        exact: true,
      });
      const membership = page.getByRole('checkbox', {
        name: label('playout.addToContext'),
        exact: true,
      });
      await title.fill('Retained playout result');
      await result.selectOption('draw');
      await membership.uncheck();
      await navigation
        .getByRole('button', { name: label('activity.manage'), exact: true })
        .click();
      await navigation
        .getByRole('button', { name: label('activity.playout'), exact: true })
        .click();
      await expect(title).toHaveValue('Retained playout result');
      await expect(result).toHaveValue('draw');
      await expect(membership).not.toBeChecked();
      await scopePicker.selectOption('free');
      await scopePicker.selectOption('context:' + context.contextId);
      await expect(title).toHaveValue('Retained playout result');
      await expect(result).toHaveValue('draw');
      await expect(membership).not.toBeChecked();
      await shot('playout-form-retained');
      await page
        .getByRole('button', { name: label('playout.save'), exact: true })
        .click();
      await expect
        .poll(async () =>
          (await client.searchInventory({})).items.some(
            (item) => item.displayName === 'Retained playout result',
          ),
        )
        .toBe(true);
      const item = (await client.searchInventory({})).items.find(
        (entry) => entry.displayName === 'Retained playout result',
      )!;
      const saved = await client.getInventoryRevision(
        item.itemId,
        item.currentRevisionId,
        {
          scopeKind: 'context',
          contextId: context.contextId,
        },
      );
      assert.deepEqual(saved.game?.outcome, { kind: 'draw' });
      assert.equal(saved.game?.outcomeSource, 'manual');
      assert.equal(saved.contextMember, false);
      assert.equal(
        await client.getPlayout({
          scopeKind: 'context',
          contextId: context.contextId,
        }),
        null,
      );
      await shot('playout-form-saved');
    },
  );
  await verifyManualCorrections();
}
async function verifyManualCorrections() {
  await step(
    'reentered prefix preserves notes and displays only the actual extension',
    async () => {
      await page
        .getByLabel(label('scope.label'), { exact: true })
        .selectOption('free');
      let scratch = (
        await client.updateAnalysisScratch({
          scope: free,
          expectedScratchId: null,
          expectedScratchRevision: null,
          action: { kind: 'start', origin: { kind: 'initial_position' } },
        })
      ).scratch!;
      for (const value of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']) {
        scratch = (
          await client.updateAnalysisScratch({
            scope: free,
            expectedScratchId: scratch.scratchId,
            expectedScratchRevision: scratch.scratchRevision,
            action: {
              kind: 'apply_move',
              move: { kind: 'notation', value, locale: 'en-GB' },
            },
          })
        ).scratch!;
      }
      const created = await client.createAnalysisRecord({
        scope: free,
        expectedScratchId: scratch.scratchId,
        expectedScratchRevision: scratch.scratchRevision,
        displayName: 'Reentered prefix',
        languageTag: 'en-GB',
      });
      record = await client.getInventoryRevision(
        created.itemId,
        created.revisionId,
        { scopeKind: 'free' },
      );
      const lastAnchor = record.steps.at(-1)!.anchorId;
      await client.createPositionNote({
        scope: free,
        itemId: record.itemId,
        revisionId: record.revisionId,
        anchorId: lastAnchor,
        body: 'Keep this annotation',
        languageTag: 'en-GB',
        noteScope: { kind: 'global' },
      });
      await open();
      await page
        .getByRole('combobox', {
          name: label('positionAnalysis.budget'),
          exact: true,
        })
        .selectOption('thorough');
      await page.locator(`[data-tree-anchor="${lastAnchor}"]`).click();
      await page
        .getByRole('button', {
          name: label('analysis.takeBackLastMove'),
          exact: true,
        })
        .click();
      await move('f8', 'c5');
      await move('h2', 'h3');
      await reviewPath();
      await expect(page.locator('#revision-actions-title')).toHaveText(
        label('inventory.mode.extend'),
      );
      await expect(
        page.getByText(locale === 'de-DE' ? '1 neuer Zug' : '1 new move', {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.locator('del')).toHaveCount(0);
      await expect(page.locator('ins')).toHaveCount(1);
      await expect(page.locator('ins')).toContainText('h3');
      await expect(
        page.locator('[data-tree-draft] [data-path-position]'),
      ).toHaveCount(1);
      await page
        .getByRole('button', {
          name: label('analysis.previousMove'),
          exact: true,
        })
        .click();
      await expect(
        page.locator(`[data-tree-anchor="${lastAnchor}"]`),
      ).toHaveAttribute('aria-current', 'step');
      await page
        .getByRole('button', { name: label('analysis.nextMove'), exact: true })
        .click();
      await expect(
        page.getByText(/(allgemeine Notiz bleibt|general note remains)/),
      ).toHaveCount(0);
      await shot('reentered-prefix-review');
      await page
        .getByRole('button', {
          name: label('inventory.saveRevision'),
          exact: true,
        })
        .click();
      await awaitSaved(2);
      const saved = await read();
      assert.equal(saved.steps[5]!.anchorId, lastAnchor);
      assert.equal(
        saved.contributions.filter(
          (note) =>
            note.anchorId === lastAnchor &&
            note.body === 'Keep this annotation',
        ).length,
        1,
      );
      await closeDesktop();
      await host!.close();
      host = undefined;
      await startHost();
      await launch();
      await open();
      await expect(
        page.getByRole('combobox', {
          name: label('positionAnalysis.budget'),
          exact: true,
        }),
      ).toHaveValue('thorough');
      assert.equal(
        (await read()).contributions.filter(
          (note) => note.body === 'Keep this annotation',
        ).length,
        1,
      );
    },
  );
  await step(
    'Stockfish detail-level draft defaults and responsive settings',
    async () => {
      await page
        .getByRole('button', { name: label('activity.settings'), exact: true })
        .click();
      await page
        .getByRole('button', {
          name: label('engines.addStockfish'),
          exact: true,
        })
        .click();
      for (const [id, value] of Object.entries({
        'engine-fast': '500',
        'engine-thorough': '1500',
        'engine-very_deep': '5000',
        'engine-threads': '2',
        'engine-hashMb': '64',
        'engine-playoutBudget': 'thorough',
      })) {
        await expect(page.locator('#' + id)).toHaveValue(value);
      }
      await shot('stockfish-detail-levels-wide');
      await page.setViewportSize({ width: 390, height: 844 });
      await shot('stockfish-detail-levels-small');
      await page
        .getByRole('button', { name: label('engines.discard'), exact: true })
        .click();
    },
  );
}
async function verifyConfigurationRestart() {
  const active = path.join(applicationHome, 'configuration/active');
  const centralPath = path.join(active, 'plysmith.json');
  const secretPath = path.join(applicationHome, '.env');
  const executablePath =
    'C:/XProgramme/stockfish/stockfish-windows-x86-64-universal.exe';
  let contextId: string;
  let scratchBefore: unknown;
  const settings = () =>
    page.locator('section[aria-labelledby="engine-title"]');
  await step(
    'invalid setup automatically becomes a complete fresh installation without losing database work',
    async () => {
      const started = await client.updateAnalysisScratch({
        scope: free,
        expectedScratchId: null,
        expectedScratchRevision: null,
        action: { kind: 'start', origin: { kind: 'initial_position' } },
      });
      const saved = await client.createAnalysisRecord({
        scope: free,
        expectedScratchId: started.scratch!.scratchId,
        expectedScratchRevision: started.scratch!.scratchRevision,
        displayName: 'Preserved fresh-setup analysis',
        languageTag: 'en-GB',
      });
      record = await client.getInventoryRevision(
        saved.itemId,
        saved.revisionId,
        { scopeKind: 'free' },
      );
      await client.createPositionNote({
        scope: free,
        itemId: record.itemId,
        revisionId: record.revisionId,
        anchorId: record.rootAnchorId,
        body: 'Preserve my work, not old engine settings',
        languageTag: 'en-GB',
        noteScope: { kind: 'global' },
      });
      const { context } = await client.createWorkingContext({
        displayName: 'Preserved working context',
      });
      contextId = context.contextId;
      await client.addContextReference(contextId, {
        itemId: record.itemId,
        anchorId: record.rootAnchorId,
      });
      let scratch = (
        await client.updateAnalysisScratch({
          scope: { kind: 'context', contextId },
          expectedScratchId: null,
          expectedScratchRevision: null,
          action: { kind: 'start', origin: { kind: 'initial_position' } },
        })
      ).scratch!;
      scratch = (
        await client.updateAnalysisScratch({
          scope: { kind: 'context', contextId },
          expectedScratchId: scratch.scratchId,
          expectedScratchRevision: scratch.scratchRevision,
          action: {
            kind: 'apply_move',
            move: { kind: 'notation', value: 'e4', locale: 'en-GB' },
          },
        })
      ).scratch!;
      scratchBefore = scratch;
      await host!.close();
      host = undefined;
      const central = JSON.parse(await readFile(centralPath, 'utf8'));
      central.bindings.analysisEngines.push('stockfish');
      central.bindings.playoutEngines.push('stockfish');
      central.diagnostics.logging.level = 'debug';
      await writeFile(centralPath, JSON.stringify(central));
      await writeFile(
        path.join(active, 'stockfish.json'),
        '{ unsupported configuration',
      );
      await writeFile(
        path.join(active, 'unbound-old-maia.json'),
        '{ unsupported configuration',
      );
      await writeFile(secretPath, 'UNUSED_TEST_SECRET=isolated-fixture\n');
      await startHost();
      await launch();
      await page
        .getByRole('button', { name: label('activity.settings'), exact: true })
        .click();
      assert.deepEqual((await readdir(active)).sort(), [
        'plysmith.json',
        'sqlite-main.json',
      ]);
      for (const name of ['plysmith.json', 'sqlite-main.json'])
        assert.deepEqual(
          JSON.parse(await readFile(path.join(active, name), 'utf8')),
          JSON.parse(
            await readFile(
              path.join(repo, 'configuration/defaults', name),
              'utf8',
            ),
          ),
        );
      await assert.rejects(access(secretPath), { code: 'ENOENT' });
      assert.equal(
        (await client.getDiagnosticSettings()).configuredLevel,
        'off',
      );
      assert.deepEqual(
        (await client.getAnalysisWorkspace({ scopeKind: 'context', contextId }))
          .scratch,
        scratchBefore,
      );
      assert.equal(
        (await read()).contributions[0]!.body,
        'Preserve my work, not old engine settings',
      );
      assert.equal(
        (await client.listWorkingContexts({})).contexts.find(
          (context) => context.contextId === contextId,
        )?.displayName,
        'Preserved working context',
      );
      await expect(settings().getByRole('alert')).toHaveCount(0);
      await expect(page.locator('#engine-executablePath')).toHaveCount(0);
      await expect(
        page.getByRole('button', {
          name: /^(Konfiguration neu einrichten|Zurücksetzen|Reset|Set up configuration again)$/,
        }),
      ).toHaveCount(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await shot('configuration-fresh-start-wide');
      await page.setViewportSize({ width: 390, height: 844 });
      await shot('configuration-fresh-start-small');
      await page.setViewportSize({ width: 1600, height: 1000 });
    },
  );
  await step(
    'same-name Stockfish saves normally with fresh current defaults',
    async () => {
      await settings()
        .getByRole('button', {
          name: label('engines.addStockfish'),
          exact: true,
        })
        .click();
      for (const [id, value] of Object.entries({
        'engine-fast': '500',
        'engine-thorough': '1500',
        'engine-very_deep': '5000',
        'engine-threads': '2',
        'engine-playoutBudget': 'thorough',
      }))
        await expect(page.locator('#' + id)).toHaveValue(value);
      await app!.evaluate(({ dialog }, filePath) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [filePath],
        });
      }, executablePath);
      await settings()
        .getByRole('button', { name: label('engines.choose'), exact: true })
        .click();
      await expect(page.locator('#engine-executablePath')).toHaveValue(
        executablePath,
      );
      await settings()
        .getByRole('button', { name: label('engines.save'), exact: true })
        .click();
      await expect(
        settings().getByRole('button', {
          name: label('engines.save'),
          exact: true,
        }),
      ).toBeDisabled();
      const providers = (await client.getEngineProviderConfigurations())
        .providers;
      assert.equal(providers.length, 1);
      assert.equal(providers[0]!.instanceId, 'stockfish');
      assert.equal(
        JSON.parse(await readFile(path.join(active, 'stockfish.json'), 'utf8'))
          .schemaVersion,
        2,
      );
      await shot('configuration-fresh-stockfish');
    },
  );
  await step(
    'valid new setup survives Host and Desktop restart with Stockfish and work intact',
    async () => {
      const before = await Promise.all(
        ['plysmith.json', 'sqlite-main.json', 'stockfish.json'].map((name) =>
          readFile(path.join(active, name)),
        ),
      );
      await closeDesktop();
      await host!.close();
      host = undefined;
      await startHost();
      await launch();
      assert.deepEqual(
        await Promise.all(
          ['plysmith.json', 'sqlite-main.json', 'stockfish.json'].map((name) =>
            readFile(path.join(active, name)),
          ),
        ),
        before,
      );
      const provider = (await client.listPositionAnalysisProviders())
        .providers[0]!;
      assert.equal(provider.instanceId, 'stockfish');
      assert.equal(provider.status, 'available');
      assert.deepEqual(
        (await client.getAnalysisWorkspace({ scopeKind: 'context', contextId }))
          .scratch,
        scratchBefore,
      );
      assert.equal(
        (await read()).contributions[0]!.body,
        'Preserve my work, not old engine settings',
      );
      await open();
      await expect(
        page
          .locator('section[aria-labelledby="engine-analysis-title"]')
          .getByRole('list')
          .first()
          .getByRole('listitem')
          .first(),
      ).toBeVisible();
      await shot('configuration-valid-after-restart');
    },
  );
}
try {
  await startHost();
  if (draftsOnly) await verifyFormDrafts();
  else await verifyVariations();
} finally {
  await closeDesktop();
  await host?.close();
  await writeFile(
    path.join(artifacts, 'proof.json'),
    JSON.stringify(
      {
        applicationHome,
        steps,
        errors,
        screenshots,
        limits: [
          'No human screen-reader acceptance claimed. All processes and data are isolated.',
        ],
      },
      null,
      2,
    ),
  );
}
