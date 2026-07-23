import type { Metadata, Viewport } from 'next';

import { Providers } from '@/app/providers';
import { ServiceWorkerRegister } from '@/components/layout/sw-register';
import { THEME_INIT_SCRIPT } from '@/components/layout/theme-provider';
import { APP_NAME } from '@/lib/app-config';

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: das Theme-Init-Script setzt data-theme vor der Hydration.
    <html lang="de" suppressHydrationWarning>
      <head>
        {/* Server-gerendertes Init: kein Theme-Flackern, kein Script in einer
            Client-Komponente (React 19 meldet das als Dev-Fehler). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
