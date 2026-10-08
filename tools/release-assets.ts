import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const checksumFileName = 'SHA256SUMS.txt';

export function releaseAssetNames(version: string): string[] {
  return [
    'LICENSE',
    `Plysmith-${version}-win-x64-Setup.exe`,
    'THIRD_PARTY_NOTICES.txt',
    'licenses.tar.gz',
    'release-license-inventory.json',
    'sbom.cdx.json',
  ].sort();
}

export async function writeReleaseChecksums(
  outputRoot: string,
  version: string,
): Promise<void> {
  const lines = await checksumLines(outputRoot, version);
  await writeFile(path.join(outputRoot, checksumFileName), lines);
}

export async function verifyReleaseAssets(
  outputRoot: string,
  version: string,
): Promise<void> {
  const expectedNames = [...releaseAssetNames(version), checksumFileName];
  const actualNames = (await readdir(outputRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames.sort())) {
    throw new Error('Release files are incomplete or unexpected.');
  }
  const expectedChecksums = await checksumLines(outputRoot, version);
  const actualChecksums = await readFile(
    path.join(outputRoot, checksumFileName),
    'utf8',
  );
  if (actualChecksums !== expectedChecksums) {
    throw new Error('Release checksums do not match the assets.');
  }
}

async function checksumLines(
  outputRoot: string,
  version: string,
): Promise<string> {
  const lines: string[] = [];
  for (const name of releaseAssetNames(version)) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path.join(outputRoot, name))) {
      hash.update(chunk);
    }
    lines.push(`${hash.digest('hex')}  ${name}`);
  }
  return `${lines.join('\n')}\n`;
}
