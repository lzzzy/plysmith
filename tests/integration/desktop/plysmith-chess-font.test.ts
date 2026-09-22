import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const runtimeFontPath = path.resolve(
  'app/infrastructure/channels/ui/assets/fonts/plysmith-chess/PlysmithChess-Regular.woff2',
);
const boardStylesPath = path.resolve(
  'app/infrastructure/channels/ui/renderer/chess-board-surface.module.css',
);
const sourceMetadataPath = path.resolve(
  'assets/fonts/plysmith-chess/source/src/font.json',
);

test('bundles the approved Plysmith Chess font as the only board font', async () => {
  const font = await readFile(runtimeFontPath);
  assert.equal(
    createHash('sha256').update(font).digest('hex').toUpperCase(),
    '8D8F68BD0489C446B1A6FEC9433157744E92CE51CEE13EC1C6D2A0BE8AB34332',
  );

  const styles = await readFile(boardStylesPath, 'utf8');
  assert.match(styles, /font-family: 'Plysmith Chess';/);
  assert.match(styles, /PlysmithChess-Regular\.woff2/);
  assert.doesNotMatch(styles, /Noto|Segoe UI Symbol|serif/);
});

test('keeps the editable first-party font metadata with the runtime asset', async () => {
  const metadata = JSON.parse(await readFile(sourceMetadataPath, 'utf8')) as {
    readonly family: string;
    readonly license: string;
    readonly codepoints: Readonly<Record<string, number>>;
  };

  assert.equal(metadata.family, 'Plysmith Chess');
  assert.equal(metadata.license, 'OFL-1.1');
  assert.deepEqual(
    Object.values(metadata.codepoints).sort((left, right) => left - right),
    [9812, 9813, 9814, 9815, 9816, 9817, 9818, 9819, 9820, 9821, 9822, 9823],
  );
});
