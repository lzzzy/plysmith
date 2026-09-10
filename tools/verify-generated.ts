import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { generateConfigurationSchemas } from './generate-configuration-schemas.ts';
import { generateHostContract } from './generate-host-contract.ts';

const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), 'plysmith-generated-'),
);

try {
  const generatedDirectory = path.join(
    temporaryRoot,
    'configuration',
    'schemas',
  );
  await generateConfigurationSchemas(generatedDirectory);
  await compareFiles(
    generatedDirectory,
    path.resolve('configuration', 'schemas'),
    ['plysmith.schema.json', 'sqlite-provider.schema.json'],
  );
  const hostContractRoot = path.join(temporaryRoot, 'host-contract');
  await generateHostContract(hostContractRoot);
  await compareFiles(hostContractRoot, path.resolve('contracts', 'host'), [
    'openapi.json',
  ]);
  await compareFiles(
    path.join(hostContractRoot, 'generated'),
    path.resolve('contracts', 'host', 'generated'),
    ['contract.ts', 'openapi.ts'],
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function compareFiles(
  actualDirectory: string,
  expectedDirectory: string,
  fileNames: readonly string[],
): Promise<void> {
  for (const fileName of fileNames) {
    const [actual, expected] = await Promise.all([
      readFile(path.join(actualDirectory, fileName), 'utf8'),
      readFile(path.join(expectedDirectory, fileName), 'utf8'),
    ]);
    assert.equal(actual, expected, `${fileName} is not up to date`);
  }
}
