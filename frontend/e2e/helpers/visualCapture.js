/**
 * Скриншоты шагов для visual e2e.
 * Включение: E2E_VISUAL=1 (ставится автоматически через playwright.visual.config.js).
 *
 * Файлы попадают в test-results/<test>/NN-label.png и в HTML-отчёт как attachments.
 * Сводка для AI: e2e/artifacts/visual-manifest.json
 */

function isVisualMode() {
  return process.env.E2E_VISUAL === '1' || process.env.PW_VISUAL === '1';
}

function sanitizeLabel(label) {
  return String(label || 'step')
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80) || 'step';
}

async function captureStep(page, testInfo, label, opts = {}) {
  const safe = sanitizeLabel(label);
  const screenshotPath = testInfo.outputPath(`${safe}.png`);

  await page.screenshot({
    path: screenshotPath,
    fullPage: opts.fullPage !== false,
    animations: opts.animations || 'disabled',
  });

  await testInfo.attach(safe, {
    path: screenshotPath,
    contentType: 'image/png',
  });

  return screenshotPath;
}

async function captureLocator(locator, testInfo, label) {
  const safe = sanitizeLabel(label);
  const screenshotPath = testInfo.outputPath(`${safe}.png`);

  await locator.screenshot({ path: screenshotPath });
  await testInfo.attach(safe, {
    path: screenshotPath,
    contentType: 'image/png',
  });

  return screenshotPath;
}

module.exports = {
  isVisualMode,
  sanitizeLabel,
  captureStep,
  captureLocator,
};
