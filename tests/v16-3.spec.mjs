import { test, expect } from '@playwright/test';

async function openApp(page, view = 'dashboard') {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`/preview-v16/app/index.html?allowLegacy=1&view=${view}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.v163Ready === 'true', null, { timeout: 25_000 });
  await expect(page.locator('body')).toBeVisible();
  return errors;
}

test('dashboard loads V16.3 market regime and release status', async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.locator('#marketRegimeCard')).toBeVisible();
  await expect(page.locator('#marketRegimeCard')).toContainText('محرك حالة السوق');
  await expect(page.locator('#releaseStatusCard')).toContainText('V16.3');
  await expect(page.locator('html')).toHaveAttribute('data-egx-version', '16.3');
  expect(errors).toEqual([]);
});

test('full-market search remains functional', async ({ page }) => {
  await openApp(page, 'market');
  await page.locator('[data-view="market"]').click();
  await page.locator('#marketSearch').fill('HELI');
  await expect(page.locator('#marketResults')).toContainText('HELI');
  await expect(page.locator('#marketResults')).toContainText(/توصيات اليوم|ليس ضمن توصيات اليوم/);
});

test('financial view shows coverage and official disclosure gate', async ({ page }) => {
  await openApp(page, 'fundamentals');
  await page.locator('[data-view="fundamentals"]').click();
  await expect(page.locator('#financialCoverageCard')).toBeVisible();
  await expect(page.locator('#financialCoverageCard')).toContainText('التغطية المالية');
  await expect(page.locator('#officialDisclosureCard')).toContainText('الإفصاحات الرسمية');
  await expect(page.locator('#officialDisclosureCard')).toContainText(/موثق|غير مهيأة|FETCHED|NOT_CONFIGURED/);
});

test('live evidence stays separated from backtest', async ({ page }) => {
  await openApp(page, 'evidence');
  await page.locator('[data-view="evidence"]').click();
  await expect(page.locator('#liveEvidenceV162')).toBeVisible();
  await expect(page.locator('#liveEvidenceV162')).toContainText('السجل الحي');
  await expect(page.locator('#liveEvidenceV162')).toContainText(/صفقات منتهية|Professional Pilot|RESEARCH|PILOT/);
  await expect(page.locator('#modelRows')).toBeVisible();
});

test('portfolio view includes correlation matrix and stress tests', async ({ page }) => {
  await openApp(page, 'portfolio');
  await page.locator('[data-view="portfolio"]').click();
  await expect(page.locator('#correlationRiskCard')).toBeVisible();
  await expect(page.locator('#correlationRiskCard')).toContainText('الارتباط');
  await expect(page.locator('#portfolioStressCard')).toContainText('اختبارات ضغط');
  await expect(page.locator('#portfolioRiskLimit')).toBeVisible();
});

test('alerts drawer opens and supports local-notification opt-in', async ({ page }) => {
  await openApp(page);
  await page.locator('#alertsButton').click();
  await expect(page.locator('#v163AlertDrawer')).toHaveClass(/open/);
  await expect(page.locator('#alertsList')).toBeVisible();
  await expect(page.locator('#enableBrowserNotifications')).toBeVisible();
  await page.locator('#markAlertsRead').click();
  await expect(page.locator('#alertsCount')).toBeHidden();
  await page.locator('#closeAlertsButton').click();
  await expect(page.locator('#v163AlertDrawer')).not.toHaveClass(/open/);
});

test('mobile layout keeps primary navigation and V16.3 panels usable', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-specific acceptance');
  await openApp(page);
  await expect(page.locator('.tabs')).toBeVisible();
  await expect(page.locator('#marketRegimeCard')).toBeVisible();
  const box = await page.locator('#marketRegimeCard').boundingBox();
  expect(box?.width || 0).toBeLessThanOrEqual(390);
  await page.locator('#alertsButton').click();
  const drawer = await page.locator('.v163-panel').boundingBox();
  expect(drawer?.width || 0).toBeLessThanOrEqual(390);
});
