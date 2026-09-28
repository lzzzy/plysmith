import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  alphaReleaseAssetNames,
  verifyAlphaReleaseAssets,
  writeAlphaReleaseChecksums,
} from '../../../tools/release-assets.ts';

test('checksums cover every published Alpha asset and reject tampering', async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'plysmith-assets-'));
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  const version = '0.1.0-alpha.1';
  const names = alphaReleaseAssetNames(version);
  for (const name of names) {
    await writeFile(path.join(outputRoot, name), name);
  }

  await writeAlphaReleaseChecksums(outputRoot, version);
  const checksumFile = await readFile(
    path.join(outputRoot, 'SHA256SUMS.txt'),
    'utf8',
  );
  assert.deepEqual(
    checksumFile
      .trimEnd()
      .split('\n')
      .map((line) => line.slice(66)),
    names,
  );
  await verifyAlphaReleaseAssets(outputRoot, version);

  await writeFile(path.join(outputRoot, 'sbom.cdx.json'), 'changed');
  await assert.rejects(
    verifyAlphaReleaseAssets(outputRoot, version),
    /checksums do not match/,
  );
});

test('rejects incomplete or unexpected release files', async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'plysmith-assets-'));
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  const version = '0.1.0-alpha.1';
  for (const name of alphaReleaseAssetNames(version)) {
    await writeFile(path.join(outputRoot, name), name);
  }
  await writeAlphaReleaseChecksums(outputRoot, version);
  await writeFile(
    path.join(outputRoot, 'latest.yml'),
    'unintended updater file',
  );
  await assert.rejects(
    verifyAlphaReleaseAssets(outputRoot, version),
    /incomplete or unexpected/,
  );
});
