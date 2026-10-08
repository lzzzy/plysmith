import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  releaseAssetNames,
  verifyReleaseAssets,
  writeReleaseChecksums,
} from '../../../tools/release-assets.ts';

test('checksums cover every published Beta asset and reject tampering', async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'plysmith-assets-'));
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  const version = '0.1.0-beta.1';
  const names = releaseAssetNames(version);
  for (const name of names) {
    await writeFile(path.join(outputRoot, name), name);
  }

  await writeReleaseChecksums(outputRoot, version);
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
  await verifyReleaseAssets(outputRoot, version);

  await writeFile(path.join(outputRoot, 'sbom.cdx.json'), 'changed');
  await assert.rejects(
    verifyReleaseAssets(outputRoot, version),
    /checksums do not match/,
  );
});

test('rejects incomplete or unexpected release files', async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'plysmith-assets-'));
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  const version = '0.1.0-alpha.1';
  for (const name of releaseAssetNames(version)) {
    await writeFile(path.join(outputRoot, name), name);
  }
  await writeReleaseChecksums(outputRoot, version);
  await writeFile(
    path.join(outputRoot, 'latest.yml'),
    'unintended updater file',
  );
  await assert.rejects(
    verifyReleaseAssets(outputRoot, version),
    /incomplete or unexpected/,
  );
});
