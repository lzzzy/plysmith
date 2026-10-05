import assert from 'node:assert/strict';
import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Value } from '@sinclair/typebox/value';
import {
  apiSchemas,
  HostEventSchema,
} from '../../../app/infrastructure/channels/api/contract.ts';
import {
  connectHost,
  connectRediscoveringHost,
  HostClientProblem,
  HostEventClient,
  type HostEvent,
  type ImportInputDescriptorDto,
  type ImportPreviewDto,
  type ImportPublishedDto,
  type ImportNameChecksDto,
} from '../../../app/infrastructure/channels/host_client/index.ts';
import { createMcpServer } from '../../../app/infrastructure/channels/mcp/index.ts';
import { readHostDiscovery } from '../../../app/infrastructure/adapters/platform/windows/index.ts';
import { assertToolData } from '../../contract/mcp/helpers.ts';
import { createApplicationHostFixture } from './application-host-fixture.ts';

async function tool<T extends Record<string, unknown>>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.ok(result.structuredContent);
  const data = result.structuredContent as T;
  assertToolData(result, data);
  return data;
}

test(
  'session import crosses real MCP, HTTP and SQLite and publishes the ordinary inventory event',
  { timeout: 60000 },
  async (t) => {
    const fixture = await createApplicationHostFixture(t);
    const discovery = await readHostDiscovery(fixture.applicationHome);
    assert.ok(discovery);
    const host = await connectHost(discovery);
    const server = createMcpServer({
      hostClient: host,
      productRelease: discovery.productRelease,
    });
    const client = new Client({
      name: 'plysmith-import-test',
      version: '1.0.0',
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const events: HostEvent[] = [];
    const failures: string[] = [];
    const subscription = new HostEventClient(discovery, {
      onEvent: (event) => {
        events.push(event);
      },
      onInvalidEvent: () => {
        failures.push('invalid event');
      },
      onGap: () => {
        failures.push('replay gap');
      },
    });
    const inputLocator = path.join(fixture.applicationHome, 'chapters.pgn');
    const bytes = Buffer.from(
      Array.from(
        { length: 2 },
        (_, index) =>
          `[Event "Synthetic chapter ${index + 1}"]\n[Result "*"]\n\n{Synthetic root comment} 1. e4 e5 (1... c5 {Synthetic branch comment}) *`,
      ).join('\n\n'),
    );
    let preview: ImportPreviewDto;
    let published: ImportPublishedDto;
    const candidates = [0, 1].map((sourceOrder) => ({
      sourceOrder,
      itemType: 'analysis' as const,
      displayName: `chapters.pgn - Chapter ${sourceOrder + 1}`,
    }));
    try {
      await writeFile(inputLocator, bytes);
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      await subscription.ready;
      await t.test(
        'prepare returns a complete preview without inventory changes',
        async () => {
          const input = await tool<ImportInputDescriptorDto>(
            client,
            'register_import_input',
            { inputLocator },
          );
          preview = await tool<ImportPreviewDto>(client, 'prepare_import', {
            inputHandle: input.inputHandle,
            languageTag: 'en-GB',
            formatId: 'standard-chess-pgn-v1',
          });
          assert.equal(preview.candidates.length, 2);
          assert.equal(preview.formatId, 'standard-chess-pgn-v1');
          assert.equal(preview.inputSize, bytes.length);
          assert.equal(preview.sourceDisplayName, 'chapters.pgn');
          assert.equal(preview.candidates[0]?.moveCount, 3);
          assert.equal(preview.candidates[0]?.variationCount, 1);
          assert.equal((await host.searchInventory({})).items.length, 0);
          assert.deepEqual(events, []);
          for (const forbidden of [
            inputLocator,
            fixture.applicationHome,
            discovery.token,
            bytes.toString('utf8'),
          ]) {
            assert.ok(
              !JSON.stringify(preview).includes(
                JSON.stringify(forbidden).slice(1, -1),
              ),
            );
          }
        },
      );
      await t.test(
        'HTTP and MCP name checks agree and reject duplicate batch names',
        async () => {
          const request = {
            candidates: candidates.map(({ sourceOrder, displayName }) => ({
              sourceOrder,
              displayName,
            })),
          };
          const http = await host.checkImportNames(request);
          assert.deepEqual(
            await tool<ImportNameChecksDto>(
              client,
              'check_import_names',
              request,
            ),
            http,
          );
          assert.ok(http.candidates.every((candidate) => candidate.available));
          const duplicates = await host.checkImportNames({
            candidates: [
              { sourceOrder: 0, displayName: 'Same' },
              { sourceOrder: 1, displayName: 'Same' },
            ],
          });
          assert.ok(
            duplicates.candidates.some((candidate) => !candidate.available),
          );
        },
      );
      await t.test(
        'publish creates the folder and items and emits one inventory event without a receipt',
        async () => {
          const request = {
            previewId: preview.previewId,
            candidates,
            folder: { kind: 'new' as const, displayName: 'chapters.pgn' },
            confirmWarnings: true,
          };
          published = await tool<ImportPublishedDto>(
            client,
            'publish_import',
            request,
          );
          assert.equal(published.items.length, 2);
          assert.ok(published.folderId);
          assert.deepEqual(Object.keys(published).sort(), [
            'dataRevision',
            'folderId',
            'items',
          ]);
          const timeout = Date.now() + 5000;
          while (events.length === 0 && Date.now() < timeout)
            await new Promise((resolve) => setTimeout(resolve, 10));
          assert.equal(events.length, 1);
          const event = events[0]!;
          assert.equal(event.kind, 'inventory.organization-changed');
          assert.equal(event.dataRevision, published.dataRevision);
          if (event.kind === 'inventory.organization-changed') {
            assert.equal(event.payload.folderId, published.folderId);
            assert.deepEqual(
              event.payload.itemIds,
              published.items.map((item) => item.itemId),
            );
          }
          assert.equal(
            Value.Check(HostEventSchema, [...apiSchemas], event),
            true,
          );
          for (const item of published.items) {
            const record = await host.getInventoryRevision(
              item.itemId,
              item.revisionId,
              { scopeKind: 'free' },
            );
            assert.equal(record.tree?.nodes.length, 3);
          }
          await assert.rejects(
            host.publishImport(request),
            (error: unknown) =>
              error instanceof HostClientProblem &&
              error.problem.code === 'import.not_found',
          );
          assert.deepEqual(
            await host.discardImport({ previewId: preview.previewId }),
            { discarded: false },
          );
        },
      );
      await t.test(
        'reimport checks the current inventory and discard only removes the preview',
        async () => {
          const input = await host.registerImportInput({ inputLocator });
          const next = await host.prepareImport({
            inputHandle: input.inputHandle,
            languageTag: 'en-GB',
          });
          const checks = await host.checkImportNames({
            candidates: candidates.map(({ sourceOrder, displayName }) => ({
              sourceOrder,
              displayName,
            })),
          });
          assert.ok(
            checks.candidates.every((candidate) => !candidate.available),
          );
          assert.ok(
            checks.candidates.every(
              (candidate) =>
                candidate.suggestedDisplayName !== candidate.displayName,
            ),
          );
          assert.deepEqual(
            await tool(client, 'discard_import', { previewId: next.previewId }),
            { discarded: true },
          );
          assert.deepEqual(
            await host.discardImport({ previewId: next.previewId }),
            { discarded: false },
          );
          assert.equal((await host.searchInventory({})).items.length, 2);
          assert.equal(events.length, 1);
        },
      );
      await t.test(
        'rediscovery never repeats an import POST after a transport failure',
        async () => {
          const attempts: string[] = [];
          const rediscovering = await connectRediscoveringHost(
            async () => discovery,
            {
              fetch: async (input, init) => {
                const request =
                  input instanceof Request ? input : new Request(input, init);
                if (
                  new URL(request.url).pathname.startsWith('/inventory/import')
                ) {
                  attempts.push(new URL(request.url).pathname);
                  throw new TypeError('Simulated connection loss');
                }
                return fetch(input, init);
              },
            },
          );
          const requests = [
            () => rediscovering.registerImportInput({ inputLocator }),
            () =>
              rediscovering.prepareImport({
                inputHandle: preview.previewId,
                languageTag: 'en-GB',
              }),
            () => rediscovering.checkImportNames({ candidates: [] }),
            () =>
              rediscovering.publishImport({
                previewId: preview.previewId,
                candidates,
                folder: { kind: 'unfiled' },
                confirmWarnings: false,
              }),
            () => rediscovering.discardImport({ previewId: preview.previewId }),
          ];
          for (const request of requests) await assert.rejects(request);
          assert.deepEqual(attempts, [
            '/inventory/import-inputs',
            '/inventory/imports/preview',
            '/inventory/imports/names',
            '/inventory/imports/publish',
            '/inventory/imports/discard',
          ]);
        },
      );
      assert.deepEqual(failures, []);
      await assert.rejects(stat(fixture.providerTracePath), { code: 'ENOENT' });
    } finally {
      subscription.close();
      await client.close();
      await server.close();
    }
  },
);
