// Opt-in, explicitly disposable development inventory; never writes SQL or configuration.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { _electron as electron, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import {
  parseFenBoard,
  pieceName,
} from '../app/infrastructure/channels/ui/renderer/chess-display.ts';
import type {
  AnalysisWorkspaceDto,
  CreateAnalysisRecordResultDto,
  SearchInventoryResultDto,
  UpdateAnalysisScratchRequestDto,
  UpdateAnalysisScratchResultDto,
  CreateWorkingContextResultDto,
  StartupResumeDto,
  ListMovePolicyProvidersResultDto,
  PlayoutDto,
  CompletePlayoutResultDto,
  ListWorkingContextsResultDto,
  WorkingContextWorkspaceDto,
} from '../app/infrastructure/channels/host_client/index.ts';

const mode = process.argv[2];
assert.ok(
  mode === 'reproduce' ||
    mode === 'seed' ||
    mode === 'check' ||
    mode === 'inspect' ||
    mode === 'finish' ||
    mode === 'snapshot',
);
const home = process.cwd();
const artifacts = path.resolve('build/verification/library-acceptance');
await mkdir(artifacts, { recursive: true });
const client = new Client({ name: 'library-acceptance', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['app/bootstrap/mcp/main.ts', '--application-home', home],
  stderr: 'pipe',
});
const free = { kind: 'free' } as const;
type Scope = UpdateAnalysisScratchRequestDto['scope'];
type Scratch = NonNullable<AnalysisWorkspaceDto['scratch']>;
type RecordView = NonNullable<AnalysisWorkspaceDto['record']>;
interface FamilyProof {
  readonly root: RecordView;
  readonly members: readonly RecordView[];
  readonly favorite: RecordView;
  readonly game: CompletePlayoutResultDto;
  readonly contextId: string;
  readonly scratch: Scratch;
}
interface AcceptanceProof {
  readonly families: readonly FamilyProof[];
  readonly freeScratch: Scratch;
}
const proofPath = path.join(artifacts, 'proof.json');
let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
const pageErrors: string[] = [];

async function call<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const response = await client.callTool({ name, arguments: args });
  assert.notEqual(
    response.isError,
    true,
    `${name}: ${JSON.stringify(response.content)}`,
  );
  assert.ok(response.structuredContent);
  return response.structuredContent as T;
}

async function launch(): Promise<Page> {
  application = await electron.launch({
    executablePath: path.join(home, 'node_modules/electron/dist/electron.exe'),
    args: [
      path.join(home, 'build/desktop/main.mjs'),
      '--application-home',
      home,
      '--install-root',
      home,
    ],
    cwd: home,
  });
  const page = await application.firstWindow();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.getByRole('navigation', { name: 'Plysmith' }).waitFor();
  await page.getByText('Verbunden', { exact: true }).waitFor();
  return page;
}

async function accessibleScreenshot(page: Page, name: string) {
  await page.evaluate('window.scrollTo(0, 0)');
  await page.evaluate('document.fonts.ready');
  const board = page.getByRole('grid', { name: 'Schachbrett', exact: true });
  if ((await board.count()) > 0) {
    assert.equal(await board.getByRole('gridcell').count(), 64);
    const cell = await board.getByRole('gridcell').first().boundingBox();
    assert.ok(
      cell && cell.width > 20 && Math.abs(cell.width - cell.height) < 2,
    );
  }
  assert.deepEqual(
    (await new AxeBuilder({ page }).setLegacyMode().analyze()).violations,
    [],
  );
  assert.ok(
    await page.evaluate<boolean>(
      'document.documentElement.scrollWidth <= innerWidth + 1',
    ),
  );
  await page.screenshot({
    path: path.join(artifacts, `${name}.png`),
    fullPage: true,
  });
}

async function assertBoard(page: Page, scratch: Scratch) {
  const current =
    scratch.cursor === 0
      ? scratch.root
      : scratch.steps[scratch.cursor - 1]!.after;
  const board = page.getByRole('grid', { name: 'Schachbrett', exact: true });
  for (const [square, piece] of parseFenBoard(current.fen)) {
    await expect(
      board.getByRole('gridcell', {
        name: `${square}, ${pieceName(piece, 'de-DE')}`,
        exact: true,
      }),
    ).toBeVisible({ timeout: 30_000 });
  }
}

