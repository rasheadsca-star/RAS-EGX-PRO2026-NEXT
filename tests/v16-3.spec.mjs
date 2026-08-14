import { test, expect } from '@playwright/test';

async function openApp(page, view = 'dashboard') {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));

  await page.goto(
    `/preview-v16/app/index.html?allowLegacy=1&view=${view}`,
    { waitUntil: 'domcontentloaded' },
  );

  await page.waitForFunction(
    () => document.documentElement.dataset.v163Ready === 'true',
    null,
    { timeout: 25_000 },
  );

  await expect(page.locator('body')).toBeVisible();
  return errors;
}

test('dashboard loads V16.3 market regime, session-safe V16.9 basket and release status', async ({ page }) => {
  const errors = await openApp(page);

  await expect(page.locator('#marketRegimeCard')).toBeVisible();
  await expect(page.locator('#marketRegimeCard')).toContainText('محرك حالة السوق');

  // V16.9 remains the primary recommendation surface. The legacy recommendationGrid
  // remains in the DOM for compatibility but must stay hidden behind the protected basket.
  const primaryBasket = page.locator('#v169BasketPanel');
  await expect(primaryBasket).toBeVisible({ timeout: 15_000 });
  await expect(primaryBasket).toContainText(/سلة V16\.9 (للجلسة التالية|مرجعية)/);
  await expect(page.locator('#recommendationGrid')).toBeHidden();

  const primaryCards = primaryBasket.locator('.v169-card');
  await expect(primaryCards.first()).toBeVisible();
  expect(await primaryCards.count()).toBeGreaterThan(0);

  const truth = await page.evaluate(async () => {
    const [decision, priceTruth] = await Promise.all([
      fetch(`../../data/stable/v16-v169-primary-decision.json?v=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()),
      fetch(`../../data/stable/v15-price-truth.json?v=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()),
    ]);
    return {
      recommendationSession: decision.sessionDate || null,
      marketSession: priceTruth.expectedSession || null,
      executionGrade: priceTruth.executionGrade === true,
      practicalReady: decision.practicalReady === true,
      recommendationCount: Array.isArray(decision.recommendations) ? decision.recommendations.length : 0,
    };
  });

  const expectedAligned = Boolean(
    truth.recommendationSession &&
    truth.marketSession &&
    truth.recommendationSession === truth.marketSession,
  );
  const expectedExecutionEligible = Boolean(
    expectedAligned &&
    truth.executionGrade &&
    truth.practicalReady &&
    truth.recommendationCount > 0,
  );

  await expect(primaryBasket).toHaveAttribute('data-session-aligned', String(expectedAligned));
  await expect(primaryBasket).toHaveAttribute('data-execution-eligible', String(expectedExecutionEligible));

  if (expectedExecutionEligible) {
    await expect(primaryBasket).toContainText('تأكيد الافتتاح مطلوب');
  } else if (expectedAligned) {
    await expect(primaryBasket).toContainText('التنفيذ مغلق');
    await expect(primaryBasket).toContainText('0% تنفيذ');
  } else {
    await expect(primaryBasket).toContainText('اختلاف جلسة');
  }

  await expect(page.locator('#releaseStatusCard')).toContainText('V16.3');
  await expect(page.locator('html')).toHaveAttribute('data-egx-version', '16.3');

  expect(errors).toEqual([]);
});

test('full-market search remains functional', async ({ page }) => {
  await openApp(page, 'market');
  await page.locator('[data-view="market"]').click();
  await page.locator('#marketSearch').fill('HELI');

  await expect(page.locator('#marketResults')).toContainText('HELI');
  await expect(page.locator('#marketResults')).toContainText(
    /توصيات اليوم|ليس ضمن توصيات اليوم/,
  );
});

test('financial view shows coverage and official disclosure gate', async ({ page }) => {
  await openApp(page, 'fundamentals');
  await page.locator('[data-view="fundamentals"]').click();

  await expect(page.locator('#financialCoverageCard')).toBeVisible();
  await expect(page.locator('#financialCoverageCard')).toContainText('التغطية المالية');
  await expect(page.locator('#officialDisclosureCard')).toContainText('الإفصاحات الرسمية');
  await expect(page.locator('#officialDisclosureCard')).toContainText(
    /موثق|غير مهيأة|FETCHED|NOT_CONFIGURED/,
  );

  const recommendation = page.locator('[data-fin-rec]').first();
  if (await recommendation.count()) {
    await recommendation.click();
    await expect(page.locator('#financialCoverageCard')).toBeVisible();
    await expect(page.locator('#officialDisclosureCard')).toBeVisible();
  }
});

test('live evidence stays separated from backtest', async ({ page }) => {
  await openApp(page, 'evidence');
  await page.locator('[data-view="evidence"]').click();

  await expect(page.locator('#liveEvidenceV162')).toBeVisible();
  await expect(page.locator('#liveEvidenceV162')).toContainText('السجل الحي');
  await expect(page.locator('#liveEvidenceV162')).toContainText(
    /صفقات منتهية|Professional Pilot|RESEARCH|PILOT/,
  );
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
