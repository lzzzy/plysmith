import assert from 'node:assert/strict';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AxeBuilder } from '@axe-core/playwright';
import { _electron as electron } from '@playwright/test';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const screenshotPath = path.join(
  repositoryRoot,
  'build',
  'desktop',
  'verification',
  'settings.png',
);
await mkdir(path.dirname(screenshotPath), { recursive: true });
assert.ok(
  (
    await stat(
      path.join(
        repositoryRoot,
        'build',
        'desktop',
        'renderer',
        'branding',
        'plysmith-icon-black.ico',
      ),
    )
  ).size > 0,
);

const application = await electron.launch({
  executablePath: path.join(
    repositoryRoot,
    'node_modules',
    'electron',
    'dist',
    'electron.exe',
  ),
  args: [
    path.join(repositoryRoot, 'build', 'desktop', 'main.mjs'),
    '--application-home',
    repositoryRoot,
    '--install-root',
    repositoryRoot,
  ],
  cwd: repositoryRoot,
});
const processOutput: string[] = [];
application.process().stdout?.on('data', (chunk: Buffer) => {
  processOutput.push(chunk.toString());
});
application.process().stderr?.on('data', (chunk: Buffer) => {
  processOutput.push(chunk.toString());
});

try {
  const window = await application.firstWindow();
  const pageErrors: string[] = [];
  window.on('pageerror', (error) => pageErrors.push(error.message));
  window.on('console', (message) => {
    if (message.type() === 'error') {
      pageErrors.push(message.text());
    }
  });

  await window.getByRole('heading', { level: 1 }).waitFor();
  await Promise.any([
    window.getByText('Connected').first().waitFor(),
    window.getByText('Verbunden').first().waitFor(),
  ]);

  const brandIcon = window.locator('aside img').first();
  await brandIcon.waitFor();
  const brandImage = await brandIcon.evaluate((element) => {
    const image = element as {
      complete: boolean;
      currentSrc: string;
      naturalHeight: number;
      naturalWidth: number;
    };
    return {
      complete: image.complete,
      currentSource: image.currentSrc,
      naturalHeight: image.naturalHeight,
      naturalWidth: image.naturalWidth,
    };
  });
  assert.equal(brandImage.complete, true);
  assert.ok(brandImage.naturalWidth > 0);
  assert.ok(brandImage.naturalHeight > 0);
  assert.match(brandImage.currentSource, /plysmith-icon-white-(32|64)\.png$/);
  assert.equal(
    await window.locator('link[rel="icon"]').getAttribute('href'),
    './branding/favicon.ico',
  );

  assert.equal(await window.getByRole('radio').count(), 2);
  assert.equal(await window.getByRole('button').count(), 1);
  const radios = window.getByRole('radio');
  const selectedIndex = (await radios.nth(0).isChecked()) ? 0 : 1;
  const expectedLocale = selectedIndex === 0 ? 'de-DE' : 'en-GB';
  const expectedLanguageControlLabel =
    selectedIndex === 0 ? 'Sprache auswählen' : 'Choose language';
  assert.equal(
    await window.locator('html').getAttribute('lang'),
    expectedLocale,
  );
  assert.equal(
    await window.getByRole('radiogroup').getAttribute('aria-label'),
    expectedLanguageControlLabel,
  );
  const otherIndex = selectedIndex === 0 ? 1 : 0;
  const languageLabels = ['Deutsch', 'English'] as const;
  const selectedLabel = window.getByText(languageLabels[selectedIndex]!, {
    exact: true,
  });
  const otherLabel = window.getByText(languageLabels[otherIndex]!, {
    exact: true,
  });
  const applyButton = window.getByRole('button');
  assert.equal(await applyButton.isDisabled(), true);
  await otherLabel.click();
  assert.equal(await applyButton.isEnabled(), true);
  await selectedLabel.click();
  assert.equal(await applyButton.isDisabled(), true);

  const accessibility = await new AxeBuilder({ page: window })
    .setLegacyMode()
    .analyze();
  if (accessibility.violations.length > 0) {
    console.error(
      JSON.stringify(
        accessibility.violations.map(({ id, nodes }) => ({
          id,
          nodes: nodes.map(({ html, target }) => ({ html, target })),
        })),
      ),
    );
  }
  assert.deepEqual(
    accessibility.violations.map(({ id }) => id),
    [],
  );
  if (pageErrors.length > 0) {
    console.error(
      JSON.stringify({
        pageErrors,
        inlineStyles: await window.locator('style').allTextContents(),
      }),
    );
  }
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'));

  await window.screenshot({ path: screenshotPath, fullPage: true });
  console.log(
    JSON.stringify({
      title: await window.title(),
      heading: await window.getByRole('heading', { level: 1 }).innerText(),
      screenshotPath,
    }),
  );
} catch (error) {
  console.error(processOutput.join('').trim());
  throw error;
} finally {
  await application.close();
}
