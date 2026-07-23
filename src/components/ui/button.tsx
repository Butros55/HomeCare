'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  // Pill-Geometrie mit weichem Press-Feedback: Farbe, nicht Rahmen, trägt die Hierarchie.
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-[background-color,border-color,color,box-shadow,transform] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--color-brand)] text-white shadow-[0_6px_16px_var(--color-brand-ring)] hover:bg-[var(--color-brand-hover)] active:bg-[var(--color-brand-active)]',
        secondary:
          'bg-[var(--color-panel)] text-[var(--color-ink)] border border-[var(--color-line)] shadow-[var(--shadow-panel)] hover:border-[var(--color-line-strong)] hover:bg-[var(--color-panel-raised)]',
        ghost:
          'text-[var(--color-ink-muted)] hover:bg-[var(--color-panel-raised)] hover:text-[var(--color-ink)]',
        danger:
          'bg-[var(--color-danger)] text-white shadow-[0_6px_16px_var(--color-danger-soft)] hover:brightness-110',
        outline:
          'border border-[var(--color-line-strong)] text-[var(--color-ink)] hover:bg-[var(--color-panel-raised)]',
        link: 'text-[var(--color-brand)] underline-offset-4 hover:underline',
      },
      // pointer-coarse: größere Touch-Ziele (~44px) auf iPad/Smartphone,
      // ohne die dichte Desktop-Darstellung zu verändern.
      size: {
        xs: 'h-6 px-2.5 text-[length:var(--text-2xs)] [&_svg]:size-3 pointer-coarse:h-9 pointer-coarse:px-3',
        sm: 'h-7 px-3 text-[length:var(--text-xs)] [&_svg]:size-3.5 pointer-coarse:h-10 pointer-coarse:px-4 pointer-coarse:text-[length:var(--text-sm)]',
        md: 'h-8 px-3.5 text-[length:var(--text-sm)] [&_svg]:size-4 pointer-coarse:h-11 pointer-coarse:px-5',
        lg: 'h-10 px-5 text-[length:var(--text-base)] [&_svg]:size-4 pointer-coarse:h-12 pointer-coarse:px-6',
        icon: 'h-8 w-8 [&_svg]:size-4 pointer-coarse:h-11 pointer-coarse:w-11',
        'icon-sm': 'h-7 w-7 [&_svg]:size-3.5 pointer-coarse:h-10 pointer-coarse:w-10 pointer-coarse:[&_svg]:size-4',
        'icon-lg': 'h-11 w-11 [&_svg]:size-5 pointer-coarse:h-12 pointer-coarse:w-12',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, loading = false, children, disabled, ...props },
  ref,
) {
  const classes = cn(buttonVariants({ variant, size }), className);

  // Radix `Slot` verlangt GENAU ein Element-Kind – deshalb rendert der
  // asChild-Zweig die Kinder unverändert (kein Spinner-Geschwisterknoten).
  if (asChild) {
    return (
      <Slot ref={ref} className={classes} {...props}>
        {children}
      </Slot>
    );
  }

  return (
    <button
      ref={ref}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});

export { buttonVariants };
