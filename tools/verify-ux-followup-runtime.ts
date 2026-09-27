// Opt-in on an explicitly disposable development store: seed, restart host, check.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type {
  AnalysisWorkspaceDto,
  CompletePlayoutResultDto,
  ContextRemovalPreviewDto,
  CreateAnalysisRecordResultDto,
  CreateWorkingContextResultDto,
  InventoryItemDeletionPreviewDto,
  ListMovePolicyProvidersResultDto,
  PlayoutDto,
  SearchInventoryResultDto,
  StartupResumeDto,
  UpdateAnalysisScratchRequestDto,
  UpdateAnalysisScratchResultDto,
  WorkScopeWorkspaceDto,
} from '../app/infrastructure/channels/host_client/index.ts';

const mode = process.argv[2];
assert.ok(mode === 'seed' || mode === 'check', 'Use seed or check');
const proofPath = path.resolve(
  'build/desktop/verification/ux-followup-proof.json',
);
const client = new Client({ name: 'plysmith-ux-runtime', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    path.resolve('app/bootstrap/mcp/main.ts'),
    '--application-home',
    process.cwd(),
  ],
  stderr: 'pipe',
});
const free = { kind: 'free' } as const;
type Scratch = NonNullable<AnalysisWorkspaceDto['scratch']>;
interface Proof {
  readonly root: CreateAnalysisRecordResultDto;
  readonly child: CreateAnalysisRecordResultDto;
  readonly contextId: string;
  readonly scratch: Scratch;
  readonly games: readonly CompletePlayoutResultDto[];
}
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
  assert.ok(response.structuredContent, `${name} has no structured result`);
  return response.structuredContent as T;
}
async function scratchUpdate(
  scope: UpdateAnalysisScratchRequestDto['scope'],
  action: UpdateAnalysisScratchRequestDto['action'],
  scratch?: Scratch,
): Promise<Scratch> {
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
function move(value: string) {
  return { kind: 'coordinates', value } as const;
}
async function startGame(
  scope: UpdateAnalysisScratchRequestDto['scope'],
  providerInstanceId: string,
): Promise<PlayoutDto> {
  let game = await call<PlayoutDto>('start_playout', {
    scope,
    start: { kind: 'initial_position' },
    providerInstanceId,
    capability: 'best_move',
    opening: { kind: 'user_move', move: move('e2e4') },
  });
  const until = Date.now() + 20_000;
  while (game.draft.status.kind === 'awaiting_policy' && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const read = await call<{ playout?: PlayoutDto }>('get_playout', { scope });
    assert.ok(read.playout);
    game = read.playout;
  }
  assert.equal(game.draft.status.kind, 'active');
  return game;
}
function expected(
  game: PlayoutDto,
  scope: UpdateAnalysisScratchRequestDto['scope'] = free,
) {
  return {
    scope,
    draftId: game.draft.draftId,
    expectedDraftRevision: game.draft.draftRevision,
  };
}

try {
  await client.connect(transport);
  const tools = await client.listTools();
  for (const name of [
    'get_startup_resume',
    'get_work_scope_workspace',
    'preview_working_context_deletion',
    'delete_inventory_item',
  ]) {
    assert.ok(
      tools.tools.some((tool) => tool.name === name),
      `Missing current tool ${name}`,
    );
  }
  if (mode === 'seed') {
    assert.equal(
      (await call<SearchInventoryResultDto>('search_inventory')).items.length,
      0,
      'Seed requires empty authorized store',
    );
    let scratch = await scratchUpdate(free, {
      kind: 'start',
      origin: { kind: 'initial_position' },
      firstMove: move('e2e4'),
    });
    scratch = await scratchUpdate(
      free,
      { kind: 'apply_move', move: move('c7c5') },
      scratch,
    );
    const root = await call<CreateAnalysisRecordResultDto>(
      'create_analysis_record',
      {
        scope: free,
        expectedScratchId: scratch.scratchId,
        expectedScratchRevision: scratch.scratchRevision,
        displayName: 'Runtime origin',
        languageTag: 'de-DE',
      },
    );
    let analysis = await call<AnalysisWorkspaceDto>('get_analysis_workspace', {
      scope: free,
    });
    assert.equal(analysis.scratch, undefined);
    assert.equal(analysis.record?.itemId, root.itemId);
    const rootEnd = analysis.record!.steps.at(-1)!.anchorId;
    scratch = await scratchUpdate(free, {
      kind: 'start',
      origin: {
        kind: 'inventory_anchor',
        itemId: root.itemId,
        revisionId: root.revisionId,
        anchorId: rootEnd,
      },
      firstMove: move('g1f3'),
    });
    const child = await call<CreateAnalysisRecordResultDto>(
      'create_analysis_record',
      {
        scope: free,
        expectedScratchId: scratch.scratchId,
        expectedScratchRevision: scratch.scratchRevision,
        displayName: 'Runtime derived analysis',
        languageTag: 'de-DE',
      },
    );
    const createdContext = await call<CreateWorkingContextResultDto>(
      'create_working_context',
      { displayName: 'Runtime removable context' },
    );
    const contextId = createdContext.context.contextId;
    const context = { kind: 'context', contextId } as const;
    await call('add_context_reference', {
      contextId,
      itemId: root.itemId,
      anchorId: root.rootAnchorId,
    });
    await call('set_work_scope_resume', {
      scope: context,
      area: 'manage',
      expectedResumeVersion: null,
      presentation: 'list',
      selectedItemId: root.itemId,
      selectedAnchorId: root.rootAnchorId,
    });
    await call('create_position_note', {
      scope: context,
      itemId: root.itemId,
      revisionId: root.revisionId,
      anchorId: root.rootAnchorId,
      body: 'Disposable context note',
      languageTag: 'de-DE',
      noteScope: context,
    });
    let localScratch = await scratchUpdate(context, {
      kind: 'start',
      origin: {
        kind: 'inventory_anchor',
        itemId: root.itemId,
        revisionId: root.revisionId,
        anchorId: rootEnd,
      },
      firstMove: move('g1f3'),
    });
    localScratch = await scratchUpdate(
      context,
      { kind: 'prepare_note', body: 'Disposable draft note' },
      localScratch,
    );
    assert.equal(localScratch.noteDraft?.body, 'Disposable draft note');
    const providers = await call<ListMovePolicyProvidersResultDto>(
      'list_move_policy_providers',
    );
    const provider = providers.providers.find((entry) =>
      entry.capabilities.includes('best_move'),
    );
    assert.ok(provider, 'Configured best_move provider required');
    const paused = await call<PlayoutDto>(
      'pause_playout',
      expected(await startGame(context, provider.instanceId), context),
    );
    assert.equal(paused.draft.status.kind, 'paused');
    const games: CompletePlayoutResultDto[] = [];
    for (const result of [
      'white_win',
      'black_win',
      'draw',
      'unfinished',
    ] as const) {
      const stopped: PlayoutDto = await call<PlayoutDto>(
        'stop_playout',
        expected(await startGame(free, provider.instanceId)),
      );
      const request = {
        ...expected(stopped),
        completionId: crypto.randomUUID(),
        displayName: `Runtime ${result}`,
        languageTag: 'de-DE',
        manualResult: result,
      };
      const saved = await call<CompletePlayoutResultDto>(
        'complete_playout',
        request,
      );
      assert.equal(saved.outcomeSource, 'manual');
      assert.equal(
        saved.outcome.kind,
        result === 'draw'
          ? 'draw'
          : result === 'unfinished'
            ? 'unfinished'
            : 'win',
      );
      assert.deepEqual(
        await call('complete_playout', request),
        saved,
        'Receipt must replay identical committed result',
      );
      games.push(saved);
    }
    const freeWorkspace = await call<WorkScopeWorkspaceDto>(
      'get_work_scope_workspace',
      { scopeKind: 'free' },
    );
    await call('set_work_scope_resume', {
      scope: free,
      area: 'manage',
      expectedResumeVersion:
        freeWorkspace.managementResume?.resumeVersion ?? null,
      presentation: 'list',
      selectedItemId: child.itemId,
      selectedAnchorId: child.rootAnchorId,
    });
    scratch = await scratchUpdate(free, {
      kind: 'start',
      origin: {
        kind: 'inventory_anchor',
        itemId: child.itemId,
        revisionId: child.revisionId,
        anchorId: child.rootAnchorId,
      },
      firstMove: move('g1f3'),
    });
    scratch = await scratchUpdate(
      free,
      { kind: 'prepare_note', body: 'Persistent free draft note' },
      scratch,
    );
    const startup = await call<StartupResumeDto>('get_startup_resume');
    await call('set_startup_resume', {
      scope: context,
      area: 'analyze',
      expectedStartupVersion: startup.startupVersion,
    });
    const contextPreview = await call<ContextRemovalPreviewDto>(
      'preview_working_context_deletion',
      { contextId },
    );
    assert.equal(contextPreview.losses.notes.length, 1);
    assert.equal(
      contextPreview.losses.scratch?.noteBody,
      'Disposable draft note',
    );
    assert.equal(contextPreview.losses.playout?.draftId, paused.draft.draftId);
    await call('delete_working_context', {
      contextId,
      expectedContextVersion: contextPreview.contextVersion,
      expectedDataRevision: contextPreview.dataRevision,
    });
    assert.equal(
      (await call<{ playout?: PlayoutDto }>('get_playout', { scope: free }))
        .playout,
      undefined,
    );
    const rootPreview = await call<InventoryItemDeletionPreviewDto>(
      'preview_inventory_item_deletion',
      { itemId: root.itemId },
    );
    assert.equal(rootPreview.retainedDerivedItemCount, 1);
    await call('delete_inventory_item', {
      itemId: root.itemId,
      expectedCurrentRevisionId: rootPreview.currentRevisionId,
      expectedDataRevision: rootPreview.dataRevision,
    });
    analysis = await call<AnalysisWorkspaceDto>('get_analysis_workspace', {
      scope: free,
    });
    assert.deepEqual(
      analysis.scratch,
      scratch,
      'Unrelated free draft must survive deletions',
    );
    await mkdir(path.dirname(proofPath), { recursive: true });
    await writeFile(
      proofPath,
      `${JSON.stringify({ root, child, contextId, scratch, games } satisfies Proof)}\n`,
    );
    console.log(
      'Runtime seed passed: free atomic saves, genuine derivation, four manual outcomes and receipts, concrete context deletion and non-cascading inventory deletion.',
    );
  } else {
    const proof = JSON.parse(await readFile(proofPath, 'utf8')) as Proof;
    const analysis = await call<AnalysisWorkspaceDto>(
      'get_analysis_workspace',
      { scope: free },
    );
    assert.deepEqual(
      analysis.scratch,
      proof.scratch,
      'Free scratch must survive physical host restart',
    );
    const workspace = await call<WorkScopeWorkspaceDto>(
      'get_work_scope_workspace',
      { scopeKind: 'free' },
    );
    assert.equal(
      workspace.managementResume?.selectedItemId,
      proof.child.itemId,
    );
    const startup = await call<StartupResumeDto>('get_startup_resume');
    assert.equal(startup.scope.kind, 'free');
    assert.equal(startup.area, 'analyze');
    assert.equal(startup.unavailableContext?.contextId, proof.contextId);
    const inventory = await call<SearchInventoryResultDto>('search_inventory');
    assert.equal(inventory.items.length, 5);
    assert.ok(
      !inventory.items.some((item) => item.itemId === proof.root.itemId),
    );
    assert.ok(
      inventory.items.some((item) => item.itemId === proof.child.itemId),
    );
    for (const game of proof.games) {
      const record = await call<NonNullable<AnalysisWorkspaceDto['record']>>(
        'get_inventory_revision',
        { scope: free, itemId: game.itemId, revisionId: game.revisionId },
      );
      assert.deepEqual(record.game?.outcome, game.outcome);
      assert.equal(record.game?.outcomeSource, 'manual');
    }
    console.log(
      'Runtime restart passed: free scratch/note/selection, startup fallback with deleted-context cause, derived item and exact saved game outcomes restored.',
    );
  }
} finally {
  await client.close();
  await transport.close();
}
