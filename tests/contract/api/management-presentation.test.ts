import assert from 'node:assert/strict';
import test from 'node:test';
import { ApplicationProblem } from '../../../app/application/problems/application-problem.ts';
import { localId } from '../../../app/domain/identity/index.ts';
import {
  SetManagementPresentation,
  type SetManagementPresentationRequest,
} from '../../../app/application/workspace/index.ts';
import { PlysmithHostClient } from '../../../app/infrastructure/channels/host_client/index.ts';
import {
  contractFingerprint,
  productRelease,
} from '../../../contracts/host/index.ts';
import { connectMcp, assertToolData } from '../mcp/helpers.ts';
import { buildFixture, headers, token, occurredAt } from './fixtures.ts';

test('management presentation has identical HTTP, HostClient and MCP contracts with closed enums and stale CAS', async (t) => {
  const received: SetManagementPresentationRequest[] = [];
  const published: unknown[] = [];
  const { host } = await buildFixture(t, {
    setManagementPresentation: new SetManagementPresentation({
      clock: { now: () => occurredAt },
      events: { publish: (event) => published.push(event) },
      writer: {
        setManagementPresentation: async (request) => {
          received.push(request);
          if (request.expectedResumeVersion !== 1)
            throw new ApplicationProblem(
              'workspace.resume_revision_conflict',
              'stale',
            );
          return {
            area: 'manage',
            changed: request.presentation === 'origins',
            dataRevision: 12,
            resume: {
              resumeVersion: 2,
              presentation: request.presentation,
              selectedItemId: localId('inventory-item', 7),
              selectedAnchorId: localId('anchor', 10),
              updatedAt: occurredAt,
            },
          };
        },
      },
    }),
  });
  const hostClient = new PlysmithHostClient(
    {
      endpoint: 'http://127.0.0.1:43210/',
      token,
      productRelease,
      contractFingerprint,
    },
    {
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        const response = await host.inject({
          method: request.method as 'PUT',
          url: new URL(request.url).pathname,
          headers: {
            ...Object.fromEntries(request.headers),
            host: headers.host,
          },
          payload: await request.text(),
        });
        return new Response(response.body, {
          status: response.statusCode,
          headers: { 'content-type': String(response.headers['content-type']) },
        });
      },
    },
  );
  const { client } = await connectMcp(t, hostClient);
  for (const scope of [
    { kind: 'free' },
    { kind: 'context', contextId: '2' },
  ] as const) {
    for (const presentation of ['folders', 'origins'] as const) {
      const request = { scope, presentation, expectedResumeVersion: 1 };
      received.length = 0;
      published.length = 0;
      const direct = await hostClient.setManagementPresentation(request);
      const calls = [...received];
      assert.equal(published.length, presentation === 'origins' ? 1 : 0);
      received.length = 0;
      const result = await client.callTool({
        name: 'set_management_presentation',
        arguments: request,
      });
      assertToolData(result, direct);
      assert.deepEqual(received, calls);
      assert.deepEqual(calls, [
        {
          scope:
            scope.kind === 'free'
              ? { kind: 'free' }
              : { kind: 'context', contextId: localId('working-context', 2) },
          presentation,
          expectedResumeVersion: 1,
        },
      ]);
      assert.equal(direct.resume.selectedItemId, '7');
      assert.equal(direct.resume.selectedAnchorId, '10');
      assert.equal('changed' in direct, false);
    }
  }
  const valid = {
    scope: { kind: 'free' },
    presentation: 'origins',
    expectedResumeVersion: 1,
  };
  for (const invalid of [
    { ...valid, presentation: 'list' },
    { ...valid, presentation: 'atlas' },
    { ...valid, presentation: 'invalid' },
    { ...valid, selectedItemId: '7' },
    { ...valid, expectedResumeVersion: 0 },
    { ...valid, scope: { kind: 'free', contextId: '2' } },
  ]) {
    received.length = 0;
    const response = await host.inject({
      method: 'PUT',
      url: '/workspace/management-presentation',
      headers,
      payload: invalid,
    });
    assert.equal(response.statusCode, 400);
    const result = await client.callTool({
      name: 'set_management_presentation',
      arguments: invalid,
    });
    assert.equal(result.isError, true);
    assert.deepEqual(received, []);
  }
  received.length = 0;
  const stale = { ...valid, expectedResumeVersion: 3 };
  await assert.rejects(
    hostClient.setManagementPresentation({
      ...stale,
      scope: { kind: 'free' },
      presentation: 'origins',
    }),
    (error: unknown) =>
      (error as { problem: { code: string } }).problem.code ===
      'workspace.resume_revision_conflict',
  );
  const failure = await client.callTool({
    name: 'set_management_presentation',
    arguments: stale,
  });
  assert.equal(failure.isError, true);
  assert.equal(
    (failure.structuredContent as { code: string }).code,
    'workspace.resume_revision_conflict',
  );
  assert.equal(received.length, 2);
});
