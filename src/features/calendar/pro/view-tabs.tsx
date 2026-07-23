'use client';

/**
 * CalendarViewTabs — 1:1 aus StudyMate portiert: Apple-Calendar-artiger
 * Segment-Umschalter Tag / Woche / Monat / Jahr. Der aktive Pill gleitet per
 * geteiltem framer `layoutId` zwischen den Tabs.
 */

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export type CalendarViewTab = 'today' | 'week' | 'month' | 'year';

const TABS: Array<{ value: CalendarViewTab; label: string }> = [
  { value: 'today', label: 'Tag' },
  { value: 'week', label: 'Woche' },
  { value: 'month', label: 'Monat' },
  { value: 'year', label: 'Jahr' },
];

interface CalendarViewTabsProps {
  value: CalendarViewTab;
  onChange: (value: CalendarViewTab) => void;
  layoutId?: string;
  className?: string;
}

export function CalendarViewTabs({
  value,
  onChange,
  layoutId = 'calendar-view-tab-indicator',
  className,
}: CalendarViewTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Kalenderansicht"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-xl border border-border/60 bg-background/55 p-0.5',
        className,
      )}
    >
      {TABS.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              'relative inline-flex min-h-8 items-center justify-center rounded-lg px-3 text-xs font-semibold transition-colors sm:px-4',
              active ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                aria-hidden="true"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                className="absolute inset-0 rounded-lg bg-primary shadow-sm"
              />
            )}
            <span className="relative z-10">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
