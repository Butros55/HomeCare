import type { Metadata } from 'next';

import { OfflineToday } from '@/features/offline/offline-today';

export const metadata: Metadata = { title: 'Offline' };

/**
 * Offline-Fallback (Anforderung 21): zeigt die zuletzt zwischengespeicherten
 * heutigen Termine und die Tagesroute aus dem Service-Worker-Cache.
 */
export default function OfflinePage() {
  return <OfflineToday />;
}
