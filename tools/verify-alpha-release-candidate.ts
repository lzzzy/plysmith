import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { productRelease } from '../contracts/host/index.ts';
import { verifyAlphaReleaseAssets } from './release-assets.ts';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const execFileAsync = promisify(execFile);
const gitArguments = [
  '-c',
  `safe.directory=${repositoryRoot.replaceAll('\\', '/')}`,
];
const packageJson = JSON.parse(
  await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
) as { version: string };
if (packageJson.version !== productRelease) {
  throw new Error('Package and Host contract versions differ.');
}

const tag = process.env.GITHUB_REF_NAME;
if (
  process.env.GITHUB_ACTIONS === 'true' &&
  (process.env.GITHUB_REF_TYPE !== 'tag' || !tag)
) {
  throw new Error('Release candidates must be built from a Git tag.');
}
if (tag && tag !== `v${productRelease}`) {
  throw new Error('The Git tag does not match the product version.');
}
const { stdout: commit } = await execFileAsync(
  'git',
  [...gitArguments, 'rev-parse', 'HEAD'],
  { cwd: repositoryRoot },
);
if (tag) {
  const { stdout: taggedCommit } = await execFileAsync(
    'git',
    [...gitArguments, 'rev-parse', `refs/tags/${tag}^{commit}`],
    { cwd: repositoryRoot },
  );
  if (taggedCommit.trim() !== commit.trim()) {
    throw new Error('The checked-out commit differs from the release tag.');
  }
}
const { stdout: status } = await execFileAsync(
  'git',
  [...gitArguments, 'status', '--porcelain'],
  { cwd: repositoryRoot },
);
const dirty = status.trim().length > 0;
if (process.env.GITHUB_ACTIONS === 'true' && dirty) {
  throw new Error('A release candidate must use a clean checkout.');
}

const outputRoot = path.join(
  repositoryRoot,
  'build',
  'alpha-release',
  'output',
);
const inventory = JSON.parse(
  await readFile(
    path.join(outputRoot, 'release-license-inventory.json'),
    'utf8',
  ),
) as { product?: { version?: string; buildRevision?: string } };
const buildRevision = `${commit.trim()}${dirty ? '+dirty' : ''}`;
if (
  inventory.product?.version !== productRelease ||
  inventory.product.buildRevision !== buildRevision
) {
  throw new Error('Release inventory does not match this source revision.');
}
await verifyAlphaReleaseAssets(outputRoot, productRelease);
console.log(
  `Alpha release candidate verified: ${productRelease} (${buildRevision})`,
);