async function update(
  scope: Scope,
  action: UpdateAnalysisScratchRequestDto['action'],
  scratch?: Scratch,
) {
  const result = await call<UpdateAnalysisScratchResultDto>(
    'update_analysis_scratch',
    {
      scope,
      action,
      expectedScratchId: scratch?.scratchId ?? null,
      expectedScratchRevision: scratch?.scratchRevision ?? null,
    },
  );
  assert.ok(result.scratch);
  return result.scratch;
}

async function save(scope: Scope, scratch: Scratch, displayName: string) {
  return call<CreateAnalysisRecordResultDto>('create_analysis_record', {
    scope,
    expectedScratchId: scratch.scratchId,
    expectedScratchRevision: scratch.scratchRevision,
    displayName,
    languageTag: 'de-DE',
    ...(scope.kind === 'context' ? { targetContextId: scope.contextId } : {}),
  });
}

async function workspace(scope: Scope = free) {
  return call<AnalysisWorkspaceDto>('get_analysis_workspace', { scope });
}

async function selectRecord(scope: Scope, record: RecordView, atEnd = true) {
  const current = await workspace(scope);
  await call('set_work_scope_resume', {
    scope,
    area: 'analyze',
    mode: 'analyze',
    expectedResumeVersion: current.resumeVersion ?? null,
    itemId: record.itemId,
    revisionId: record.revisionId,
    anchorId: atEnd
      ? (record.steps.at(-1)?.anchorId ?? record.rootAnchorId)
      : record.rootAnchorId,
  });
  const selected = (await workspace(scope)).record;
  assert.ok(selected);
  return selected;
}

async function derive(
  parent: RecordView,
  moves: readonly string[],
  title: string,
) {
  let scratch = await update(free, {
    kind: 'start',
    origin: {
      kind: 'inventory_anchor',
      itemId: parent.itemId,
      revisionId: parent.revisionId,
      anchorId: parent.steps.at(-1)?.anchorId ?? parent.rootAnchorId,
    },
  });
  for (const value of moves)
    scratch = await update(
      free,
      { kind: 'apply_move', move: { kind: 'coordinates', value } },
      scratch,
    );
  await save(free, scratch, title);
  const record = (await workspace()).record;
  assert.ok(record);
  assert.equal(record.origin.kind, 'inventory_anchor');
  if (record.origin.kind === 'inventory_anchor')
    assert.equal(record.origin.itemId, parent.itemId);
  return record;
}

