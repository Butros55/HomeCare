import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

/**
 * Einheitlicher Seitenkopf: Breadcrumbs, Titel, optionale Beschreibung und
 * rechtsbündige Aktionen. Sitzt direkt auf der Canvas – keine Chrome-Leiste.
 */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  children,
}: {
  title: string;
  description?: string;
  breadcrumbs?: { label: string; href?: string }[];
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-4 pt-4 sm:px-5 sm:pt-5">
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Brotkrumen" className="mb-1">
          <ol className="flex flex-wrap items-center gap-1 text-[length:var(--text-xs)] text-[var(--color-ink-subtle)]">
            {breadcrumbs.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                {index > 0 ? <ChevronRight className="size-3" aria-hidden /> : null}
                {crumb.href ? (
                  <Link
                    href={crumb.href}
                    className="transition-colors hover:text-[var(--color-ink)]"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="text-[var(--color-ink-muted)]">
                    {crumb.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-[length:var(--text-2xl)] font-semibold tracking-tight">
            {title}
          </h1>
          {description ? (
            <p className="mt-0.5 text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}
