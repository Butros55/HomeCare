import {
  CalendarPlus,
  Check,
  Clock,
  Download,
  PanelLeft,
  Plus,
  RefreshCcw,
  ShieldCheck,
  UserPlus,
  UsersRound,
} from 'lucide-react';
import type * as React from 'react';

import type { NavPermissions, NavUiMode } from '@/components/layout/nav-items';
import { StatusPill } from '@/components/ui/status-pill';

/**
 * Deklarative Tour-Definitionen des Hinweis-Systems.
 *
 * Jede Tour gehört zu einer Route (Regex auf Pfad inkl. Query, damit auch die
 * Einstellungs-Tabs eigene Touren tragen) und startet beim ersten Besuch
 * automatisch. Schritte zeigen auf `data-tour`-Anker; `target-click` sperrt
 * alles außer dem Ziel und geht erst nach dem Klick weiter.
 *
 * Texte betten die ECHTEN UI-Elemente ein (z. B. den grünen „Aktiv“-Pill oder
 * den „Kunde anlegen“-Button), damit sofort klar ist, wovon die Rede ist.
 */

export type TourInteraction = 'next' | 'target-click';
export type TourPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TourStep {
  id: string;
  /** `data-tour`-Anker; ohne Ziel wird der Schritt mittig angezeigt. */
  target?: string;
  /** Schritt gilt nur auf dieser Route (Regex); Standard: Route der Tour. */
  route?: RegExp;
  title: string;
  body: React.ReactNode;
  placement?: TourPlacement;
  interaction?: TourInteraction;
}

export interface TourDefinition {
  id: string;
  version: number;
  /** Route (Pfad inkl. Query), auf der die Tour automatisch startet. */
  route: RegExp;
  /** Sichtbarkeit (Berechtigungen/Modus); Standard: immer. */
  enabled?: (permissions: NavPermissions, uiMode: NavUiMode) => boolean;
  steps: TourStep[];
}

// ---------------------------------------------------------------------------
// Inline-UI-Bausteine: Nachbildungen der echten Bedienelemente für die Texte.
// ---------------------------------------------------------------------------

/** Brand-Button im Miniaturformat (z. B. „Kunde anlegen“). */
function UiPrimary({ icon, children }: { icon?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className="mx-0.5 inline-flex translate-y-[-1px] items-center gap-1 rounded-full bg-[var(--color-brand)] px-2 py-0.5 align-middle text-[length:var(--text-2xs)] font-semibold text-white [&_svg]:size-3"
    >
      {icon}
      {children}
    </span>
  );
}

/** Sekundär-/Outline-Element im Miniaturformat. */
function UiOutline({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className="mx-0.5 inline-flex translate-y-[-1px] items-center gap-1 rounded-full border border-[var(--color-line-strong)] bg-[var(--color-panel)] px-2 py-0.5 align-middle text-[length:var(--text-2xs)] font-medium text-[var(--color-ink)] [&_svg]:size-3"
    >
      {icon}
      {children}
    </span>
  );
}

/** Status-Pill exakt wie in den Tabellen (Aktiv/Gesperrt …). */
function UiStatus({ tone, children }: { tone: 'done' | 'stuck' | 'progress' | 'hold' | 'todo'; children: React.ReactNode }) {
  return (
    <span aria-hidden className="mx-0.5 inline-flex translate-y-[-1px] align-middle">
      <StatusPill size="sm" tone={tone}>
        {children}
      </StatusPill>
    </span>
  );
}

/** Farbpunkt der Kalender-Ebenen. */
function UiDot({ className }: { className: string }) {
  return <span aria-hidden className={`mx-0.5 inline-block size-2.5 translate-y-[-1px] rounded-full align-middle ${className}`} />;
}

/** Häkchen-Kästchen wie im Berechtigungseditor. */
function UiCheckbox() {
  return (
    <span
      aria-hidden
      className="mx-0.5 inline-flex size-3.5 translate-y-[-1px] items-center justify-center rounded-[4px] bg-[var(--color-brand)] align-middle text-white"
    >
      <Check className="size-2.5" />
    </span>
  );
}

// ---------------------------------------------------------------------------

const CUSTOMERS_LIST = /^\/customers(\?.*)?$/;
const CUSTOMERS_NEW = /^\/customers\/new(\?.*)?$/;

