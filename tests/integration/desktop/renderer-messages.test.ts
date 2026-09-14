import assert from 'node:assert/strict';
import test from 'node:test';

import { messages } from '../../../app/infrastructure/channels/ui/renderer/messages.ts';

test('product messages do not expose process or development topology', () => {
  const internalTerms =
    /application host|desktop|watch[- ]?modus|watch mode|hostvertrag|host contract/i;

  for (const [locale, catalogue] of Object.entries(messages)) {
    for (const [messageId, message] of Object.entries(catalogue)) {
      assert.doesNotMatch(message, internalTerms, `${locale}:${messageId}`);
    }
  }
});
