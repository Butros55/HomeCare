import {
  BarChart3,
  Bell,
  CalendarDays,
  Contact,
  LayoutDashboard,
  NotebookPen,
  Route,
  Settings,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

/**
 * Sichtbarkeits-Schlüssel der Navigation. Die Werte werden serverseitig aus
 * der Rolle berechnet (src/server/permissions) und an die Shell übergeben –
 * das Ausblenden ist reine UX; jede Route prüft ihre Berechtigung selbst.
 */
export type NavPermissionKey =
  | 'customers'
  | 'employees'
  | 'routes'
  | 'reports'
  | 'settings';

export type NavPermissions = Record<NavPermissionKey, boolean>;

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  requires?: NavPermissionKey;
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

/** UI-Modus (Server-seitig aus Rolle + Organisation ermittelt, s. src/server/permissions). */
export type NavUiMode = 'solo' | 'employee' | 'team' | 'personal';

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/calendar', label: 'Kalender', icon: CalendarDays },
    ],
  },
  {
    title: 'Planung',
    items: [
      { href: '/customers', label: 'Kunden', icon: Contact, requires: 'customers' },
      { href: '/employees', label: 'Mitarbeiter', icon: UsersRound, requires: 'employees' },
      { href: '/routes', label: 'Routen', icon: Route, requires: 'routes' },
    ],
  },
  {
    title: 'Organisation',
    items: [
      { href: '/notes', label: 'Notizbuch', icon: NotebookPen },
      { href: '/notifications', label: 'Benachrichtigungen', icon: Bell },
      { href: '/reports', label: 'Auswertungen', icon: BarChart3, requires: 'reports' },
      { href: '/settings', label: 'Einstellungen', icon: Settings, requires: 'settings' },
    ],
  },
];

/**
 * Reduzierte Navigation für den Alltagsbetrieb: Solo-Leitung und
 * Mitarbeiter-Konten sehen „Mein Tag“, Kalender, Kunden und Routen.
 * Eigene Auswertungen bleiben sichtbar, wenn das Konto reports.view besitzt.
 */
const REDUCED_NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: '/dashboard', label: 'Mein Tag', icon: LayoutDashboard },
      { href: '/calendar', label: 'Kalender', icon: CalendarDays },
      { href: '/customers', label: 'Kunden', icon: Contact, requires: 'customers' },
      { href: '/routes', label: 'Routen', icon: Route, requires: 'routes' },
    ],
  },
  {
    items: [
      { href: '/notes', label: 'Notizbuch', icon: NotebookPen },
      { href: '/reports', label: 'Bericht', icon: BarChart3, requires: 'reports' },
      { href: '/notifications', label: 'Benachrichtigungen', icon: Bell },
      { href: '/settings', label: 'Einstellungen', icon: Settings },
    ],
  },
];

export function navSectionsFor(mode: NavUiMode): NavSection[] {
  return mode === 'team' ? NAV_SECTIONS : REDUCED_NAV_SECTIONS;
}

/** Mobile Bottom-Navigation: maximal 5 Punkte, Rest im „Mehr“-Menü. */
export function bottomNavItems(permissions: NavPermissions, mode: NavUiMode = 'team'): NavItem[] {
  const all = navSectionsFor(mode)
    .flatMap((section) => section.items)
    .filter((item) => !item.requires || permissions[item.requires]);
  const preferred = ['/dashboard', '/calendar', '/customers', '/routes'];
  const main = preferred
    .map((href) => all.find((item) => item.href === href))
    .filter((item): item is NavItem => Boolean(item))
    .slice(0, 4);
  // Für Mitarbeiter ohne Kundenzugriff rückt Benachrichtigungen nach.
  if (main.length < 4) {
    for (const item of all) {
      if (main.length >= 4) break;
      if (!main.includes(item)) main.push(item);
    }
  }
  return main;
}

export function moreNavItems(permissions: NavPermissions, mode: NavUiMode = 'team'): NavItem[] {
  const main = new Set(bottomNavItems(permissions, mode).map((item) => item.href));
  return navSectionsFor(mode)
    .flatMap((section) => section.items)
    .filter((item) => (!item.requires || permissions[item.requires]) && !main.has(item.href));
}
