import { redirect } from 'next/navigation';

import { getCurrentSession } from '@/server/auth/session';

/** Einstieg: angemeldet → Dashboard, sonst → Login. */
export default async function RootPage() {
  const session = await getCurrentSession();
  redirect(session ? '/dashboard' : '/login');
}
