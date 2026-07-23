import {
  BarChart3,
  Bell,
  CalendarDays,
  Contact,
  LayoutDashboard,
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
      { href: '/notifications', label: 'Benachrichtigungen', icon: Bell },
      { href: '/reports', label: 'Auswertungen', icon: BarChart3, requires: 'reports' },
      { href: '/settings', label: 'Einstellungen', icon: Settings, requires: 'settings' },
    ],
  },
];

/** Mobile Bottom-Navigation: maximal 5 Punkte, Rest im „Mehr“-Menü. */
export function bottomNavItems(permissions: NavPermissions): NavItem[] {
  const all = NAV_SECTIONS.flatMap((section) => section.items).filter(
    (item) => !item.requires || permissions[item.requires],
  );
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

export function moreNavItems(permissions: NavPermissions): NavItem[] {
  const main = new Set(bottomNavItems(permissions).map((item) => item.href));
  return NAV_SECTIONS.flatMap((section) => section.items).filter(
    (item) => (!item.requires || permissions[item.requires]) && !main.has(item.href),
  );
}