async function createRootInDesktop(
  page: Page,
  title: string,
  moves: readonly string[] = [],
  fen?: string,
) {
  await page
    .getByRole('navigation', { name: 'Plysmith' })
    .getByRole('button', { name: 'Verwalten', exact: true })
    .click();
  if (fen === undefined) {
    await page
      .getByRole('button', { name: 'Neue Analyse', exact: true })
      .click();
  } else {
    await page
      .getByRole('button', { name: 'Stellung aufbauen', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByText('Erweiterte Stellungsdaten', { exact: true })
      .click();
    await dialog.getByLabel('FEN', { exact: true }).fill(fen);
    await dialog
      .getByRole('button', { name: 'FEN übernehmen', exact: true })
      .click();
    await expect(
      dialog.getByRole('gridcell', { name: 'e5, Weiß König', exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole('button', {
        name: 'Mit dieser Stellung beginnen',
        exact: true,
      })
      .click();
  }
  await page.getByRole('grid', { name: 'Schachbrett', exact: true }).waitFor();
  for (const value of moves) await moveInDesktop(page, value);
  return saveInDesktop(page, title);
}

async function moveInDesktop(
  page: Page,
  coordinates: string,
  scope: Scope = free,
) {
  const before = await workspace(scope);
  const expectedCount = (before.scratch?.steps.length ?? 0) + 1;
  const board = page.getByRole('grid', { name: 'Schachbrett', exact: true });
  await expect(page.getByLabel('Arbeitskontext', { exact: true })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(board).toHaveAttribute('aria-readonly', 'false', {
    timeout: 30_000,
  });
  await board
    .getByRole('gridcell', { name: new RegExp(`^${coordinates.slice(0, 2)},`) })
    .click();
  await board
    .getByRole('gridcell', { name: new RegExp(`^${coordinates.slice(2, 4)},`) })
    .click();
  await expect
    .poll(async () => (await workspace(scope)).scratch?.steps.length, {
      timeout: 30_000,
    })
    .toBe(expectedCount);
}

async function saveInDesktop(page: Page, title: string, scope: Scope = free) {
  const toggle = page.locator('[aria-controls="analysis-actions-details"]');
  if ((await toggle.getAttribute('aria-expanded')) === 'false')
    await toggle.click();
  await page
    .getByRole('button', { name: 'Als eigene Analyse speichern', exact: true })
    .click();
  await page.getByLabel('Titel', { exact: true }).fill(title);
  await page
    .getByRole('button', { name: 'Analyse speichern', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: title, exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  const current = await workspace(scope);
  assert.equal(current.scratch, undefined);
  assert.ok(current.record);
  return current.record;
}

async function trainingGame(
  parent: RecordView,
  title: string,
  providerInstanceId: string,
) {
  const inventory = await call<SearchInventoryResultDto>('search_inventory', {
    pageSize: 100,
  });
  const existing = inventory.items.find((item) => item.displayName === title);
  if (existing !== undefined) {
    const record = await call<RecordView>('get_inventory_revision', {
      scope: free,
      itemId: existing.itemId,
      revisionId: existing.currentRevisionId,
    });
    assert.equal(record.itemType, 'game');
    assert.equal(record.origin.kind, 'inventory_anchor');
    if (record.origin.kind === 'inventory_anchor')
      assert.equal(record.origin.itemId, parent.itemId);
    assert.ok(record.game && record.steps.length > 0);
    assert.equal(record.game.outcomeSource, 'manual');
    return {
      itemId: record.itemId,
      revisionId: record.revisionId,
      rootAnchorId: record.rootAnchorId,
      outcome: record.game.outcome,
      outcomeSource: record.game.outcomeSource,
      dataRevision: inventory.dataRevision,
    } satisfies CompletePlayoutResultDto;
  }
  let game = await call<PlayoutDto>('start_playout', {
    scope: free,
    start: {
      kind: 'inventory_anchor',
      itemId: parent.itemId,
      revisionId: parent.revisionId,
      anchorId: parent.steps.at(-1)?.anchorId ?? parent.rootAnchorId,
      continuation: [],
    },
    providerInstanceId,
    capability: 'best_move',
    opening: { kind: 'provider_move' },
  });
  await expect
    .poll(
      async () => {
        const current = await call<{ playout?: PlayoutDto }>('get_playout', {
          scope: free,
        });
        assert.ok(current.playout);
        game = current.playout;
        return game.draft.status.kind;
      },
      { timeout: 30_000 },
    )
    .not.toBe('awaiting_policy');
  assert.equal(game.draft.status.kind, 'active');
  assert.ok(game.draft.steps.length > 0, 'A real provider must make a move');
  const stopped = await call<PlayoutDto>('stop_playout', {
    scope: free,
    draftId: game.draft.draftId,
    expectedDraftRevision: game.draft.draftRevision,
  });
  const request = {
    scope: free,
    draftId: stopped.draft.draftId,
    expectedDraftRevision: stopped.draft.draftRevision,
    completionId: crypto.randomUUID(),
    displayName: title,
    languageTag: 'de-DE',
    manualResult: 'unfinished',
  };
  const saved = await call<CompletePlayoutResultDto>(
    'complete_playout',
    request,
  );
  assert.equal(saved.outcomeSource, 'manual');
  assert.deepEqual(await call('complete_playout', request), saved);
  return saved;
}

async function seed() {
  assert.equal(
    (await call<SearchInventoryResultDto>('search_inventory')).items.length,
    0,
    'Seed requires authorized empty store',
  );
  const page = await launch();
  const library = await createRootInDesktop(page, 'Eröffnungsbibliothek');
  assert.equal(library.steps.length, 0);
  await moveInDesktop(page, 'e2e4');
  const e4 = await saveInDesktop(page, 'Offene Spiele ab Grundstellung');
  await moveInDesktop(page, 'c7c5');
  const sicilian = await saveInDesktop(page, 'Sizilianisch');
  for (const move of ['g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g7g6'])
    await moveInDesktop(page, move);
  const dragon = await saveInDesktop(page, 'Drachenaufbau');
  assert.deepEqual(
    dragon.sourceLine?.steps.map((step) => step.move.san),
    ['e4', 'c5'],
  );
  await accessibleScreenshot(page, 'dragon-real-desktop');
  console.log(
    'PASS A: zero-move library -> e4 -> Sicilian -> Dragon, full real Desktop Save chain.',
  );
  const e4Root = await createRootInDesktop(page, 'Repertoire nach 1.e4', [
    'e2e4',
  ]);
  const italian = await derive(
    e4Root,
    ['e7e5', 'g1f3', 'b8c6', 'f1c4'],
    'Italienische Partie',
  );
  const scotch = await derive(
    e4Root,
    ['e7e5', 'g1f3', 'b8c6', 'd2d4'],
    'Schottische Partie',
  );
  console.log('PASS B: independent 1.e4 root with two true child branches.');
  const endgame = await createRootInDesktop(
    page,
    'Bauernendspiel: Opposition',
    [],
    '8/4k3/8/4K3/4P3/8/8/8 w - - 0 1',
  );
  assert.equal(endgame.steps.length, 0);
  assert.equal(endgame.origin.kind, 'position_setup');
  const left = await derive(
    endgame,
    ['e5d5', 'e7d7'],
    'Opposition: Königsweg links',
  );
  const right = await derive(
    endgame,
    ['e5f5', 'e7f7'],
    'Opposition: Königsweg rechts',
  );
  console.log(
    'PASS C: valid custom setup root with two independent key-position paths.',
  );
  await application!.close();
  application = undefined;
  await finishLibraries([
    library,
    e4,
    sicilian,
    dragon,
    e4Root,
    italian,
    scotch,
    endgame,
    left,
    right,
  ]);
}

async function finishLibraries(records: readonly RecordView[]) {
  const [
    library,
    e4,
    sicilian,
    dragon,
    e4Root,
    italian,
    scotch,
    endgame,
    left,
    right,
  ] = records as [
    RecordView,
    RecordView,
    RecordView,
    RecordView,
    RecordView,
    RecordView,
    RecordView,
    RecordView,
    RecordView,
    RecordView,
  ];
  const provider = (
    await call<ListMovePolicyProvidersResultDto>('list_move_policy_providers')
  ).providers.find(
    (item) =>
      item.status === 'available' && item.capabilities.includes('best_move'),
  );
  assert.ok(provider, 'Acceptance needs an existing real engine configuration');
  const families: FamilyProof[] = [];
  for (const [root, members, favorite, contextName, nextMove] of [
    [
      library,
      [e4, sicilian, dragon],
      dragon,
      'Eröffnungen ab Grundstellung',
      'f1c4',
    ],
    [e4Root, [italian, scotch], italian, 'Repertoire nach 1.e4', 'g8f6'],
    [endgame, [left, right], left, 'Bauernendspiele', 'd5e5'],
  ] as const) {
    await selectRecord(free, favorite);
    const analysis = await workspace();
    const snapshot: {
      kind: string;
      candidates?: readonly unknown[];
    } = await call('analyze_position', {
      work: {
        scope: free,
        subject: { kind: 'inventory_item', itemId: favorite.itemId },
      },
      consumerId: 'library-acceptance',
      laneId: 'objective',
      providerInstanceId: provider.instanceId,
      candidateCount: 3,
      focus: {
        focusKey: `acceptance:${favorite.itemId}`,
        root: favorite.root,
        moves: favorite.steps.map((step) => step.move),
        current: analysis.currentState,
      },
      mode: { kind: 'objective', budget: 'fast' },
    });
    assert.equal(snapshot.kind, 'objective');
    assert.ok(snapshot.candidates && snapshot.candidates.length > 0);
    const game = await trainingGame(
      favorite,
      `Training: ${contextName}`,
      provider.instanceId,
    );
    const contexts = await call<ListWorkingContextsResultDto>(
      'list_working_contexts',
      { pageSize: 100 },
    );
    const existingContext = contexts.contexts.find(
      (context) => context.displayName === contextName,
    );
    const contextId =
      existingContext?.contextId ??
      (
        await call<CreateWorkingContextResultDto>('create_working_context', {
          displayName: contextName,
        })
      ).context.contextId;
    const contextWorkspace = await call<WorkingContextWorkspaceDto>(
      'get_working_context_workspace',
      { contextId },
    );
    for (const member of [root, ...members, game]) {
      if (
        contextWorkspace.references.some(
          (reference) => reference.itemId === member.itemId,
        )
      )
        continue;
      await call('add_context_reference', {
        contextId,
        itemId: member.itemId,
        anchorId: member.rootAnchorId,
      });
    }
    const scope = { kind: 'context', contextId } as const;
    if ((await workspace(scope)).scratch === undefined)
      await selectRecord(scope, favorite);
    const previous = await workspace(scope);
    const scratch =
      previous.scratch ??
      (await update(scope, {
        kind: 'start',
        origin: {
          kind: 'inventory_anchor',
          itemId: favorite.itemId,
          revisionId: favorite.revisionId,
          anchorId: favorite.steps.at(-1)!.anchorId,
        },
        firstMove: { kind: 'coordinates', value: nextMove },
      }));
    assert.equal(scratch.steps.length, 1);
    assert.equal(
      scratch.steps[0]?.move.from + scratch.steps[0]!.move.to,
      nextMove,
    );
    assert.equal(scratch.origin.kind, 'inventory_anchor');
    if (scratch.origin.kind === 'inventory_anchor')
      assert.equal(scratch.origin.itemId, favorite.itemId);
    if (
      !previous.record?.contributions.some(
        (note) => note.body === `Arbeitsnotiz: ${contextName}`,
      )
    ) {
      await call('create_position_note', {
        scope,
        itemId: favorite.itemId,
        revisionId: favorite.revisionId,
        anchorId: favorite.rootAnchorId,
        noteScope: scope,
        body: `Arbeitsnotiz: ${contextName}`,
        languageTag: 'de-DE',
      });
    }
    families.push({ root, members, favorite, game, contextId, scratch });
    console.log(
      `PASS: real engine assessment/game and isolated context work for ${contextName}.`,
    );
  }
  const inventory = await call<SearchInventoryResultDto>('search_inventory', {
    pageSize: 100,
  });
  const children = new Set(
    inventory.provenanceEdges.map((edge) => edge.itemId),
  );
  assert.deepEqual(
    inventory.items
      .filter((item) => !children.has(item.itemId))
      .map((item) => item.itemId)
      .sort(),
    families.map((family) => family.root.itemId).sort(),
    'Exactly three real roots, no artificial families',
  );
  for (const family of families) {
    assert.ok(
      inventory.provenanceEdges.some(
        (edge) =>
          edge.itemId === family.game.itemId &&
          edge.sourceItemId === family.favorite.itemId,
      ),
    );
    const unchanged = await selectRecord(free, family.root, false);
    assert.deepEqual(
      unchanged.steps,
      family.root.steps,
      'Exploration leaves the library root unchanged',
    );
  }
  let freeScratch = await update(free, {
    kind: 'start',
    origin: {
      kind: 'inventory_anchor',
      itemId: sicilian.itemId,
      revisionId: sicilian.revisionId,
      anchorId: sicilian.steps.at(-1)!.anchorId,
    },
    firstMove: { kind: 'coordinates', value: 'g1f3' },
  });
  freeScratch = await update(
    free,
    {
      kind: 'prepare_note',
      body: 'Freier Arbeitsstand bleibt beim Themenwechsel erhalten.',
    },
    freeScratch,
  );
  const startup = await call<StartupResumeDto>('get_startup_resume');
  await call('set_startup_resume', {
    scope: { kind: 'context', contextId: families[2]!.contextId },
    area: 'analyze',
    expectedStartupVersion: startup.startupVersion ?? null,
  });
  await writeFile(
    proofPath,
    JSON.stringify({ families, freeScratch }, null, 2),
  );
  console.log(
    'PASS: three families, independent context and free drafts ready for physical host restart.',
  );
}

async function check() {
  const proof = JSON.parse(
    await readFile(proofPath, 'utf8'),
  ) as AcceptanceProof;
  const startup = await call<StartupResumeDto>('get_startup_resume');
  if (!process.argv.includes('--resume')) {
    assert.deepEqual(startup.scope, {
      kind: 'context',
      contextId: proof.families[2]!.contextId,
    });
    assert.equal(startup.area, 'analyze');
  }
  assert.deepEqual((await workspace()).scratch, proof.freeScratch);
  for (const family of proof.families) {
    const scope = { kind: 'context', contextId: family.contextId } as const;
    assert.deepEqual((await workspace(scope)).scratch, family.scratch);
    const record = await call<RecordView>('get_inventory_revision', {
      scope: free,
      itemId: family.root.itemId,
      revisionId: family.root.revisionId,
    });
    assert.deepEqual(record.steps, family.root.steps);
    const game = await call<RecordView>('get_inventory_revision', {
      scope: free,
      itemId: family.game.itemId,
      revisionId: family.game.revisionId,
    });
    assert.equal(game.game?.outcomeSource, 'manual');
  }
  console.log(
    'PASS restart: startup, three independent context drafts, free draft/note and roots restored.',
  );
  const page = await launch();
  const navigation = page.getByRole('navigation', { name: 'Plysmith' });
  const contextSelector = page.getByLabel('Arbeitskontext', { exact: true });
  for (const family of proof.families) {
    await expect(contextSelector).toBeEnabled({ timeout: 30_000 });
    await contextSelector.selectOption(`context:${family.contextId}`);
    await navigation
      .getByRole('button', { name: 'Analysieren', exact: true })
      .click();
    await expect(
      page.getByRole('heading', {
        name: family.favorite.displayName,
        exact: true,
      }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole('grid', { name: 'Schachbrett' }),
    ).toHaveAttribute('aria-readonly', 'false', { timeout: 30_000 });
    await navigation
      .getByRole('button', { name: 'Verwalten', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Details', exact: true }),
    ).toBeVisible();
    await navigation
      .getByRole('button', { name: 'Analysieren', exact: true })
      .click();
    await expect(
      page.getByRole('heading', {
        name: family.favorite.displayName,
        exact: true,
      }),
    ).toBeVisible();
    assert.deepEqual(
      (await workspace({ kind: 'context', contextId: family.contextId }))
        .scratch?.steps,
      family.scratch.steps,
    );
    await assertBoard(page, family.scratch);
    await accessibleScreenshot(page, `context-${family.contextId}-restored`);
  }
  await navigation
    .getByRole('button', { name: 'Verwalten', exact: true })
    .click();
  await page
    .getByRole('radiogroup', { name: 'Bestandsumfang' })
    .getByText('Gesamter Bestand', { exact: true })
    .click();
  const foreign = proof.families[0]!.root;
  await page
    .getByRole('button', {
      name: new RegExp(`^${foreign.displayName} Analyse`),
    })
    .click();
  const inspector = page.getByRole('complementary').filter({
    has: page.getByRole('heading', { name: 'Details', exact: true }),
  });
  await expect(
    inspector.getByRole('button', { name: 'Analysieren', exact: true }),
  ).toHaveCount(0);
  await expect(
    inspector.getByRole('button', {
      name: 'Im Arbeitskontext verwenden',
      exact: true,
    }),
  ).toBeVisible();
  await accessibleScreenshot(page, 'foreign-item-metadata-only');
  console.log(
    'PASS scope policy: foreign inventory object has management actions, no analysis entry.',
  );
  await expect(contextSelector).toBeEnabled({ timeout: 30_000 });
  await contextSelector.selectOption('free');
  await navigation
    .getByRole('button', { name: 'Analysieren', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Sizilianisch', exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  assert.deepEqual((await workspace()).scratch, proof.freeScratch);
  await accessibleScreenshot(page, 'free-work-restored');
  await assertBoard(page, proof.freeScratch);
  await navigation
    .getByRole('button', { name: 'Verwalten', exact: true })
    .click();
  for (;;) {
    const collapsed = page.getByRole('button', {
      name: /^Herkunftsfamilie .* aufklappen$/,
    });
    if ((await collapsed.count()) === 0) break;
    await collapsed.first().click();
  }
  for (const family of proof.families) {
    await expect(
      page.getByRole('button', {
        name: new RegExp(
          `^${family.root.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} Analyse`,
        ),
      }),
    ).toBeVisible();
  }
  await accessibleScreenshot(page, 'three-families-desktop');
  await page.setViewportSize({ width: 390, height: 1000 });
  await accessibleScreenshot(page, 'three-families-mobile');
  await page.setViewportSize({ width: 1280, height: 1000 });
  await accessibleScreenshot(page, 'three-families-1280');
  const inventory = await call<SearchInventoryResultDto>('search_inventory', {
    pageSize: 100,
  });
  const children = new Set(
    inventory.provenanceEdges.map((edge) => edge.itemId),
  );
  assert.equal(
    inventory.items.filter((item) => !children.has(item.itemId)).length,
    3,
  );
  console.log(
    `PASS actual Desktop: ${inventory.items.length} objects in exactly three meaningful families; context/area switching, Axe and 390/1280px reflow.`,
  );
}

async function finish() {
  const inventory = await call<SearchInventoryResultDto>('search_inventory', {
    pageSize: 100,
  });
  const records: RecordView[] = [];
  for (const name of [
    'Eröffnungsbibliothek',
    'Offene Spiele ab Grundstellung',
    'Sizilianisch',
    'Drachenaufbau',
    'Repertoire nach 1.e4',
    'Italienische Partie',
    'Schottische Partie',
    'Bauernendspiel: Opposition',
    'Opposition: Königsweg links',
    'Opposition: Königsweg rechts',
  ]) {
    const item = inventory.items.find((item) => item.displayName === name);
    assert.ok(item, `The successful Desktop seed must contain ${name}`);
    records.push(
      await call<RecordView>('get_inventory_revision', {
        scope: free,
        itemId: item.itemId,
        revisionId: item.currentRevisionId,
      }),
    );
  }
  await finishLibraries(records);
}

async function snapshot() {
  const inventory = await call<SearchInventoryResultDto>('search_inventory', {
    pageSize: 100,
  });
  const contexts = await call<ListWorkingContextsResultDto>(
    'list_working_contexts',
    { pageSize: 100 },
  );
  async function record(name: string) {
    const item = inventory.items.find((item) => item.displayName === name);
    assert.ok(item);
    return call<RecordView>('get_inventory_revision', {
      scope: free,
      itemId: item.itemId,
      revisionId: item.currentRevisionId,
    });
  }
  const families: FamilyProof[] = [];
  for (const [contextName, rootName, memberNames, favoriteName] of [
    [
      'Eröffnungen ab Grundstellung',
      'Eröffnungsbibliothek',
      ['Offene Spiele ab Grundstellung', 'Sizilianisch', 'Drachenaufbau'],
      'Drachenaufbau',
    ],
    [
      'Repertoire nach 1.e4',
      'Repertoire nach 1.e4',
      ['Italienische Partie', 'Schottische Partie'],
      'Italienische Partie',
    ],
    [
      'Bauernendspiele',
      'Bauernendspiel: Opposition',
      ['Opposition: Königsweg links', 'Opposition: Königsweg rechts'],
      'Opposition: Königsweg links',
    ],
  ] as const) {
    const contextId = contexts.contexts.find(
      (context) => context.displayName === contextName,
    )?.contextId;
    assert.ok(contextId);
    const scratch = (await workspace({ kind: 'context', contextId })).scratch;
    assert.ok(scratch);
    const game = await record(`Training: ${contextName}`);
    assert.ok(game.game);
    const members: RecordView[] = [];
    for (const name of memberNames) members.push(await record(name));
    families.push({
      root: await record(rootName),
      members,
      favorite: await record(favoriteName),
      contextId,
      scratch,
      game: {
        itemId: game.itemId,
        revisionId: game.revisionId,
        rootAnchorId: game.rootAnchorId,
        outcome: game.game.outcome,
        outcomeSource: game.game.outcomeSource,
        dataRevision: inventory.dataRevision,
      },
    });
  }
  const freeScratch = (await workspace()).scratch;
  assert.ok(freeScratch);
  await writeFile(
    proofPath,
    JSON.stringify(
      { families, freeScratch } satisfies AcceptanceProof,
      null,
      2,
    ),
  );
  console.log(
    'PASS read-only acceptance checkpoint: no inventory or workspace changes.',
  );
}

try {
  await client.connect(transport);
  if (mode === 'reproduce') {
    const page = await launch();
    await expect(
      page.getByRole('heading', { name: 'Offen Partien', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Änderung prüfen…', exact: true })
      .click();
    await page
      .getByRole('button', {
        name: 'Als eigene Analyse speichern',
        exact: true,
      })
      .click();
    await page.getByLabel('Titel', { exact: true }).fill('Sizilianisch');
    await page
      .getByRole('button', { name: 'Analyse speichern', exact: true })
      .click();
    await expect(page.getByRole('alert')).toContainText(
      'Eine aktive Analyse mit diesem Namen',
      { timeout: 30_000 },
    );
    await expect(page.getByLabel('Titel', { exact: true })).toHaveValue(
      'Sizilianisch',
    );
    await accessibleScreenshot(page, 'name-conflict');
    await page
      .getByLabel('Titel', { exact: true })
      .fill('Sizilianisch aus Eröffnungsbibliothek');
    await page
      .getByRole('button', { name: 'Analyse speichern', exact: true })
      .click();
    await expect(
      page.getByRole('heading', {
        name: 'Sizilianisch aus Eröffnungsbibliothek',
        exact: true,
      }),
    ).toBeVisible();
    const workspace = await call<AnalysisWorkspaceDto>(
      'get_analysis_workspace',
      { scope: { kind: 'context', contextId: '2' } },
    );
    assert.equal(workspace.scratch, undefined);
    assert.equal(workspace.record?.steps[0]?.move.san, 'c5');
    assert.deepEqual(
      workspace.record?.sourceLine?.steps.map((step) => step.move.san),
      ['e4'],
    );
    await accessibleScreenshot(page, 'name-conflict-recovered');
    console.log(
      'PASS: exact current desktop Save failure, preserved draft and corrected-name Save with full provenance.',
    );
  } else if (mode === 'seed') {
    await seed();
  } else if (mode === 'inspect') {
    console.log(JSON.stringify(await workspace(), null, 2));
    const page = await launch();
    console.log(
      await page
        .getByRole('grid', { name: 'Schachbrett' })
        .getAttribute('aria-readonly'),
    );
    await accessibleScreenshot(page, 'inspect');
  } else if (mode === 'finish') {
    await finish();
  } else if (mode === 'snapshot') {
    await snapshot();
  } else {
    await check();
  }
  assert.deepEqual(pageErrors, []);
} catch (error) {
  if (application !== undefined) {
    const page = await application.firstWindow();
    await page.screenshot({
      path: path.join(artifacts, 'failure.png'),
      fullPage: true,
    });
    console.error(await page.locator('body').innerText());
  }
  console.error(JSON.stringify(await workspace(), null, 2));
  throw error;
} finally {
  await application?.close();
  await client.close();
}
