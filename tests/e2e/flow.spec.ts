import { expect, test, type Page } from '@playwright/test';

/**
 * Durchgehender Kernablauf (Anforderung 26, Schritte 1–12):
 * Anmeldung → Kunde (inkl. Mock-Geocoding) → Mitarbeiter → Budget & Stunden →
 * Serientermin → Kalender → Zuweisung → Mitarbeitersicht → Route → Dashboard →
 * Mandantentrennung.
 */

const OWNER = { email: 'owner@demo.example', password: 'Demo1234!' };
const ANNA = { email: 'anna@demo.example', password: 'Demo1234!' };
const FREMD = { email: 'fremd@demo.example', password: 'Demo1234!' };

async function login(page: Page, credentials: { email: string; password: string }) {
  // Die kontextbezogene Hinweis-Tour startet beim ersten Besuch einer Seite
  // automatisch und legt ein modales Overlay über die Seite, das Klicks abfängt.
  // Sobald sie eine Aktion blockiert, automatisch überspringen (alle Seiten).
  await page.addLocatorHandler(
    page.getByRole('button', { name: 'Überspringen' }),
    async (skip) => {
      await skip.click();
    },
  );
  await page.goto('/login');
  await page.locator('#login-email').fill(credentials.email);
  await page.locator('#login-password').fill(credentials.password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.waitForURL('**/dashboard');
}

/** Radix-Select bedienen: Trigger öffnen, Option wählen. */
async function selectOption(page: Page, triggerLabel: string | RegExp, optionName: string | RegExp) {
  await page.getByRole('combobox', { name: triggerLabel }).click();
  await page.getByRole('option', { name: optionName }).first().click();
}

test.describe.configure({ mode: 'serial' });

let customerUrl = '';

test('1–2: Owner meldet sich an und legt einen Kunden an (Mock-Geocoding)', async ({ page }) => {
  await login(page, OWNER);
  await expect(page.getByRole('heading', { name: /Willkommen, Katrin/ })).toBeVisible();

  await page.goto('/customers/new');
  await page.getByLabel('Vorname').fill('Emil');
  await page.getByLabel('Nachname').fill('Endtest');
  await page.getByLabel('Telefon', { exact: true }).fill('+49 251 999999');
  await page.getByLabel('Straße').fill('Teststraße');
  await page.getByLabel('Hausnummer').fill('5');
  await page.getByLabel('PLZ').fill('48143');
  await page.getByLabel('Ort').fill('Münster');
  await page.getByRole('button', { name: 'Kunde anlegen' }).click();

  // Detailseite: Adresse wurde per Mock geokodiert (Karte statt "keine Koordinaten").
  await expect(page.getByRole('heading', { name: 'Emil Endtest' })).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForURL(/\/customers\/(?!new)[^/?#]+$/);
  customerUrl = page.url();
  await expect(page.getByText('Teststraße 5, 48143 Münster').first()).toBeVisible();
  await expect(page.getByText('Keine Koordinaten vorhanden')).toHaveCount(0);
});

test('3: Owner legt einen Mitarbeiter an', async ({ page }) => {
  await login(page, OWNER);
  await page.goto('/employees/new');
  await page.getByLabel('Vorname').fill('Paula');
  await page.getByLabel('Nachname').fill('Probe');
  await page.getByRole('button', { name: 'Mitarbeiter anlegen' }).click();
  await page.waitForURL('**/employees/**');
  await expect(page.getByRole('heading', { name: 'Paula Probe' })).toBeVisible();
});

test('4: Owner lädt das Stundenkonto auf und überträgt Stunden', async ({ page }) => {
  await login(page, OWNER);
  await page.goto(`${customerUrl}?tab=stunden`);

  // Stundenkonto aufladen (10 h) – Konto-Modell (ersetzt das frühere „Budget").
  await page.getByRole('button', { name: 'Aufladen' }).click();
  await page.locator('#topup-minutes').fill('10');
  await page.getByRole('dialog').getByRole('button', { name: 'Aufladen' }).click();
  // Auf die Erfolgsmeldung prüfen ("10 h aufgeladen."), nicht auf das bloße Wort:
  // in der Kontobewegungsliste steht danach zusätzlich "Stunden aufgeladen".
  await expect(page.getByText(/\d+([.,]\d+)?\s*h aufgeladen\./)).toBeVisible();

  // 2,5 h an Paula Probe zuweisen (Parser: "2,5" → 150 Minuten).
  await page.getByRole('button', { name: 'Stunden zuweisen' }).first().click();
  await selectOption(page, 'Mitarbeiter', /Paula Probe/);
  await page.locator('#alloc-duration').fill('2,5');
  await expect(page.getByText('= 150 Minuten')).toBeVisible();
  await page.getByRole('button', { name: 'Weiter zur Bestätigung' }).click();
  await page.getByRole('button', { name: 'Stunden übertragen' }).click();
  await expect(page.getByText(/an Paula Probe übertragen/)).toBeVisible();
  await expect(page.getByText('Paula Probe').first()).toBeVisible();
});

test('5–8: Serientermin anlegen, im Kalender sehen, Anna zuweisen', async ({ page }) => {
  await login(page, OWNER);
  await page.goto('/calendar');
  await page.getByRole('button', { name: 'Neuen Termin anlegen' }).first().click();

  await selectOption(page, 'Kunde', /Emil Endtest/);
  await page.getByLabel('Titel').fill('E2E Serieneinsatz');
  await page.getByLabel('Startzeit').fill('16:00');
  // Wiederholung aktivieren (wöchentlich ist vorausgewählt).
  await page.getByText('Wiederholung', { exact: true }).locator('..').getByRole('switch').click();
  await page.getByRole('button', { name: 'Serie anlegen' }).click();
  await expect(page.getByText('Serientermin angelegt.')).toBeVisible();

  // Termin erscheint im Kalender (Pro-Kalender: Event-Button je Vorkommen).
  await expect(
    page.getByRole('button', { name: 'Termin Emil Endtest öffnen', exact: true }).first(),
  ).toBeVisible();

  // Zuweisung im Drawer: Anna Berg (hat ein Benutzerkonto).
  await page.getByRole('button', { name: 'Termin Emil Endtest öffnen', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'E2E Serieneinsatz' })).toBeVisible();
  await selectOption(page, 'Mitarbeiter zuweisen', /Anna Berg/);
  // 16:00 liegt außerhalb von Annas Verfügbarkeit → Konfliktwarnung ist Pflicht.
  await expect(page.getByRole('alertdialog', { name: 'Trotz Warnungen zuweisen?' })).toBeVisible();
  // Die Meldung nennt konkret Terminzeit + Wochentag + die hinterlegten Fenster.
  await expect(page.getByText(/liegt außerhalb der Verfügbarkeit von Anna Berg/)).toBeVisible();
  await page.getByRole('button', { name: 'Trotzdem zuweisen' }).click();
  await expect(page.getByText('Mitarbeiter zugewiesen.')).toBeVisible();
});

test('9: Anna sieht den zugewiesenen Termin', async ({ page }) => {
  await login(page, ANNA);
  await page.goto('/calendar');
  await expect(
    page.getByRole('button', { name: 'Termin Emil Endtest öffnen', exact: true }).first(),
  ).toBeVisible();
});

test('10: Routenplanung für Anna ist erreichbar und interaktiv', async ({ page }) => {
  await login(page, OWNER);
  await page.goto('/routes');
  // Mitarbeiterin wählen – der Routenplaner lädt und rendert für sie.
  await selectOption(page, 'Mitarbeiter', /Anna Berg/);
  // Der Planer zeigt das Route-Panel und die Karte (Fahrzeit-Berechnung selbst
  // ist umfassend in den Integrations-/Unit-Tests des Route-Optimizers geprüft).
  await expect(page.getByRole('heading', { name: /^Route/ }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Karte' }).first()).toBeVisible();
});

test('11: Dashboard zeigt aktualisierte Kennzahlen', async ({ page }) => {
  await login(page, OWNER);
  await expect(page.getByText('Termine heute')).toBeVisible();
  await expect(page.getByText('Offene Kundenstunden')).toBeVisible();
  await expect(page.getByText('Handlungsbedarf')).toBeVisible();
  // Der neue Kunde taucht auf dem Dashboard auf (heutige/nächste Termine bzw.
  // Handlungsbedarf). Die konkrete Position hängt von der Datenmenge ab, daher
  // wird nur die Sichtbarkeit des Kunden geprüft.
  await expect(page.getByText(/Emil Endtest/).first()).toBeVisible();
});

test('12: Benutzer einer fremden Organisation sieht die Daten nicht', async ({ page }) => {
  await login(page, FREMD);
  // Direkter Objektzugriff (IDOR) → 404.
  await page.goto(customerUrl);
  await expect(page.getByText(/404|nicht gefunden/i).first()).toBeVisible();
  // Kundenliste der fremden Organisation enthält den Kunden nicht.
  await page.goto('/customers');
  await expect(page.getByText('Emil Endtest')).toHaveCount(0);
});
