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

  const result = await cruise([path.join(fixturePrefix, 'app')], {
    ...configuration.options,
    validate: true,
    ruleSet: { forbidden },
  });
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
  const prefixed = structuredClone(rule);
  assert.ok('to' in prefixed, 'Fixture rules must describe dependency edges');
  for (const restriction of [prefixed.from, prefixed.to]) {
    if (restriction.path !== undefined)
      restriction.path = prefixPath(restriction.path);
    if (restriction.pathNot !== undefined)
      restriction.pathNot = prefixPath(restriction.pathNot);
  }
  return prefixed;
}

function prefixPath(value: string | string[]): typeof value {
  if (Array.isArray(value))
    return value.map((entry) => prefixPath(entry) as string);
  return value.replace(/\^(?=app|contracts|tests)/g, `^${fixturePrefix}`);
}

test('architecture boundaries cover imports, re-exports and importing-test exceptions', async () => {
  const names = [
    'domain-is-independent',
    'renderer-has-no-node-runtime',
    'renderer-has-no-server-packages',
    'renderer-has-no-business-imports',
    'product-does-not-import-tests',
    'contexts-use-public-entrypoints',
    'channels-do-not-use-outbound-adapters',
  ];
  const forbidden = (configuration.forbidden ?? [])
    .filter((rule) => rule.name !== undefined && names.includes(rule.name))
    .map(prefixRule);
  assert.equal(forbidden.length, names.length);
  const result = await cruise(
    [
      path.join(fixturePrefix, 'app'),
      path.join(fixturePrefix, 'contracts'),
      path.join(fixturePrefix, 'tests'),
    ],
    { ...configuration.options, validate: true, ruleSet: { forbidden } },
  );
  assert.equal(typeof result.output, 'object');
  const output = result.output as ICruiseResult;
  assert.deepEqual(
    output.modules.flatMap((module) =>
      module.dependencies.filter((dependency) => dependency.couldNotResolve),
    ),
    [],
    'Every fixture dependency must resolve; unresolved imports cannot prove a boundary',
  );
  const actual = output.summary.violations.map(
    ({ rule, from, to }) =>
      `${rule.name}: ${from?.replace(fixturePrefix, '')} -> ${to?.replace(fixturePrefix, '')}`,
  );
  const expected = [
    'domain-is-independent: app/domain/inventory/runtime.ts -> fs',
    'domain-is-independent: app/domain/inventory/runtime.ts -> path',
    'domain-is-independent: app/domain/inventory/runtime.ts -> PACKAGE:react',
    'domain-is-independent: app/domain/inventory/runtime.ts -> PACKAGE:react-dom',
    'renderer-has-no-node-runtime: app/infrastructure/channels/ui/renderer/invalid.ts -> fs',
    'renderer-has-no-node-runtime: app/infrastructure/channels/ui/renderer/invalid.ts -> path',
    'renderer-has-no-server-packages: app/infrastructure/channels/ui/renderer/invalid.ts -> PACKAGE:electron',
    'renderer-has-no-server-packages: app/infrastructure/channels/ui/renderer/invalid.ts -> PACKAGE:better-sqlite3',
    'renderer-has-no-server-packages: app/infrastructure/channels/ui/renderer/invalid.ts -> PACKAGE:fastify',
    'renderer-has-no-business-imports: app/infrastructure/channels/ui/renderer/invalid.ts -> app/domain/workspace/index.ts',
    'renderer-has-no-business-imports: app/infrastructure/channels/ui/renderer/invalid.ts -> app/application/workspace/index.ts',
    'product-does-not-import-tests: app/application/inventory/test-imports.ts -> tests/support.ts',
    'product-does-not-import-tests: app/application/inventory/test-imports.ts -> tests/reexport.ts',
    'product-does-not-import-tests: contracts/probe.ts -> tests/support.ts',
    'product-does-not-import-tests: contracts/probe.ts -> tests/reexport.ts',
    'contexts-use-public-entrypoints: app/domain/inventory/private-imports.ts -> app/domain/workspace/private.ts',
    'contexts-use-public-entrypoints: app/domain/inventory/private-imports.ts -> app/domain/analysis/private.ts',
    'contexts-use-public-entrypoints: app/application/inventory/private-imports.ts -> app/application/workspace/private.ts',
    'contexts-use-public-entrypoints: app/application/inventory/private-imports.ts -> app/application/analysis/private.ts',
    'contexts-use-public-entrypoints: app/application/inventory/private-imports.ts -> app/domain/workspace/private.ts',
    'contexts-use-public-entrypoints: app/application/inventory/private-imports.ts -> app/application/analysis/ports.ts',
    'contexts-use-public-entrypoints: app/application/inventory/private-imports.ts -> app/application/analysis/internal/public.ts',
    'contexts-use-public-entrypoints: app/application/inventory/public.ts -> app/application/analysis/ports.ts',
    'channels-do-not-use-outbound-adapters: app/infrastructure/channels/ui/renderer/invalid.ts -> app/infrastructure/adapters/persistence/sqlite/probe.ts',
    'renderer-has-no-server-packages: app/infrastructure/channels/ui/renderer/invalid.ts -> PACKAGE:@fastify/cors',
  ];
  assert.deepEqual(
    actual
      .map((entry) =>
        entry.replace(
          /(?:node_modules\/.*\/)?node_modules\/(react-dom|react|electron|better-sqlite3|fastify|@fastify\/cors)\/.*$/,
          'PACKAGE:$1',
        ),
      )
      .sort(),
    expected.sort(),
  );
});

test('cycle detection remains unconditional for product and test dependencies', () => {
  assert.deepEqual(
    configuration.forbidden?.find((rule) => rule.name === 'no-circular'),
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  );
});
