import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';

import { Providers } from '@/app/providers';
import { ServiceWorkerRegister } from '@/components/layout/sw-register';
import { APP_NAME } from '@/lib/app-config';
import { THEME_COOKIE_NAME } from '@/lib/theme';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description: 'Einsatzplanung für Haushaltshilfen: Kunden, Stunden, Termine und Routen.',
  applicationName: APP_NAME,
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3f4fb' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0d1c' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Explizite Theme-Wahl kommt als Cookie mit und landet direkt im Server-HTML –
  // kein Init-Script nötig (React 19 meldet client-gerenderte <script>-Tags als
  // Dev-Fehler) und trotzdem kein Theme-Flackern. Ohne Cookie entscheidet das
  // System über `color-scheme: light dark` + `light-dark()`-Tokens.
  const themeCookie = (await cookies()).get(THEME_COOKIE_NAME)?.value;
  const dataTheme = themeCookie === 'light' || themeCookie === 'dark' ? themeCookie : undefined;

  return (
    // suppressHydrationWarning: der Theme-Provider passt data-theme clientseitig an.
    <html lang="de" data-theme={dataTheme} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
