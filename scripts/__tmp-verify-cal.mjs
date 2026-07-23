/* Throwaway-Verifikation: portierter StudyMate-Kalender in HomeCare. */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:3000';
const SHOTS = process.env.VERIFY_SHOTS ?? '.';
const errors = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 250)}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text().slice(0, 200)}`));

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.fill('input[type="email"]', 'owner@demo.example');
await page.fill('input[type="password"]', 'Demo1234!');
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard/, { timeout: 120_000 });

// 1) Monatsansicht: Sidebar sichtbar + Kalender eingebettet + Chips geladen
await page.goto(`${BASE}/calendar`, { waitUntil: 'networkidle', timeout: 120_000 });
await page.waitForTimeout(2500);
const sidebarVisible = await page.locator('aside', { hasText: 'Kalender' }).first().isVisible();
console.log('APP_SIDEBAR_VISIBLE:', sidebarVisible);
const main = page.locator('main');
console.log('HAS_VIEW_TABS:', (await main.locator('[role="tablist"][aria-label="Kalenderansicht"]').count()) > 0);
console.log('HAS_MONTH_LABEL:', (await main.locator('text=Juli').count()) > 0);
await page.waitForTimeout(1500);
const chipCount = await main.locator('[data-day-key] span.truncate').count();
console.log('MONTH_CHIPS_RENDERED:', chipCount > 0, `(${chipCount})`);
await page.screenshot({ path: `${SHOTS}/cal-month.png`, fullPage: false });

// 2) Dichte-Umschalter Kompakt (dots)
await main.locator('button[aria-label="Kompakt"]').click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${SHOTS}/cal-month-dots.png` });
await main.locator('button[aria-label="Detail"]').click();
await page.waitForTimeout(700);

// 3) Tag anklicken → Morph in die Tages-Timeline
const dayButton = main.locator(`[data-day-key="2026-07-23"]`);
await dayButton.click();
await page.waitForTimeout(1200);
const timelineVisible = (await main.locator('text=Donnerstag - 23. Juli').count()) > 0;
console.log('DAY_TIMELINE_OPEN:', timelineVisible);
await page.screenshot({ path: `${SHOTS}/cal-day.png` });

// 4) Woche via Tabs
await main.locator('[role="tab"]', { hasText: 'Woche' }).click();
await page.waitForTimeout(1200);
console.log('WEEK_COLUMNS:', await main.locator('[data-visible-day-count]').getAttribute('data-visible-day-count'));
await page.screenshot({ path: `${SHOTS}/cal-week.png` });

// 5) Event-Klick → Termin-Drawer
const eventButtons = main.locator('button:has-text("Brinkmann"), button:has-text("Austermann"), button:has-text("Wesselmann")');
if (await eventButtons.count()) {
  await eventButtons.first().click();
  await page.waitForTimeout(1500);
  const drawerText = await page.locator('body').innerText();
  console.log('DRAWER_OPEN:', drawerText.includes('Details schließen') || drawerText.includes('Bearbeiten'));
  await page.screenshot({ path: `${SHOTS}/cal-drawer.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
} else {
  console.log('DRAWER_OPEN: SKIPPED (kein Event sichtbar)');
}

// 6) Jahresansicht via Tabs (Zoom)
await main.locator('[role="tab"]', { hasText: 'Monat' }).click();
await page.waitForTimeout(900);
await main.locator('[role="tab"]', { hasText: 'Jahr' }).click();
await page.waitForTimeout(1200);
console.log('YEAR_VIEW:', (await main.locator('h3', { hasText: '2026' }).count()) > 0);
await page.screenshot({ path: `${SHOTS}/cal-year.png` });

// 7) Zurück zu Monat, Seitenpanel öffnen (Ebenen)
await main.locator('[role="tab"]', { hasText: 'Monat' }).click();
await page.waitForTimeout(1000);
await main.locator('button[aria-label="Kalender-Seitenleiste öffnen"]').first().click();
await page.waitForTimeout(800);
const panelText = await page.locator('main').innerText();
console.log('PANEL_LAYERS:', panelText.includes('Ebenen') && panelText.includes('Geplant'));
await page.screenshot({ path: `${SHOTS}/cal-panel.png` });

// 8) Plus → Termin-Formular
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const closePanel = page.locator('button[aria-label="Kalender-Seitenleiste schließen"]');
if (await closePanel.count()) await closePanel.click();
await page.waitForTimeout(400);
await main.locator('button[aria-label="Neuen Termin anlegen"]').first().click();
await page.waitForTimeout(1000);
console.log('CREATE_DIALOG:', (await page.locator('[role="dialog"]', { hasText: 'Termin anlegen' }).count()) > 0);
await page.keyboard.press('Escape');

await ctx.close();
await browser.close();
console.log('ERRORS:', JSON.stringify(errors.slice(0, 8)));
console.log('DONE');
