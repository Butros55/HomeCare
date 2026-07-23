'use client';

import * as React from 'react';

/**
 * Registriert den Service Worker (nur Produktion – im Dev stört er HMR).
 * Zusätzlich wird /api/my/today einmal vorgeladen, damit die heutigen
 * Termine sofort offline verfügbar sind.
 */
export function ServiceWorkerRegister() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => fetch('/api/my/today').catch(() => undefined))
      .catch(() => undefined);
  }, []);
  return null;
}
