import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ActiveMovePolicyDecisions } from '../../app/application/playout/index.ts';
import { localId } from '../../app/domain/identity/index.ts';

test('a newer decision can wait for the cancelled draft decision to finish', async () => {
  const decisions = new ActiveMovePolicyDecisions();
  const draftId = localId('playout-draft', 1);
  const running = decisions.run(draftId, 1, (signal) => {
    return new Promise<never>((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => reject(new Error('cancelled decision')),
        { once: true },
      );
    });
  });
  const rejected = assert.rejects(running, /cancelled decision/);

  await decisions.cancelAndWait(draftId, 1);
  await rejected;
  const result = await decisions.run(draftId, 2, async () => 'next decision');

  assert.equal(result, 'next decision');
});
