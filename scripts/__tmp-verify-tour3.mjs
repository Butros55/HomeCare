/* Throwaway-Verifikation: Tour-Feinschliff (Positionierung, neue Flows, Mobile/Tablet). */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:3000';
const SHOTS = process.env.VERIFY_SHOTS ?? '.';
const errors = [];

const browser = await chromium.launch();

async function login(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.fill('input[type="email"]', 'owner@demo.example');
  await page.fill('input[type="password"]', 'Demo1234!');
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 120_000 });
  return page;
}

const dlg = (page) => page.locator('[role="dialog"][aria-modal="true"][data-tour-overlay]');
// Popover vollständig im Viewport?
async function popInViewport(page) {
  return page.evaluate(() => {
    const overlay = document.querySelector('[data-tour-overlay]');
    if (!overlay) return null;
    const card = overlay.querySelector('.shadow-\\[var\\(--shadow-popover\\)\\]')?.parentElement;
    const el = card ?? overlay;
    const rect = el.getBoundingClientRect();
    return rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight + 1 && rect.right <= window.innerWidth + 1;
  });
}

// =========================== DESKTOP ===========================
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
const page = await login(ctx);

// 1) Dashboard-Tour (Team)
await page.waitForTimeout(2000);
const dash = await dlg(page).innerText().catch(() => '');
console.log('DASHBOARD_TOUR:', dash.includes('Dein Dashboard'));
for (let i = 0; i < 3; i++) {
  await dlg(page).locator('button', { hasText: /Weiter|Fertig/ }).click();
  await page.waitForTimeout(1100);
}
console.log('DASHBOARD_LAST_IN_VIEW:', await popInViewport(page));
await page.screenshot({ path: `${SHOTS}/t3-dashboard.png` });
await dlg(page).locator('button', { hasText: 'Fertig' }).click().catch(() => {});
await page.waitForTimeout(600);

