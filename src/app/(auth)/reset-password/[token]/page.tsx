import type { Metadata } from 'next';

import { ResetPasswordForm } from '@/features/auth/reset-password-form';

export const metadata: Metadata = { title: 'Passwort zurücksetzen' };

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ResetPasswordForm token={token} />;
}
