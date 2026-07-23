import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { LoginForm } from '@/features/auth/login-form';

export const metadata: Metadata = { title: 'Anmelden' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  // Sicherheitsnetz: Sollte je ein Altformular Zugangsdaten per GET geschickt
  // haben, wird die URL sofort bereinigt (nichts davon bleibt in der Adresszeile).
  const params = await searchParams;
  if (params.password !== undefined || params.email !== undefined) {
    redirect('/login');
  }

  return <LoginForm showDemoHint={process.env.NODE_ENV !== 'production'} />;
}