// 2) Kunden: großer Listen-Schritt → zentriert & im Viewport
await page.goto(`${BASE}/customers`, { waitUntil: 'networkidle', timeout: 120_000 });
await page.waitForTimeout(2100);
await dlg(page).locator('button', { hasText: 'Weiter' }).click();
await page.waitForTimeout(1100);
await dlg(page).locator('button', { hasText: 'Weiter' }).click();
await page.waitForTimeout(1200);
const custList = await dlg(page).innerText().catch(() => '');
console.log('CUSTOMERS_LIST_STEP:', custList.includes('Kundenliste'));
console.log('CUSTOMERS_LIST_IN_VIEW:', await popInViewport(page));
await page.screenshot({ path: `${SHOTS}/t3-customers-list-centered.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// 3) Mitarbeiter: Anlege-Flow über Seitenwechsel
await page.goto(`${BASE}/employees`, { waitUntil: 'networkidle', timeout: 120_000 });
await page.waitForTimeout(2100);
console.log('EMP_TOUR:', (await dlg(page).innerText().catch(() => '')).includes('Dein Team'));
await dlg(page).locator('button', { hasText: 'Weiter' }).click();
await page.waitForTimeout(1200);
console.log('EMP_LIST_IN_VIEW:', await popInViewport(page));
await dlg(page).locator('button', { hasText: 'Weiter' }).click();
await page.waitForTimeout(1200);
const empTarget = await dlg(page).innerText().catch(() => '');
console.log('EMP_TARGET_CLICK:', empTarget.includes('Klicke jetzt'));
await page.locator('[data-tour="employees-create-button"]').click();
await page.waitForURL(/employees\/new/, { timeout: 60_000 });
await page.waitForTimeout(2100);
console.log('EMP_FORM_STEP:', (await dlg(page).innerText().catch(() => '')).includes('Stammdaten'));
await page.screenshot({ path: `${SHOTS}/t3-employee-form.png` });
for (let i = 0; i < 2; i++) {
  await dlg(page).locator('button', { hasText: /Weiter|Fertig/ }).click();
  await page.waitForTimeout(1100);
}
console.log('EMP_ACTIONS_STEP:', (await dlg(page).innerText().catch(() => '')).includes('Speichern & einladen'));
await dlg(page).locator('button', { hasText: 'Fertig' }).click();
await page.waitForTimeout(600);

// 4) Kalender: Anlege-Flow in den Dialog hinein
await page.goto(`${BASE}/calendar`, { waitUntil: 'networkidle', timeout: 120_000 });
await page.waitForTimeout(2400);
console.log('CAL_TOUR:', (await dlg(page).innerText().catch(() => '')).includes('Der Kalender'));
for (let i = 0; i < 3; i++) {
  await dlg(page).locator('button', { hasText: 'Weiter' }).click();
  await page.waitForTimeout(1200);
}
const calTarget = await dlg(page).innerText().catch(() => '');
console.log('CAL_TARGET_CLICK:', calTarget.includes('Klicke jetzt'));
await page.locator('[data-tour="calendar-create-button"]').first().click();
await page.waitForTimeout(2000);
const calForm = await dlg(page).innerText().catch(() => '');
console.log('CAL_DIALOG_STEP:', calForm.includes('Kunde, Titel & Status'));
console.log('CAL_APPT_DIALOG_OPEN:', (await page.locator('[role="dialog"]:not([data-tour-overlay])').count()) > 0);
await page.screenshot({ path: `${SHOTS}/t3-calendar-dialog.png` });
// Weiter durch die Dialog-Schritte – der Termin-Dialog darf dabei NICHT schließen
for (let i = 0; i < 3; i++) {
  await dlg(page).locator('button', { hasText: /Weiter|Fertig/ }).click();
  await page.waitForTimeout(1100);
}
console.log('CAL_LAST_STEP:', (await dlg(page).innerText().catch(() => '')).includes('Anlegen'));
console.log('CAL_APPT_STILL_OPEN:', (await page.locator('[role="dialog"]:not([data-tour-overlay])').count()) > 0);
await dlg(page).locator('button', { hasText: 'Fertig' }).click();
await page.waitForTimeout(600);
await page.keyboard.press('Escape');

// 5) Auswertungen: kleinschrittig (6 Schritte)
await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle', timeout: 120_000 });
await page.waitForTimeout(2100);
const stepsSeen = [];
for (let i = 0; i < 6; i++) {
  const text = await dlg(page).innerText().catch(() => '');
  const match = text.match(/SCHRITT (\d) VON (\d)/i);
  stepsSeen.push(match ? `${match[1]}/${match[2]}` : '?');
  const inView = await popInViewport(page);
  if (!inView) stepsSeen.push(`STEP${i}-OFFSCREEN`);
  if (text.includes('Diagramme')) await page.screenshot({ path: `${SHOTS}/t3-reports-charts.png` });
  const btn = dlg(page).locator('button', { hasText: /Weiter|Fertig/ });
  if (await btn.count()) { await btn.click(); await page.waitForTimeout(1150); } else break;
}
console.log('REPORTS_STEPS:', JSON.stringify(stepsSeen));
await ctx.close();

// =========================== MOBILE (375×812) ===========================
const mctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: 'de-DE' });
const mpage = await login(mctx);
await mpage.waitForTimeout(2000);
// Mein-Tag? Nein: owner ist team → dashboard-Tour bereits COMPLETED → keine. Kunden testen:
await mpage.goto(`${BASE}/customers`, { waitUntil: 'networkidle', timeout: 120_000 });
await mpage.waitForTimeout(2100);
const mCust = await dlg(mpage).count();
console.log('MOBILE_TOUR_STARTS:', mCust === 0 ? 'ALREADY_DONE(ok)' : 'OPEN');
if (mCust > 0) await mpage.keyboard.press('Escape');
// Hilfe-Button neu starten und alle Schritte auf Viewport prüfen
await mpage.locator('header button[aria-label="Hinweise zu dieser Seite anzeigen"]').click();
await mpage.waitForTimeout(1500);
let mobileOk = true;
for (let i = 0; i < 4; i++) {
  const inView = await popInViewport(mpage);
  if (inView === false) { mobileOk = false; console.log(`MOBILE_STEP_${i}_OFFSCREEN`); }
  if (i === 2) await mpage.screenshot({ path: `${SHOTS}/t3-mobile-list.png` });
  const btn = dlg(mpage).locator('button', { hasText: /Weiter|Fertig/ });
  if (await btn.count()) { await btn.click(); await mpage.waitForTimeout(1100); } else break;
}
console.log('MOBILE_ALL_IN_VIEW:', mobileOk);
await mpage.screenshot({ path: `${SHOTS}/t3-mobile-target.png` });
await mpage.keyboard.press('Escape');
await mctx.close();

// =========================== TABLET (820×1180) ===========================
const tctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, locale: 'de-DE' });
const tpage = await login(tctx);
await tpage.goto(`${BASE}/settings?tab=leitung`, { waitUntil: 'networkidle', timeout: 120_000 });
await tpage.waitForTimeout(2100);
const tCount = await dlg(tpage).count();
if (tCount === 0) {
  await tpage.locator('header button[aria-label="Hinweise zu dieser Seite anzeigen"]').click();
  await tpage.waitForTimeout(1400);
}
let tabletOk = true;
for (let i = 0; i < 6; i++) {
  const inView = await popInViewport(tpage);
  if (inView === false) { tabletOk = false; console.log(`TABLET_STEP_${i}_OFFSCREEN`); }
  if (i === 3) await tpage.screenshot({ path: `${SHOTS}/t3-tablet-leitung.png` });
  const btn = dlg(tpage).locator('button', { hasText: /Weiter|Fertig/ });
  if (await btn.count()) { await btn.click(); await tpage.waitForTimeout(1100); } else break;
}
console.log('TABLET_ALL_IN_VIEW:', tabletOk);
await tctx.close();

await browser.close();
console.log('ERRORS:', JSON.stringify(errors.slice(0, 6)));
console.log('DONE');
