import { AlertTriangle, CheckCircle2 } from 'lucide-react';

/** Inline-Formularmeldung (Fehler/Erfolg) – sichtbar auch ohne Toasts. */
export function FormAlert({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'success';
  children?: React.ReactNode;
}) {
  if (!children) return null;
  const isError = tone === 'error';
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-[var(--radius-md)] px-3.5 py-3 text-[length:var(--text-sm)]"
      style={{
        backgroundColor: isError ? 'var(--color-danger-soft)' : 'var(--color-success-soft)',
        color: isError ? 'var(--color-danger)' : 'var(--color-success)',
      }}
    >
      {isError ? (
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      ) : (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
      )}
      <span>{children}</span>
    </div>
  );
}
