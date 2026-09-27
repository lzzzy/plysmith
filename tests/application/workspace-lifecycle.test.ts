import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DeleteWorkingContext,
  GetStartupResume,
  GetWorkScopeWorkspace,
  SetStartupResume,
  type WorkspaceChanged,
} from '../../app/application/workspace/index.ts';
import { localId } from '../../app/domain/identity/index.ts';
import { freeWorkScope } from '../../app/domain/workspace/index.ts';

const occurredAt = '2026-09-27T12:00:00.000Z';
const clock = { now: () => occurredAt };
const contextId = localId('working-context', 1);

test('startup updates validate the area and version before writing and publish only committed changes', async () => {
  const published: WorkspaceChanged[] = [];
  let writes = 0;
  let fail = true;
  const command = new SetStartupResume({
    clock,
    events: { publish: (event) => published.push(event) },
    writer: {
      async setStartupResume(request, timestamp) {
        writes++;
        assert.equal(timestamp, occurredAt);
        if (fail) throw new Error('Commit failed.');
        return {
          scope: request.scope,
          area: request.area,
          startupVersion: 3,
          dataRevision: 8,
        };
      },
    },
  });
  const request = {
    scope: freeWorkScope(),
    area: 'analyze' as const,
    expectedStartupVersion: 2,
  };
  await assert.rejects(
    command.execute({ ...request, area: 'invalid' as 'analyze' }),
    { problemCode: 'workspace.invalid_resume' },
  );
  await assert.rejects(
    command.execute({ ...request, expectedStartupVersion: 0 }),
    { problemCode: 'workspace.invalid_resume' },
  );
  assert.equal(writes, 0);
  await assert.rejects(command.execute(request), /Commit failed/);
  assert.deepEqual(published, []);
  fail = false;
  await command.execute(request);
  assert.deepEqual(published, [
    {
      kind: 'workspace.startup-updated',
      occurredAt,
      startupVersion: 3,
      dataRevision: 8,
    },
  ]);
});

test('context deletion requires complete preview expectations and does not publish failed commits', async () => {
  const published: WorkspaceChanged[] = [];
  let writes = 0;
  let fail = true;
  const command = new DeleteWorkingContext({
    clock,
    playout: {
      cancelAndWait: async () => assert.fail('No playout was deleted.'),
    },
    events: { publish: (event) => published.push(event) },
    writer: {
      async deleteWorkingContext(request, timestamp) {
        writes++;
        assert.equal(timestamp, occurredAt);
        assert.equal(request.expectedContextVersion, 2);
        assert.equal(request.expectedDataRevision, 9);
        if (fail) throw new Error('Commit failed.');
        return { contextId, dataRevision: 10, removedPlayoutDraftId: null };
      },
    },
  });
  const request = {
    contextId,
    expectedDataRevision: 9,
    expectedContextVersion: 2,
  };
  await assert.rejects(
    command.execute({ ...request, expectedDataRevision: NaN }),
    { problemCode: 'workspace.invalid_removal_confirmation' },
  );
  await assert.rejects(
    command.execute({ ...request, expectedContextVersion: 0 }),
    { problemCode: 'workspace.invalid_removal_confirmation' },
  );
  assert.equal(writes, 0);
  await assert.rejects(command.execute(request), /Commit failed/);
  assert.deepEqual(published, []);
  fail = false;
  await command.execute(request);
  assert.deepEqual(published, [
    {
      kind: 'workspace.context-deleted',
      contextId,
      occurredAt,
      dataRevision: 10,
    },
  ]);
});

test('startup and workspace reads keep missing context causes and free scope distinct', async () => {
  const startup = {
    scope: freeWorkScope(),
    area: 'analyze' as const,
    startupVersion: 3,
    dataRevision: 8,
    unavailableContext: {
      contextId,
      reason: 'deleted' as const,
      displayName: 'Previous',
    },
  };
  assert.deepEqual(
    await new GetStartupResume({
      readStartupResume: async () => startup,
    }).execute(),
    startup,
  );
  const command = new GetWorkScopeWorkspace({
    readWorkScopeWorkspace: async (scope) =>
      scope.kind === 'free' ? { scope, dataRevision: 8 } : undefined,
  });
  assert.deepEqual(await command.execute({ scope: freeWorkScope() }), {
    scope: freeWorkScope(),
    dataRevision: 8,
  });
  await assert.rejects(
    command.execute({ scope: { kind: 'context', contextId } }),
    { problemCode: 'workspace.context_not_found' },
  );
});
