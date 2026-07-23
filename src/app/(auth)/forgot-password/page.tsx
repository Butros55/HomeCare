import type { Metadata } from 'next';

import { ForgotPasswordForm } from '@/features/auth/forgot-password-form';

export const metadata: Metadata = { title: 'Passwort vergessen' };

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
