import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

import {
  cruise,
  type IConfiguration,
  type ICruiseResult,
  type IForbiddenRuleType,
} from 'dependency-cruiser';

const require = createRequire(import.meta.url);
const configuration =
  require('../../.dependency-cruiser.cjs') as IConfiguration;
const fixturePrefix = 'tests/architecture/fixtures/';
const ruleNames = new Set([
  'client-bootstraps-do-not-compose-the-application',
  'client-bootstraps-use-only-platform-adapters',
  'mcp-channel-stays-behind-the-host-client',
]);

test('architecture rules reject client-role imports that would hide a second application runtime', async () => {
  const forbidden = (configuration.forbidden ?? [])
    .filter((rule) => rule.name !== undefined && ruleNames.has(rule.name))
    .map(prefixRule);
  assert.equal(forbidden.length, ruleNames.size);

  const result = await cruise(
    [path.join(fixturePrefix, 'app')],
    {
      ...configuration.options,
      validate: true,
      ruleSet: { forbidden },
    },
    configuration.options?.enhancedResolveOptions,
  );
  assert.equal(typeof result.output, 'object');
  const violations = (result.output as ICruiseResult).summary.violations;
  assert.deepEqual(violations.map(({ rule }) => rule.name).sort(), [
    'client-bootstraps-do-not-compose-the-application',
    'client-bootstraps-do-not-compose-the-application',
    'client-bootstraps-use-only-platform-adapters',
    'mcp-channel-stays-behind-the-host-client',
  ]);
});

function prefixRule(rule: IForbiddenRuleType): IForbiddenRuleType {
  const serialized = JSON.stringify(rule).replaceAll(
    '^app',
    `^${fixturePrefix}app`,
  );
  return JSON.parse(serialized) as IForbiddenRuleType;
}
