import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Dichte Datentabelle im Panel-Look. Auf schmalen Screens scrollt der
 * Wrapper horizontal, damit die Seite selbst nie horizontal scrollt.
 */
export function TableWrapper({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'overflow-x-auto rounded-[var(--radius-xl)] border border-[var(--color-line-subtle)] bg-[var(--color-panel)] shadow-[var(--shadow-panel)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full caption-bottom text-[length:var(--text-sm)]', className)} {...props} />;
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('', className)} {...props} />;
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-[var(--color-line-subtle)]', className)} {...props} />;
}

export function Tr({
  className,
  interactive,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  return (
    <tr
      className={cn(
        interactive && 'cursor-pointer transition-colors hover:bg-[var(--color-panel-raised)]',
        className,
      )}
      {...props}
    />
  );
}

export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'border-b border-[var(--color-line-subtle)] px-3 py-2.5 text-left text-[length:var(--text-2xs)] font-semibold tracking-wider whitespace-nowrap text-[var(--color-ink-subtle)] uppercase first:pl-4 last:pr-4',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn(
        'px-3 py-2.5 align-middle first:pl-4 last:pr-4 pointer-coarse:py-3.5',
        className,
      )}
      {...props}
    />
  );
}
