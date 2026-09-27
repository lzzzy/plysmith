import assert from 'node:assert/strict';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AxeBuilder } from '@axe-core/playwright';
import {
  _electron as electron,
  type Locator,
  type Page,
} from '@playwright/test';

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

  const navigation = window.getByRole('navigation', { name: 'Plysmith' });
  await navigation.waitFor();
  if (process.argv.includes('--ux-followup')) {
    await window
      .getByText(
        /nicht mehr vorhanden.*eigenen Arbeitsstand|no longer exists.*own work/i,
      )
      .waitFor();
    const restoredBoard = window.getByRole('grid', {
      name: /Schachbrett|Chess board/,
    });
    await restoredBoard.waitFor();
    assert.equal(await restoredBoard.getByRole('gridcell').count(), 64);
    await verifyAccessibility(window, 'startup-fallback-analysis');
    await window.screenshot({
      path: path.join(verificationDirectory, 'startup-fallback-analysis.png'),
      fullPage: true,
    });
  }
  await navigation.getByRole('button', { name: /Verwalten|Manage/ }).click();
  await Promise.race([
    Promise.any([
      window.getByRole('heading', { name: 'Arbeitskontexte' }).waitFor(),
      window.getByRole('heading', { name: 'Working contexts' }).waitFor(),
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

  const inventoryRows = window
    .locator('section')
    .filter({ has: window.locator('#inventory-title') })
    .locator('button[aria-pressed]');
  let verifiedInventoryPreview = false;
  if ((await inventoryRows.count()) > 0) {
    const selectedRow = inventoryRows.first();
    if ((await selectedRow.getAttribute('aria-pressed')) !== 'true') {
      await selectedRow.click();
    }
    const preview = window.locator('[data-inventory-content-preview]');
    await preview.waitFor();
    await verifyInventoryPreviewSeparator(preview);
    const previewBoard = preview.getByRole('grid');
    await verifySquareBoard(previewBoard);
    assert.equal(await previewBoard.getAttribute('aria-readonly'), 'true');
    const rootSquares = await previewBoard
      .getByRole('gridcell')
      .allTextContents();
    const next = preview.getByRole('button', {
      name: /Einen Zug vor|Next move/,
    });
    if (await next.isEnabled()) {
      await next.click();
      assert.notDeepEqual(
        await previewBoard.getByRole('gridcell').allTextContents(),
        rootSquares,
      );
      await preview
        .getByRole('button', { name: /Ausgangsstellung|Starting position/ })
        .click();
      assert.deepEqual(
        await previewBoard.getByRole('gridcell').allTextContents(),
        rootSquares,
      );
    }
    await verifyAccessibility(window, 'inventory-details');
    await window.evaluate(() => {
      const browser = globalThis as unknown as {
        scrollTo(x: number, y: number): void;
      };
      browser.scrollTo(0, 0);
    });
    await window.screenshot({
      path: path.join(verificationDirectory, 'inventory-details.png'),
      fullPage: true,
    });
    const originalViewport = await window.evaluate(() => {
      const browser = globalThis as unknown as {
        readonly innerWidth: number;
        readonly innerHeight: number;
      };
      return { width: browser.innerWidth, height: browser.innerHeight };
    });
    await window.setViewportSize({ width: 390, height: 844 });
    await verifyInventoryPreviewSeparator(preview);
    await verifySquareBoard(previewBoard);
    assert.equal(
      await window.evaluate(() => {
        const browser = globalThis as unknown as {
          readonly document: {
            readonly documentElement: { scrollWidth: number };
          };
          readonly innerWidth: number;
        };
        return (
          browser.document.documentElement.scrollWidth <= browser.innerWidth
        );
      }),
      true,
    );
    await verifyAccessibility(window, 'inventory-details-narrow');
    await window.evaluate(() => {
      const browser = globalThis as unknown as {
        scrollTo(x: number, y: number): void;
      };
      browser.scrollTo(0, 0);
    });
    await window.screenshot({
      path: path.join(verificationDirectory, 'inventory-details-narrow.png'),
      fullPage: true,
    });
    await window.setViewportSize(originalViewport);
    await selectedRow.click();
    await window.locator('#work-scope:enabled').waitFor();
    verifiedInventoryPreview = true;
  }

  await activityNavigation
    .getByRole('button', { name: /Analysieren|Analyse/ })
    .click();
  const analysisBoard = window.getByRole('grid', {
    name: /Schachbrett|Chess board/,
  });
  await analysisBoard.waitFor();
  assert.equal(await window.getByRole('gridcell').count(), 64);
  assert.equal(
    await window.evaluate(async () => {
      const browser = globalThis as unknown as {
        readonly document: {
          readonly fonts: {
            readonly ready: Promise<unknown>;
            check(font: string, text?: string): boolean;
            load(font: string, text?: string): Promise<readonly unknown[]>;
          };
        };
      };
      await browser.document.fonts.ready;
      await browser.document.fonts.load('32px "Plysmith Chess"', '♔');
      return browser.document.fonts.check('32px "Plysmith Chess"', '♔');
    }),
    true,
  );
  await verifySquareBoard(analysisBoard);
  const topLeftSquare = analysisBoard.getByRole('gridcell').first();
  assert.match((await topLeftSquare.getAttribute('aria-label')) ?? '', /^a8,/);
  const flipBoardButton = window.getByRole('button', {
    name: /Brett drehen|Flip board/,
  });
  await flipBoardButton.click();
  assert.match((await topLeftSquare.getAttribute('aria-label')) ?? '', /^h1,/);
  await verifySquareBoard(analysisBoard);
  await flipBoardButton.click();
  assert.match((await topLeftSquare.getAttribute('aria-label')) ?? '', /^a8,/);
  assert.equal(
    await activityNavigation
      .getByRole('button', { name: /Ausspielen|Play out/ })
      .isDisabled(),
    false,
  );
  assert.equal(
    await activityNavigation.getByRole('button', { name: 'Live' }).isDisabled(),
    true,
  );
  const continuationList = window.getByRole('list', {
    name: /Fortsetzungszüge|Continuation moves/,
  });
  assert.equal(await continuationList.getAttribute('tabindex'), '0');
  await continuationList.focus();
  assert.equal(
    await continuationList.evaluate(
      (element) => element === element.ownerDocument.activeElement,
    ),
    true,
  );
  await verifyAccessibility(window, 'analysis');
  await window.evaluate(() => {
    const browser = globalThis as unknown as {
      scrollTo(x: number, y: number): void;
    };
    browser.scrollTo(0, 0);
  });
  await window.screenshot({
    path: path.join(verificationDirectory, 'analysis.png'),
    fullPage: true,
  });

  await activityRail
    .getByRole('button', { name: /Einstellungen|Settings/ })
    .click();
  const languageGroup = window.getByRole('radiogroup', {
    name: /Sprache auswählen|Choose language/,
  });
  assert.equal(await languageGroup.getByRole('radio').count(), 2);
  const radios = languageGroup.getByRole('radio');
  const languageSection = window.locator('section').filter({
    has: languageGroup,
  });
  const selectedIndex = (await radios.nth(0).isChecked()) ? 0 : 1;
  const expectedLocale = selectedIndex === 0 ? 'de-DE' : 'en-GB';
  assert.equal(
    await window.locator('html').getAttribute('lang'),
    expectedLocale,
  );
  const otherIndex = selectedIndex === 0 ? 1 : 0;
  const languageLabels = ['Deutsch', 'English'] as const;
  const selectedLabel = languageGroup.getByText(
    languageLabels[selectedIndex]!,
    {
      exact: true,
    },
  );
  const otherLabel = languageGroup.getByText(languageLabels[otherIndex]!, {
    exact: true,
  });
  const applyButton = languageSection.getByRole('button', {
    name: /Übernehmen|Apply/,
  });
  assert.equal(await applyButton.isDisabled(), true);
  await otherLabel.click();
  assert.equal(await applyButton.isEnabled(), true);
  await selectedLabel.click();
  assert.equal(await applyButton.isDisabled(), true);
  const engineName = window.getByLabel(/Anzeigename|Display name/);
  if (await engineName.isVisible()) {
    const originalName = await engineName.inputValue();
    await engineName.fill(`${originalName} draft`);
    const enginePicker = window.getByRole('combobox', {
      name: /Konfiguration|Configuration/,
    });
    const selectedEngine = await enginePicker.inputValue();
    const otherEngine = await enginePicker
      .locator('option')
      .evaluateAll(
        (options, selected) =>
          options
            .find((option) => option.getAttribute('value') !== selected)
            ?.getAttribute('value'),
        selectedEngine,
      );
    if (otherEngine !== undefined && otherEngine !== null) {
      await enginePicker.selectOption(otherEngine);
      await enginePicker.selectOption(selectedEngine);
      assert.equal(await engineName.inputValue(), `${originalName} draft`);
    }
    await activityNavigation
      .getByRole('button', { name: /Analysieren|Analyse/ })
      .click();
    await activityRail
      .getByRole('button', { name: /Einstellungen|Settings/ })
      .click();
    assert.equal(await engineName.inputValue(), `${originalName} draft`);
    const discardEngine = window.getByRole('button', {
      name: /Änderungen verwerfen|Discard changes/,
    });
    await discardEngine.click();
    assert.equal(await engineName.inputValue(), originalName);
    const threads = window.getByLabel('Threads', { exact: true });
    if (await threads.isVisible()) {
      const originalThreads = await threads.inputValue();
      if (originalThreads === '0')
        await engineName.fill(`${originalName} validation`);
      await threads.fill('0');
      await window
        .getByRole('button', {
          name: /Geänderte Konfiguration speichern|Save changed configuration/,
        })
        .click();
      assert.equal(await threads.inputValue(), '0');
      assert.equal(await threads.getAttribute('aria-invalid'), 'true');
      assert.equal(
        await window.locator('#engine-threads-error').isVisible(),
        true,
      );
      await verifyAccessibility(window, 'settings-invalid-draft');
      await discardEngine.click();
      assert.equal(await threads.inputValue(), originalThreads);
      assert.equal(await threads.getAttribute('aria-invalid'), null);
    }
  }
  await verifyAccessibility(window, 'settings');
  await window.evaluate(() => {
    const browser = globalThis as unknown as {
      scrollTo(x: number, y: number): void;
    };
    browser.scrollTo(0, 0);
  });
  await window.screenshot({
    path: path.join(verificationDirectory, 'settings.png'),
    fullPage: true,
  });

  await activityNavigation
    .getByRole('button', { name: /Analysieren|Analyse/ })
    .click();
  await window.setViewportSize({ width: 390, height: 844 });
  const narrowAnalysisBoard = window.getByRole('grid', {
    name: /Schachbrett|Chess board/,
  });
  await narrowAnalysisBoard.waitFor();
  await verifySquareBoard(narrowAnalysisBoard);
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
      verifiedInventoryPreview,
      screenshots: [
        'manage.png',
        'analysis.png',
        'settings.png',
        'analysis-narrow.png',
        ...(verifiedInventoryPreview
          ? ['inventory-details.png', 'inventory-details-narrow.png']
          : []),
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

async function verifyInventoryPreviewSeparator(
  preview: Locator,
): Promise<void> {
  const borders = await preview.evaluate((element) => {
    const metadataRow = element.previousElementSibling?.querySelector(
      ':scope > div:last-child',
    );
    if (metadataRow === undefined || metadataRow === null) return undefined;
    const browser = globalThis as unknown as {
      getComputedStyle(element: unknown): {
        readonly borderTopWidth: string;
        readonly borderBottomWidth: string;
      };
    };
    return {
      metadataBottom: Number.parseFloat(
        browser.getComputedStyle(metadataRow).borderBottomWidth,
      ),
      previewTop: Number.parseFloat(
        browser.getComputedStyle(element).borderTopWidth,
      ),
    };
  });
  assert.deepEqual(borders, { metadataBottom: 1, previewTop: 0 });
}

async function verifySquareBoard(board: Locator): Promise<void> {
  const boardBox = await board.boundingBox();
  assert.notEqual(boardBox, null);
  assert.ok(Math.abs(boardBox!.width - boardBox!.height) <= 1);

  const squareSizes = await board.getByRole('gridcell').evaluateAll((cells) =>
    cells.map((cell) => {
      const bounds = cell.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    }),
  );
  assert.equal(squareSizes.length, 64);
  const first = squareSizes[0]!;
  for (const square of squareSizes) {
    assert.ok(Math.abs(square.width - square.height) <= 1);
    assert.ok(Math.abs(square.width - first.width) <= 1);
    assert.ok(Math.abs(square.height - first.height) <= 1);
  }
}