export const TOUR_DEFINITIONS: TourDefinition[] = [
  // -------------------------------------------------------------------------
  // Kunden: Liste + Anlege-Flow (Referenz-Tour über den Seitenwechsel hinweg)
  // -------------------------------------------------------------------------
  {
    id: 'customers',
    version: 1,
    route: CUSTOMERS_LIST,
    enabled: (permissions) => permissions.customers,
    steps: [
      {
        id: 'intro',
        title: 'Deine Kunden',
        body: 'Hier verwaltest du alle Kunden: Kontaktdaten, Adressen, Stundenbudgets und die nächsten Termine – alles an einem Ort.',
      },
      {
        id: 'filters',
        target: 'customers-filters',
        title: 'Suchen & filtern',
        body: (
          <p>
            Suche nach Name, Ort oder Telefonnummer und filtere nach Status oder offenen Stunden. Rechts
            schaltest du zwischen Tabellen- und Kartenansicht um.
          </p>
        ),
        placement: 'bottom',
      },
      {
        id: 'list',
        target: 'customers-list',
        title: 'Die Kundenliste',
        body: (
          <p>
            Jede Zeile zeigt die wichtigsten Kennzahlen: gebuchte, zugewiesene und offene Stunden sowie den
            nächsten Termin. Der Status <UiStatus tone="done">Aktiv</UiStatus> bedeutet: Der Kunde wird
            aktuell bedient. Ein Klick auf die Zeile öffnet die Detailseite.
          </p>
        ),
        placement: 'top',
      },
      {
        id: 'create-button',
        target: 'customers-create-button',
        title: 'Neuen Kunden anlegen',
        body: (
          <p>
            Klicke jetzt auf <UiPrimary icon={<Plus />}>Kunde anlegen</UiPrimary> – wir zeigen dir kurz,
            wie das Formular aufgebaut ist.
          </p>
        ),
        placement: 'bottom',
        interaction: 'target-click',
      },
      {
        id: 'form-master',
        target: 'customer-form-master',
        route: CUSTOMERS_NEW,
        title: 'Stammdaten',
        body: 'Name, Kundennummer (leer lassen = automatisch), Kontakt und die Farbe für Kalender und Karte. Pflichtfelder sind mit * markiert.',
        placement: 'right',
      },
      {
        id: 'form-address',
        target: 'customer-form-address',
        route: CUSTOMERS_NEW,
        title: 'Adresse mit Autovervollständigung',
        body: 'Tippe einfach Straße und Ort in die Adresssuche – die Felder füllen sich automatisch und die Adresse wird für Karte und Routen geokodiert.',
        placement: 'right',
      },
      {
        id: 'form-notes',
        target: 'customer-form-notes',
        route: CUSTOMERS_NEW,
        title: 'Hinweise & Notizen',
        body: 'Zugang, Reinigungshinweise und Routen-Notizen helfen dir und deinem Team direkt beim Einsatz vor Ort.',
        placement: 'right',
      },
      {
        id: 'form-actions',
        target: 'customer-form-actions',
        route: CUSTOMERS_NEW,
        title: 'Speichern',
        body: (
          <p>
            Mit <UiPrimary>Kunde anlegen</UiPrimary> wird gespeichert und die Adresse automatisch
            geokodiert. Danach kannst du direkt Stunden buchen und Termine planen.
          </p>
        ),
        placement: 'top',
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Mitarbeiter: Liste + Anlege-Flow (über den Seitenwechsel hinweg)
  // -------------------------------------------------------------------------
  {
    id: 'employees',
    version: 2,
    route: /^\/employees(\?.*)?$/,
    enabled: (permissions, uiMode) => permissions.employees && uiMode === 'team',
    steps: [
      {
        id: 'intro',
        title: 'Dein Team',
        body: 'Hier verwaltest du alle Mitarbeiter: Profile, Arbeitszeiten, Verfügbarkeiten und wie viele Stunden sie schon erhalten haben.',
      },
      {
        id: 'list',
        target: 'employees-list',
        title: 'Die Team-Übersicht',
        body: (
          <p>
            Auf einen Blick: Status, Wochenziel, zugewiesene Stunden und Warnungen, wenn jemandem noch
            Stunden zum Ziel fehlen. <UiStatus tone="done">Aktiv</UiStatus> heißt einsatzbereit,{' '}
            <UiStatus tone="hold">Inaktiv</UiStatus> wird bei der Planung übersprungen.
          </p>
        ),
        placement: 'top',
      },
      {
        id: 'create-button',
        target: 'employees-create-button',
        title: 'Neuen Mitarbeiter anlegen',
        body: (
          <p>
            Klicke jetzt auf <UiPrimary icon={<Plus />}>Mitarbeiter anlegen</UiPrimary> – wir zeigen dir
            kurz das Formular.
          </p>
        ),
        placement: 'bottom',
        interaction: 'target-click',
      },
      {
        id: 'form-master',
        target: 'employee-form-master',
        route: /^\/employees\/new(\?.*)?$/,
        title: 'Stammdaten',
        body: 'Name, Personalnummer, Kontakt und optional der Vorgesetzte (für Team-Strukturen). Pflichtfelder sind mit * markiert.',
        placement: 'right',
      },
      {
        id: 'form-hours',
        target: 'employee-form-hours',
        route: /^\/employees\/new(\?.*)?$/,
        title: 'Arbeitszeit & Stunden',
        body: 'Beschäftigungsart, Wochen-/Monatsziel und Tageslimit. Daraus entstehen die „Fehlend“-Warnungen in der Übersicht und die Konfliktprüfung im Kalender.',
        placement: 'right',
      },
      {
        id: 'form-actions',
        target: 'employee-form-actions',
        route: /^\/employees\/new(\?.*)?$/,
        title: 'Speichern & einladen',
        body: (
          <p>
            <UiPrimary>Mitarbeiter anlegen</UiPrimary> speichert das Profil. Danach kannst du die Person
            über ihr Profil per E-Mail einladen – sie erhält ein eigenes Konto mit reduzierter Ansicht.
          </p>
        ),
        placement: 'top',
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Kalender (portierter Pro-Kalender)
  // -------------------------------------------------------------------------
  {
    id: 'calendar',
    version: 2,
    route: /^\/calendar(\?.*)?$/,
    steps: [
      {
        id: 'intro',
        title: 'Der Kalender',
        body: 'Alle Einsätze in einer Ansicht. Tippe einen Tag an, um in die Tagesansicht zu zoomen – mit Strg + Mausrad (oder Fingerzoom) änderst du die Detailtiefe des Monats.',
      },
      {
        id: 'tabs',
        target: 'calendar-view-tabs',
        title: 'Ansichten wechseln',
        body: (
          <p>
            <UiOutline>Tag</UiOutline> <UiOutline>Woche</UiOutline> <UiOutline>Monat</UiOutline>{' '}
            <UiOutline>Jahr</UiOutline> – der Wechsel ist animiert. In der Wochenansicht wischst du mit
            Schwung durch die Tage.
          </p>
        ),
        placement: 'bottom',
      },
      {
        id: 'layers',
        target: 'calendar-side-panel-button',
        title: 'Ebenen & Tagesliste',
        body: (
          <p>
            Über <UiOutline icon={<PanelLeft />}>Seitenleiste</UiOutline> blendest du Status-Ebenen ein und
            aus: <UiDot className="bg-sky-500" /> Geplant, <UiDot className="bg-emerald-500" /> Bestätigt,{' '}
            <UiDot className="bg-violet-500" /> Abgeschlossen, <UiDot className="bg-amber-500" /> ohne
            Zuordnung. Dort findest du auch die Terminliste des gewählten Tages.
          </p>
        ),
        placement: 'right',
      },
      {
        id: 'create-button',
        target: 'calendar-create-button',
        title: 'Termin anlegen',
        body: (
          <p>
            Klicke jetzt auf <UiPrimary icon={<Plus />} /> – wir gehen das Terminformular einmal kurz
            durch.
          </p>
        ),
        placement: 'left',
        interaction: 'target-click',
      },
      {
        id: 'form-basics',
        target: 'appointment-form-basics',
        title: 'Kunde, Titel & Status',
        body: (
          <p>
            Wähle den Kunden und optional den Mitarbeiter. Der Status <UiStatus tone="todo">Geplant</UiStatus>{' '}
            ist der Normalfall; <UiStatus tone="hold">Entwurf</UiStatus> bleibt unverbindlich und zählt noch
            nicht als verplant.
          </p>
        ),
        placement: 'right',
      },
      {
        id: 'form-when',
        target: 'appointment-form-when',
        title: 'Datum, Zeit & Dauer',
        body: 'Datum, Startzeit und Dauer („2“, „2,5“ oder „150 Minuten“). Überschneidungen, Abwesenheiten und fehlendes Stundenbudget werden beim Speichern geprüft – mit Warnung statt Blockade.',
        placement: 'right',
      },
      {
        id: 'form-recurrence',
        target: 'appointment-form-recurrence',
        title: 'Wiederholung (Serien)',
        body: 'Für regelmäßige Einsätze: täglich, wöchentlich, alle zwei Wochen oder monatlich – mit Enddatum oder Anzahl. Einzelne Vorkommen lassen sich später separat ändern.',
        placement: 'right',
      },
      {
        id: 'form-actions',
        target: 'appointment-form-actions',
        title: 'Anlegen',
        body: (
          <p>
            <UiPrimary>Termin anlegen</UiPrimary> speichert den Einsatz. Du kannst das Formular jetzt
            ausfüllen – oder mit „Abbrechen“ schließen.
          </p>
        ),
        placement: 'top',
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Routen
  // -------------------------------------------------------------------------
  {
    id: 'routes',
    version: 1,
    route: /^\/routes(\?.*)?$/,
    enabled: (permissions) => permissions.routes,
    steps: [
      {
        id: 'intro',
        title: 'Routenplanung',
        body: 'Plane die Fahrtroute eines Tages: Reihenfolge optimieren, Fahrzeiten schätzen und die Abfahrtszeit berechnen.',
      },
      {
        id: 'params',
        target: 'routes-params',
        title: 'Tag & Rahmen festlegen',
        body: 'Wähle Mitarbeiter und Datum, dazu Abfahrtszeit, Puffer pro Stopp und ob die Route am Startpunkt endet.',
        placement: 'bottom',
      },
      {
        id: 'candidates',
        target: 'routes-candidates',
        title: 'Route bearbeiten',
        body: 'Hier steckt die ganze Route: geplante Stopps oben (Reihenfolge ändern, entfernen), darunter Termine zum Hinzufügen und Vorschläge aus offenen Stunden. Jede Änderung aktualisiert Karte und Kennzahlen sofort.',
        placement: 'right',
      },
      {
        id: 'compute',
        target: 'routes-compute-button',
        title: 'Optimieren',
        body: (
          <p>
            <UiPrimary icon={<RefreshCcw />}>Optimieren</UiPrimary> ermittelt die beste Reihenfolge mit
            den kürzesten Fahrzeiten. Stopps, Karte und Kennzahlen aktualisieren sich dabei sofort.
          </p>
        ),
        placement: 'left',
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Auswertungen
  // -------------------------------------------------------------------------
  {
    id: 'reports',
    version: 2,
    route: /^\/reports(\?.*)?$/,
    enabled: (permissions, uiMode) => permissions.reports && uiMode === 'team',
    steps: [
      {
        id: 'intro',
        title: 'Auswertungen',
        body: 'Geplante und geleistete Stunden, Fahrzeiten und Termin-Status – auswertbar je Mitarbeiter, Kunde und Zeitraum.',
      },
      {
        id: 'filters',
        target: 'reports-filters',
        title: 'Zeitraum & Filter',
        body: 'Grenze den Zeitraum ein und filtere nach Mitarbeiter, Team, Kunde oder Status. Alle Zahlen darunter folgen dem Filter.',
        placement: 'bottom',
      },
      {
        id: 'export',
        target: 'reports-export-button',
        title: 'CSV-Export',
        body: (
          <p>
            <UiOutline icon={<Download />}>CSV-Export</UiOutline> exportiert die gefilterten Daten – z. B.
            für die Abrechnung.
          </p>
        ),
        placement: 'left',
      },
      {
        id: 'stats',
        target: 'reports-stats',
        title: 'Die Kennzahlen',
        body: 'Die Summen des Zeitraums: Budget, zugewiesene, geplante und geleistete Stunden, Fahrtzeit, Auslastung sowie Ausfälle und unbesetzte Termine.',
        placement: 'bottom',
      },
      {
        id: 'charts',
        target: 'reports-charts',
        title: 'Diagramme',
        body: 'Links: geplante vs. zugewiesene Stunden je Mitarbeiter. Rechts: die Termine des Zeitraums nach Status.',
        placement: 'top',
      },
      {
        id: 'tables',
        target: 'reports-tables',
        title: 'Detailtabellen',
        body: 'Die genauen Werte pro Mitarbeiter (und darunter pro Kunde) – dieselben Zahlen, die auch im CSV-Export landen.',
        placement: 'top',
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Dashboard (Leitungs-Ansicht)
  // -------------------------------------------------------------------------
  {
    id: 'dashboard',
    version: 1,
    route: /^\/dashboard(\?.*)?$/,
    enabled: (_permissions, uiMode) => uiMode === 'team',
    steps: [
      {
        id: 'intro',
        title: 'Dein Dashboard',
        body: 'Der Startpunkt für jeden Tag: die wichtigsten Zahlen, der heutige Ablauf und alles, was Aufmerksamkeit braucht.',
      },
      {
        id: 'stats',
        target: 'dashboard-stats',
        title: 'Kennzahlen – alle klickbar',
        body: (
          <p>
            Termine heute, offene Kundenstunden, Termine ohne Zuordnung, Konflikte … Jede Kachel führt per
            Klick direkt zur passenden, vorgefilterten Ansicht.
          </p>
        ),
        placement: 'bottom',
      },
      {
        id: 'today',
        target: 'dashboard-today',
        title: 'Der heutige Tag',
        body: 'Alle heutigen Einsätze in zeitlicher Reihenfolge – mit Fahrzeit und Abfahrtszeit zwischen den Stopps und direktem Navigations-Link.',
        placement: 'right',
      },
      {
        id: 'action-items',
        target: 'dashboard-action-items',
        title: 'Handlungsbedarf',
        body: 'Was jetzt zu tun ist: Mitarbeiter unter Stundenziel, Kunden mit offenen Stunden, unzugewiesene Termine oder fehlende Adressen – jeweils mit Direktlink.',
        placement: 'top',
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Mein Tag (Alleine-Modus, persönliche Ansicht & Mitarbeiter-Konten)
  // -------------------------------------------------------------------------
  {
    id: 'my-day',
    version: 1,
    route: /^\/dashboard(\?.*)?$/,
    enabled: (_permissions, uiMode) => uiMode !== 'team',
    steps: [
      {
        id: 'intro',
        title: 'Mein Tag',
        body: 'Deine schlanke Tagesansicht: nur deine Termine, Routen und Stunden – gedacht für den Blick vor dem Losfahren.',
      },
      {
        id: 'stats',
        target: 'my-day-stats',
        title: 'Der Tag in Zahlen',
        body: '„Losfahren um“ zeigt die späteste Abfahrt für den ersten Termin (inkl. Fahrzeit ab deinem Startpunkt). Daneben: Einsatzzeit heute, offene Stunden und die Wochensumme.',
        placement: 'bottom',
      },
      {
        id: 'actions',
        target: 'my-day-actions',
        title: 'Schnellzugriffe',
        body: (
          <p>
            <UiPrimary icon={<CalendarPlus />}>Termin anlegen</UiPrimary> plant direkt für dich selbst;
            „Route heute“ öffnet die fertige Tagesroute mit Karte und Reihenfolge.
          </p>
        ),
        placement: 'bottom',
      },
      {
        id: 'today',
        target: 'my-day-today',
        title: 'Heute',
        body: 'Deine Einsätze in Reihenfolge – mit Adresse, Abfahrtszeit pro Stopp und einem Klick zur Navigation.',
        placement: 'top',
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Einstellungen: Basis (Profil, Darstellung, Benachrichtigungen)
  // -------------------------------------------------------------------------
  {
    id: 'settings',
    version: 1,
    route: /^\/settings$/,
    steps: [
      {
        id: 'intro',
        title: 'Einstellungen',
        body: 'Profil, Passwort, Darstellung (hell/dunkel) und Benachrichtigungen findet hier jedes Konto.',
      },
      {
        id: 'tabs',
        target: 'settings-tabs',
        title: 'Die Bereiche',
        body: (
          <p>
            Über die Tabs wechselst du die Bereiche. Als Leitung findest du unter{' '}
            <UiOutline>Leitung</UiOutline> und <UiOutline>Mitglieder</UiOutline> die Verwaltung von Konten
            und Berechtigungen – dort erklären wir alles im Detail, sobald du sie öffnest.
          </p>
        ),
        placement: 'bottom',
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Einstellungen → Leitung (ausführlich)
  // -------------------------------------------------------------------------
  {
    id: 'settings-leitung',
    version: 1,
    route: /^\/settings\?(.*&)?tab=leitung(&.*)?$/,
    enabled: (permissions) => permissions.settings,
    steps: [
      {
        id: 'intro',
        title: 'Leitung & Organisation',
        body: 'Hier steuerst du, wie die Anwendung arbeitet: Modus, Leitungs-Konten, Standard-Berechtigungen und die Organisationsdaten.',
      },
      {
        id: 'mode',
        target: 'leadership-mode',
        title: 'Ansicht & Modus',
        body: (
          <>
            <p>
              <UiOutline>Alleine</UiOutline> = stark reduziertes Alltags-UI ohne Mitarbeiter- und
              Zuweisungslogik. <UiOutline icon={<UsersRound />}>Leitung mit Team</UiOutline> = volle
              Verwaltung.
            </p>
            <p>
              Beim Wechsel zu „Alleine“ wandern künftige Mitarbeiter-Termine automatisch auf dich; beim
              Zurückwechseln erhalten die Mitarbeiter ihre Zuordnungen wieder. Nichts geht verloren.
            </p>
          </>
        ),
        placement: 'bottom',
      },
      {
        id: 'add-leader',
        target: 'leadership-add-button',
        title: 'Leitungs-Konto einladen',
        body: (
          <p>
            Mit <UiPrimary icon={<UserPlus />}>Leitungs-Konto hinzufügen</UiPrimary> lädst du eine weitere
            Person per E-Mail in die Leitung ein. Sie kann danach Mitarbeiter verwalten, Stunden zuweisen
            und Routen planen – und ist selbst als Mitarbeiter zuweisbar („(Ich)“ im Dropdown).
          </p>
        ),
        placement: 'left',
      },
      {
        id: 'leader-table',
        target: 'leadership-table',
        title: 'Die Leitungs-Konten',
        body: (
          <>
            <p>
              <strong>Art</strong> zeigt die Konto-Art (Leitung, Leitung (Team) …).{' '}
              <strong>Status</strong> <UiStatus tone="done">Aktiv</UiStatus> heißt: Das Konto kann sich
              anmelden; <UiStatus tone="stuck">Gesperrt</UiStatus> wird sofort abgemeldet.
            </p>
            <p>
              Über <UiOutline icon={<ShieldCheck />}>Berechtigungen</UiOutline> legst du pro Konto fest,
              was es sehen und ändern darf. Der Ersteller-Account trägt{' '}
              <UiOutline icon={<ShieldCheck />}>Vollzugriff (Admin)</UiOutline> und ist nicht
              einschränkbar.
            </p>
          </>
        ),
        placement: 'top',
      },
      {
        id: 'defaults',
        target: 'leadership-defaults',
        title: 'Standard-Berechtigungen',
        body: (
          <p>
            Diese Häkchen <UiCheckbox /> gelten als Vorlage für NEUE Konten – getrennt für Leitung und
            Mitarbeiter. Sie greifen beim Einladen und beim Wechsel der Konto-Art; bestehende Konten
            bleiben unverändert.
          </p>
        ),
        placement: 'top',
      },
      {
        id: 'organisation',
        target: 'leadership-organisation',
        title: 'Organisation & Startpunkt',
        body: 'Name, Zeitzone und der Standard-Start/-Zielpunkt für die Routenplanung. Die Adresse wird beim Speichern automatisch geokodiert.',
        placement: 'top',
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Einstellungen → Mitglieder (ausführlich)
  // -------------------------------------------------------------------------
  {
    id: 'settings-mitglieder',
    version: 1,
    route: /^\/settings\?(.*&)?tab=mitglieder(&.*)?$/,
    enabled: (permissions) => permissions.settings,
    steps: [
      {
        id: 'intro',
        title: 'Mitglieder',
        body: 'Alle Konten deiner Organisation – Leitung und Mitarbeiter – mit Konto-Art, Status, Berechtigungen und letzter Anmeldung.',
      },
      {
        id: 'table',
        target: 'members-table',
        title: 'Die Konten-Übersicht',
        body: (
          <>
            <p>
              <strong>Art</strong> unterscheidet Leitungs- von Mitarbeiter-Konten – dein eigenes ist mit
              „(Ich)“ markiert. <strong>Status</strong> <UiStatus tone="done">Aktiv</UiStatus> = kann sich
              anmelden, <UiStatus tone="stuck">Gesperrt</UiStatus> = Zugang gestoppt, alle Sitzungen
              beendet.
            </p>
            <p>
              Neue Mitarbeiter-Konten entstehen per Einladung aus dem Mitarbeiterprofil (Mitarbeiter →
              Profil → Einladen), Leitungs-Konten über den Tab „Leitung“.
            </p>
          </>
        ),
        placement: 'top',
      },
      {
        id: 'role',
        target: 'member-role-select',
        title: 'Konto-Art ändern',
        body: (
          <p>
            Über dieses Auswahlfeld stufst du ein Konto um – etwa einen Mitarbeiter zur{' '}
            <UiOutline>Leitung</UiOutline>. Beim Wechsel greifen automatisch die Standard-Berechtigungen
            der neuen Konto-Art, und Leitungs-Konten werden selbst zuweisbar.
          </p>
        ),
        placement: 'left',
      },
      {
        id: 'permissions',
        target: 'member-permissions-button',
        title: 'Berechtigungen pro Konto',
        body: (
          <p>
            <UiOutline icon={<ShieldCheck />}>Berechtigungen</UiOutline> öffnet den Editor: Häkchen{' '}
            <UiCheckbox /> setzen, was das Konto darf – von „Kunden ansehen“ bis „Konten verwalten“.
            „Auf Standard zurücksetzen“ entfernt die individuelle Liste wieder.
          </p>
        ),
        placement: 'left',
      },
      {
        id: 'suspend',
        target: 'member-status-button',
        title: 'Sperren & entsperren',
        body: (
          <p>
            <UiOutline>Sperren</UiOutline> stoppt den Zugang sofort (alle Sitzungen werden beendet) –
            z. B. beim Ausscheiden. Entsperren stellt den Zugang wieder her; Daten bleiben erhalten.
          </p>
        ),
        placement: 'left',
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Einstellungen → Datenschutz
  // -------------------------------------------------------------------------
  {
    id: 'settings-datenschutz',
    version: 1,
    route: /^\/settings\?(.*&)?tab=datenschutz(&.*)?$/,
    enabled: (permissions) => permissions.settings,
    steps: [
      {
        id: 'intro',
        title: 'Datenschutz (DSGVO)',
        body: 'Auskunft, Löschung und Aufbewahrung an einem Ort – damit du Anfragen von Kunden und Mitarbeitern schnell erfüllen kannst.',
      },
      {
        id: 'export',
        target: 'privacy-export',
        title: 'Datenexport (Art. 15/20)',
        body: (
          <p>
            Erstellt mit <UiOutline icon={<Download />}>Export</UiOutline> eine vollständige
            Datenauskunft zu einem Kunden oder Mitarbeiter als Datei – z. B. bei einer
            Auskunftsanfrage.
          </p>
        ),
        placement: 'bottom',
      },
      {
        id: 'anonymize',
        target: 'privacy-anonymize',
        title: 'Anonymisierung (Art. 17)',
        body: 'Entfernt den Personenbezug eines archivierten Kunden endgültig: Name, Kontakt und Adresse werden überschrieben, die Stunden-Historie bleibt für Auswertungen konsistent.',
        placement: 'bottom',
      },
      {
        id: 'retention',
        target: 'privacy-retention',
        title: 'Aufbewahrungsfristen',
        body: 'Lege fest, wie lange Termine, Aktivitätsprotokoll und Benachrichtigungen aufbewahrt werden. Ältere Einträge räumt die Anwendung automatisch auf.',
        placement: 'top',
      },
    ],
  },
];

// Kalender-/Termin-Symbole für künftige Touren (bewusst exportiert, damit die
// Inline-Elemente überall identisch bleiben).
export const TOUR_UI = { UiPrimary, UiOutline, UiStatus, UiDot, UiCheckbox, icons: { CalendarPlus, Clock } };

/** Tour zur aktuellen Route (erste passende Definition). */
export function tourForPath(
  location: string,
  permissions: NavPermissions,
  uiMode: NavUiMode,
): TourDefinition | null {
  for (const tour of TOUR_DEFINITIONS) {
    if (!tour.route.test(location)) continue;
    if (tour.enabled && !tour.enabled(permissions, uiMode)) continue;
    return tour;
  }
  return null;
}

/** Schritte, deren Route zum aktuellen Ort passt (für den Cross-Page-Flow). */
export function stepMatchesPath(step: TourStep, tour: TourDefinition, location: string): boolean {
  const route = step.route ?? tour.route;
  return route.test(location);
}
