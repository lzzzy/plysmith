import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  connectHost,
  type AnalysisRecordDto,
  type UpdateAnalysisScratchResultDto,
  type CreateAnalysisRecordResultDto,
  type StartInventoryRevisionResultDto,
  type InventoryRevisionPreviewDto,
  type SaveInventoryRevisionResultDto,
  type AnalysisWorkspaceDto,
} from '../../../app/infrastructure/channels/host_client/index.ts';
import { createMcpServer } from '../../../app/infrastructure/channels/mcp/index.ts';
import { readHostDiscovery } from '../../../app/infrastructure/adapters/platform/windows/index.ts';
import { createApplicationHostFixture } from './application-host-fixture.ts';
import { testResources } from '../../fixtures/test-resources.ts';

test(
  'native variations and scoped comments cross MCP, HTTP and SQLite atomically',
  { timeout: 60000 },
  async (t) => {
    const resources = testResources(t);
    const fixture = await createApplicationHostFixture(t);
    const discovery = await resources.run(() =>
      readHostDiscovery(fixture.applicationHome),
    );
    assert.ok(discovery);
    const host = await connectHost(discovery);
    const server = createMcpServer({
      hostClient: host,
      productRelease: discovery.productRelease,
    });
    const client = new Client({
      name: 'plysmith-variations-test',
      version: '1.0.0',
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    resources.defer(() => server.close());
    resources.defer(() => client.close());
    await resources.run(() => server.connect(serverTransport));
    await resources.run(() =>
      client.connect(clientTransport, { signal: t.signal }),
    );
    async function tool<T>(
      name: string,
      args: Record<string, unknown>,
    ): Promise<T> {
      const result = await client.callTool(
        { name, arguments: args },
        undefined,
        { signal: t.signal },
      );
      assert.notEqual(result.isError, true, JSON.stringify(result));
      assert.ok(result.structuredContent);
      return result.structuredContent as T;
    }
    async function verifyCursorLock(
      scope: { kind: 'free' } | { kind: 'context'; contextId: string },
      scratch: NonNullable<UpdateAnalysisScratchResultDto['scratch']>,
    ) {
      const middle = (
        await tool<UpdateAnalysisScratchResultDto>('update_analysis_scratch', {
          scope,
          expectedScratchId: scratch.scratchId,
          expectedScratchRevision: scratch.scratchRevision,
          action: { kind: 'move_cursor', cursor: scratch.steps.length - 1 },
        })
      ).scratch!;
      const before = await tool<AnalysisWorkspaceDto>(
        'get_analysis_workspace',
        { scope },
      );
      assert.equal(before.allowedActions.includes('apply_move'), false);
      assert.ok(before.allowedActions.includes('move_cursor'));
      const legal = before.legalMoves[0]!;
      const rejected = await client.callTool({
        name: 'update_analysis_scratch',
        arguments: {
          scope,
          expectedScratchId: middle.scratchId,
          expectedScratchRevision: middle.scratchRevision,
          action: {
            kind: 'apply_move',
            move: { kind: 'notation', value: legal.san, locale: 'en-GB' },
          },
        },
      });
      assert.equal(rejected.isError, true);
      assert.deepEqual(
        await tool<AnalysisWorkspaceDto>('get_analysis_workspace', { scope }),
        before,
      );
      const end = (
        await tool<UpdateAnalysisScratchResultDto>('update_analysis_scratch', {
          scope,
          expectedScratchId: middle.scratchId,
          expectedScratchRevision: middle.scratchRevision,
          action: { kind: 'move_cursor', cursor: scratch.steps.length },
        })
      ).scratch!;
      assert.ok(
        (
          await tool<AnalysisWorkspaceDto>('get_analysis_workspace', { scope })
        ).allowedActions.includes('apply_move'),
      );
      return end;
    }
    const free = { kind: 'free' } as const;
    let scratch = (
      await tool<UpdateAnalysisScratchResultDto>('update_analysis_scratch', {
        scope: free,
        expectedScratchId: null,
        expectedScratchRevision: null,
        action: { kind: 'start', origin: { kind: 'initial_position' } },
      })
    ).scratch!;
    for (const san of ['e4', 'e5', 'Nf3']) {
      scratch = (
        await tool<UpdateAnalysisScratchResultDto>('update_analysis_scratch', {
          scope: free,
          expectedScratchId: scratch.scratchId,
          expectedScratchRevision: scratch.scratchRevision,
          action: {
            kind: 'apply_move',
            move: { kind: 'notation', value: san, locale: 'en-GB' },
          },
        })
      ).scratch!;
    }
    scratch = await verifyCursorLock(free, scratch);
    const created = await tool<CreateAnalysisRecordResultDto>(
      'create_analysis_record',
      {
        scope: free,
        expectedScratchId: scratch.scratchId,
        expectedScratchRevision: scratch.scratchRevision,
        displayName: 'Native opening family',
        languageTag: 'en-GB',
      },
    );
    const read = (revisionId: string, scope: object = free) =>
      tool<AnalysisRecordDto>('get_inventory_revision', {
        scope,
        itemId: created.itemId,
        revisionId,
      });
    const base = await read(created.revisionId);
    assert.equal(base.steps.length, 3);
    const e4 = base.steps[0]!.anchorId;
    const context = await tool<{ context: { contextId: string } }>(
      'create_working_context',
      { displayName: 'Opening training' },
    );
    const scope = {
      kind: 'context',
      contextId: context.context.contextId,
    } as const;
    await tool('add_context_reference', {
      contextId: scope.contextId,
      itemId: created.itemId,
      anchorId: e4,
    });
    const started = await tool<StartInventoryRevisionResultDto>(
      'start_inventory_revision',
      {
        scope,
        itemId: created.itemId,
        baseRevisionId: base.revisionId,
        anchorId: e4,
        mode: 'add_variation',
        expectedScratchId: null,
        expectedScratchRevision: null,
        firstMove: { kind: 'notation', value: 'c5', locale: 'en-GB' },
      },
    );
    scratch = started.scratch;
    scratch = (
      await tool<UpdateAnalysisScratchResultDto>('update_analysis_scratch', {
        scope,
        expectedScratchId: scratch.scratchId,
        expectedScratchRevision: scratch.scratchRevision,
        action: {
          kind: 'apply_move',
          move: { kind: 'notation', value: 'Nf3', locale: 'en-GB' },
        },
      })
    ).scratch!;
    scratch = await verifyCursorLock(scope, scratch);
    const comment = {
      body: '1... c5 2. Nf3\nMy training idea',
      languageTag: 'en-GB',
      noteScope: scope,
    };
    const request = {
      scope,
      expectedScratchId: scratch.scratchId,
      expectedScratchRevision: scratch.scratchRevision,
      comment,
    };
    const preview = await tool<InventoryRevisionPreviewDto>(
      'preview_inventory_revision',
      request,
    );
    assert.equal(preview.mode, 'add_variation');
    assert.equal(preview.removedSteps.length, 0);
    assert.equal(preview.affectedContexts.length, 0);
    assert.equal(preview.followingContexts[0]?.changedScratchCount, 0);
    const invalid = await client.callTool({
      name: 'save_inventory_revision',
      arguments: {
        ...request,
        comment: { ...comment, body: 'Changed after preview' },
        previewFingerprint: preview.previewFingerprint,
      },
    });
    assert.equal(invalid.isError, true);
    assert.equal(
      (await read(base.revisionId, scope)).currentRevisionId,
      base.revisionId,
    );
    assert.ok(
      !(await read(base.revisionId, scope)).contributions.some(
        (note) => note.body === comment.body,
      ),
    );
    const saved = await tool<SaveInventoryRevisionResultDto>(
      'save_inventory_revision',
      { ...request, previewFingerprint: preview.previewFingerprint },
    );
    assert.equal(saved.noOp, false);
    assert.ok(saved.commentContributionId);
    const global = await read(saved.revisionId);
    const contextual = await read(saved.revisionId, scope);
    assert.deepEqual(
      global.steps.map((step) => step.move.san),
      ['e4', 'e5', 'Nf3'],
    );
    assert.equal(global.tree?.nodes.length, 5);
    const siblings = global.tree!.nodes.filter(
      (node) => node.parentNodeIndex === global.tree!.nodes[0]!.nodeIndex,
    );
    assert.deepEqual(
      siblings.map((node) => [node.move.san, node.siblingOrder]),
      [
        ['e5', 0],
        ['c5', 1],
      ],
    );
    assert.ok(
      !global.contributions.some(
        (note) => note.contributionId === saved.commentContributionId,
      ),
    );
    const note = contextual.contributions.find(
      (entry) => entry.contributionId === saved.commentContributionId,
    );
    assert.equal(note?.body, comment.body);
    assert.equal(note?.anchorId, e4);
    assert.deepEqual(note?.moves, []);
    await tool('update_analysis_note', {
      scope,
      contributionId: note!.contributionId,
      expectedContributionVersion: note!.contributionVersion,
      body: 'An ordinary editable comment',
    });
    const duplicate = await tool<StartInventoryRevisionResultDto>(
      'start_inventory_revision',
      {
        scope: free,
        itemId: created.itemId,
        baseRevisionId: saved.revisionId,
        anchorId: e4,
        mode: 'add_variation',
        expectedScratchId: null,
        expectedScratchRevision: null,
        firstMove: { kind: 'notation', value: 'c5', locale: 'en-GB' },
      },
    );
    const duplicateRequest = {
      scope: free,
      expectedScratchId: duplicate.scratch.scratchId,
      expectedScratchRevision: duplicate.scratch.scratchRevision,
      comment: {
        body: 'Must not become a duplicate comment',
        languageTag: 'en-GB',
        noteScope: { kind: 'global' },
      },
    };
    const duplicatePreview = await tool<InventoryRevisionPreviewDto>(
      'preview_inventory_revision',
      duplicateRequest,
    );
    assert.equal(duplicatePreview.noOp, true);
    const noOp = await tool<SaveInventoryRevisionResultDto>(
      'save_inventory_revision',
      {
        ...duplicateRequest,
        previewFingerprint: duplicatePreview.previewFingerprint,
      },
    );
    assert.equal(noOp.noOp, true);
    assert.equal(noOp.commentContributionId, undefined);
    assert.equal((await read(saved.revisionId)).tree?.nodes.length, 5);
    await tool('update_analysis_scratch', {
      scope: free,
      expectedScratchId: duplicate.scratch.scratchId,
      expectedScratchRevision: duplicate.scratch.scratchRevision,
      action: { kind: 'discard' },
    });
    const branch = global.tree!.nodes.find((entry) => entry.move.san === 'c5')!;
    const longBody = 'Editable imported paragraphs\n'.repeat(1400);
    const longNote = await tool<{
      contributionId: string;
      contributionVersion: number;
    }>('create_position_note', {
      scope: free,
      itemId: created.itemId,
      revisionId: saved.revisionId,
      anchorId: branch.anchorId,
      noteScope: { kind: 'global' },
      languageTag: 'en-GB',
      body: longBody,
    });
    await tool('update_analysis_note', {
      scope: free,
      contributionId: longNote.contributionId,
      expectedContributionVersion: longNote.contributionVersion,
      body: longBody + 'Edited without splitting the note.',
    });
    const deletion = await tool<StartInventoryRevisionResultDto>(
      'start_inventory_revision',
      {
        scope: free,
        itemId: created.itemId,
        baseRevisionId: saved.revisionId,
        anchorId: e4,
        lineAnchorId: branch.anchorId,
        mode: 'truncate_after',
        expectedScratchId: null,
        expectedScratchRevision: null,
      },
    );
    const deletionRequest = {
      scope: free,
      expectedScratchId: deletion.scratch.scratchId,
      expectedScratchRevision: deletion.scratch.scratchRevision,
    };
    const deletionPreview = await tool<InventoryRevisionPreviewDto>(
      'preview_inventory_revision',
      deletionRequest,
    );
    assert.deepEqual(
      deletionPreview.removedSteps.map((entry) => entry.move.san),
      ['c5', 'Nf3'],
    );
    assert.equal(deletionPreview.historicalGlobalContributionCount, 1);
    // The deleted branch's note remains in the previous immutable revision.
    const deleted = await tool<SaveInventoryRevisionResultDto>(
      'save_inventory_revision',
      {
        ...deletionRequest,
        previewFingerprint: deletionPreview.previewFingerprint,
      },
    );
    const afterDeletion = await read(deleted.revisionId);
    assert.deepEqual(
      afterDeletion.steps.map((entry) => entry.move.san),
      ['e4', 'e5', 'Nf3'],
    );
    assert.equal(afterDeletion.steps.length, 3);
    assert.equal(afterDeletion.contributions.length, 0);
    assert.equal((await read(saved.revisionId)).tree?.nodes.length, 5);
    assert.equal(
      (await read(saved.revisionId)).contributions[0]?.body,
      longBody + 'Edited without splitting the note.',
    );
  },
);
