import assert from 'node:assert/strict';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AxeBuilder } from '@axe-core/playwright';
import { _electron as electron, type Page } from '@playwright/test';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const verificationDirectory = path.join(
  repositoryRoot,
  'build',
  'desktop',
  'verification',
);
await mkdir(verificationDirectory, { recursive: true });
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
let observedWindow: Page | undefined;
const requestFailures: { readonly url: string; readonly error?: string }[] = [];
application.process().stdout?.on('data', (chunk: Buffer) => {
  processOutput.push(chunk.toString());
});
application.process().stderr?.on('data', (chunk: Buffer) => {
  processOutput.push(chunk.toString());
});

try {
  const window = await application.firstWindow();
  observedWindow = window;
  const pageErrors: string[] = [];
  window.on('pageerror', (error) => pageErrors.push(error.message));
  window.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });
  window.on('requestfailed', (request) => {
    const failure = request.failure();
    requestFailures.push({
      url: request.url(),
      ...(failure === null ? {} : { error: failure.errorText }),
    });
  });

  await Promise.race([
    Promise.any([
      window.getByRole('heading', { name: 'Verwalten' }).waitFor(),
      window.getByRole('heading', { name: 'Manage' }).waitFor(),
    ]),
    window
      .getByText(
        /Application Host nicht erreichbar|Application Host unavailable/,
      )
      .waitFor()
      .then(() => {
        throw new Error('Desktop entered the unavailable state.');
      }),
  ]);
  await Promise.any([
    window.getByText('Verbunden').first().waitFor(),
    window.getByText('Connected').first().waitFor(),
  ]);

  const brandIcon = window.locator('aside img').first();
  const brandImage = await brandIcon.evaluate((element) => {
    const image = element as unknown as {
      readonly complete: boolean;
      readonly currentSrc: string;
      readonly naturalHeight: number;
      readonly naturalWidth: number;
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
  const activityRail = window.getByRole('complementary', { name: 'Plysmith' });
  const activityNavigation = activityRail.getByRole('navigation', {
    name: 'Plysmith',
  });

  const scopeSelector = window.getByRole('combobox', {
    name: /Arbeitskontext|Working context/,
  });
  await scopeSelector.waitFor();
  assert.ok((await scopeSelector.locator('option').count()) >= 1);
  await verifyAccessibility(window, 'manage');
  await window.screenshot({
    path: path.join(verificationDirectory, 'manage.png'),
    fullPage: true,
  });

  await activityNavigation
    .getByRole('button', { name: /Analysieren|Analyse/ })
    .click();
  await window.getByRole('grid', { name: /Schachbrett|Chess board/ }).waitFor();
  assert.equal(await window.getByRole('gridcell').count(), 64);
  assert.equal(
    await activityNavigation
      .getByRole('button', { name: /Ausspielen|Play out/ })
      .isDisabled(),
    true,
  );
  assert.equal(
    await activityNavigation.getByRole('button', { name: 'Live' }).isDisabled(),
    true,
  );
  await verifyAccessibility(window, 'analysis');
  await window.screenshot({
    path: path.join(verificationDirectory, 'analysis.png'),
    fullPage: true,
  });

  await activityRail
    .getByRole('button', { name: /Einstellungen|Settings/ })
    .click();
  assert.equal(await window.getByRole('radio').count(), 2);
  const radios = window.getByRole('radio');
  const selectedIndex = (await radios.nth(0).isChecked()) ? 0 : 1;
  const expectedLocale = selectedIndex === 0 ? 'de-DE' : 'en-GB';
  assert.equal(
    await window.locator('html').getAttribute('lang'),
    expectedLocale,
  );
  const otherIndex = selectedIndex === 0 ? 1 : 0;
  const languageLabels = ['Deutsch', 'English'] as const;
  const selectedLabel = window.getByText(languageLabels[selectedIndex]!, {
    exact: true,
  });
  const otherLabel = window.getByText(languageLabels[otherIndex]!, {
    exact: true,
  });
  const applyButton = window.getByRole('button', {
    name: /Übernehmen|Apply/,
  });
  assert.equal(await applyButton.isDisabled(), true);
  await otherLabel.click();
  assert.equal(await applyButton.isEnabled(), true);
  await selectedLabel.click();
  assert.equal(await applyButton.isDisabled(), true);
  await verifyAccessibility(window, 'settings');
  await window.screenshot({
    path: path.join(verificationDirectory, 'settings.png'),
    fullPage: true,
  });

  await activityNavigation
    .getByRole('button', { name: /Analysieren|Analyse/ })
    .click();
  await window.setViewportSize({ width: 390, height: 844 });
  await window.getByRole('grid', { name: /Schachbrett|Chess board/ }).waitFor();
  assert.equal(
    await window.evaluate(() => {
      const browser = globalThis as unknown as {
        readonly document: {
          readonly documentElement: { scrollWidth: number };
        };
        readonly innerWidth: number;
      };
      return browser.document.documentElement.scrollWidth <= browser.innerWidth;
    }),
    true,
  );
  await verifyAccessibility(window, 'analysis-narrow');
  await window.screenshot({
    path: path.join(verificationDirectory, 'analysis-narrow.png'),
    fullPage: true,
  });

  assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
  console.log(
    JSON.stringify({
      title: await window.title(),
      locale: expectedLocale,
      screenshots: [
        'manage.png',
        'analysis.png',
        'settings.png',
        'analysis-narrow.png',
      ].map((file) => path.join(verificationDirectory, file)),
    }),
  );
} catch (error) {
  console.error(processOutput.join('').trim());
  if (observedWindow !== undefined) {
    console.error(
      JSON.stringify({
        url: observedWindow.url(),
        body: await observedWindow
          .locator('body')
          .innerText()
          .catch(() => ''),
        requestFailures,
      }),
    );
  }
  throw error;
} finally {
  await application.close();
}

async function verifyAccessibility(page: Page, view: string): Promise<void> {
  const accessibility = await new AxeBuilder({ page })
    .setLegacyMode()
    .analyze();
  if (accessibility.violations.length > 0) {
    console.error(
      JSON.stringify({
        view,
        violations: accessibility.violations.map(({ id, nodes }) => ({
          id,
          nodes: nodes.map(({ html, target }) => ({ html, target })),
        })),
      }),
    );
  }
  assert.deepEqual(
    accessibility.violations.map(({ id }) => id),
    [],
  );
}
