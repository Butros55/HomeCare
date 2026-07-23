import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { getInvitationInfo } from '@/server/services/employee-service';
import { AcceptInvitationForm } from '@/features/auth/accept-invitation-form';

export const metadata: Metadata = { title: 'Einladung' };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await getInvitationInfo(token);

  if (!info) {
    return (
      <div className="space-y-4">
        <h1 className="text-[length:var(--text-xl)] font-semibold">Einladung ungültig</h1>
        <p className="text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
          Dieser Einladungslink ist abgelaufen oder wurde bereits verwendet. Bitte eine neue
          Einladung anfordern.
        </p>
        <Button asChild variant="secondary" className="w-full">
          <Link href="/login">Zur Anmeldung</Link>
        </Button>
      </div>
    );
  }

  return (
    <AcceptInvitationForm
      token={token}
      organizationName={info.organizationName}
      email={info.email}
      initialFirstName={info.firstName}
      initialLastName={info.lastName}
    />
  );
}
