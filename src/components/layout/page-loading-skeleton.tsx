import * as React from 'react';

import { Skeleton } from '@/components/ui/misc';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { cn } from '@/lib/utils';

function LoadingRegion({
  children,
  className,
  label = 'Inhalte werden geladen',
}: {
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

function HeaderSkeleton({
  breadcrumb = false,
  tabs = false,
  actions = 1,
}: {
  breadcrumb?: boolean;
  tabs?: boolean;
  actions?: number;
}) {
  return (
    <div className="px-4 pt-4 sm:px-5 sm:pt-5">
      {breadcrumb ? <Skeleton className="mb-2 h-3 w-36 rounded-full" /> : null}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-7 w-48 max-w-[70%] rounded-full" />
          <Skeleton className="mt-2 h-3.5 w-72 max-w-[85%] rounded-full" />
        </div>
        {actions > 0 ? (
          <div className="flex shrink-0 gap-2">
            {Array.from({ length: actions }, (_, index) => (
              <Skeleton
                key={index}
                className={cn('h-8 rounded-full', index === 0 ? 'w-24' : 'hidden w-28 sm:block')}
              />
            ))}
          </div>
        ) : null}
      </div>
      {tabs ? (
        <div className="mt-4 flex gap-2 overflow-hidden rounded-full bg-[var(--color-panel-sunken)] p-1">
          {[20, 24, 28, 20, 24].map((width, index) => (
            <Skeleton
              key={index}
              className="h-7 shrink-0 rounded-full bg-[var(--color-panel)]"
              style={{ width: `${width * 4}px` }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StatSkeleton() {
  return (
    <Panel className="flex items-center gap-3.5 px-4 py-3.5">
      <Skeleton className="size-10 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3 w-20 rounded-full" />
        <Skeleton className="mt-2 h-6 w-16 rounded-full" />
        <Skeleton className="mt-1.5 h-2.5 w-24 max-w-full rounded-full" />
      </div>
    </Panel>
  );
}

function PanelTitleSkeleton({ action = false }: { action?: boolean }) {
  return (
    <PanelHeader>
      <Skeleton className="h-4 w-36 rounded-full" />
      {action ? <Skeleton className="h-7 w-24 rounded-full" /> : null}
    </PanelHeader>
  );
}

export function DataRowsSkeleton({
  rows = 5,
  avatar = true,
  compact = false,
}: {
  rows?: number;
  avatar?: boolean;
  compact?: boolean;
}) {
  return (
    <div className="divide-y divide-[var(--color-line-subtle)]">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={cn('flex items-center gap-3 px-4', compact ? 'py-2.5' : 'py-3.5')}>
          {avatar ? <Skeleton className="size-8 shrink-0 rounded-full" /> : null}
          <div className="min-w-0 flex-1">
            <Skeleton
              className="h-3.5 rounded-full"
              style={{ width: `${Math.max(42, 72 - index * 5)}%` }}
            />
            <Skeleton
              className="mt-2 h-2.5 rounded-full"
              style={{ width: `${Math.max(30, 52 - index * 3)}%` }}
            />
          </div>
          <Skeleton className="hidden h-6 w-16 shrink-0 rounded-full sm:block" />
        </div>
      ))}
    </div>
  );
}

function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-[var(--color-line-subtle)] px-4 py-3">
        <Skeleton className="h-8 flex-1 rounded-full" />
        <Skeleton className="h-8 w-28 rounded-full" />
      </div>
      <div className="hidden grid-cols-[2fr_1fr_1fr_5rem] gap-4 bg-[var(--color-panel-sunken)] px-4 py-2.5 md:grid">
        {[28, 20, 20, 12].map((width, index) => (
          <Skeleton key={index} className="h-2.5 rounded-full" style={{ width: `${width * 3}px` }} />
        ))}
      </div>
      <DataRowsSkeleton rows={rows} />
    </Panel>
  );
}

export function GenericPageLoadingSkeleton() {
  return (
    <LoadingRegion>
      <HeaderSkeleton actions={1} />
      <div className="space-y-4 p-4 sm:p-5">
        <TableSkeleton />
      </div>
    </LoadingRegion>
  );
}

export function DashboardLoadingSkeleton() {
  return (
    <LoadingRegion>
      <HeaderSkeleton actions={2} />
      <div className="space-y-4 p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <StatSkeleton key={index} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Panel className="overflow-hidden xl:col-span-2">
            <PanelTitleSkeleton action />
            <DataRowsSkeleton rows={5} />
          </Panel>
          <div className="space-y-4">
            <Panel>
              <PanelTitleSkeleton />
              <PanelBody className="grid grid-cols-2 gap-2">
                {Array.from({ length: 4 }, (_, index) => (
                  <Skeleton key={index} className="h-16 rounded-[var(--radius-lg)]" />
                ))}
              </PanelBody>
            </Panel>
            <Panel className="overflow-hidden">
              <PanelTitleSkeleton />
              <DataRowsSkeleton rows={3} compact />
            </Panel>
          </div>
        </div>
      </div>
    </LoadingRegion>
  );
}

export function ListPageLoadingSkeleton() {
  return (
    <LoadingRegion>
      <HeaderSkeleton actions={2} tabs />
      <div className="space-y-4 p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <StatSkeleton key={index} />
          ))}
        </div>
        <TableSkeleton rows={7} />
      </div>
    </LoadingRegion>
  );
}

export function DetailPageLoadingSkeleton() {
  return (
    <LoadingRegion>
      <HeaderSkeleton breadcrumb actions={2} tabs />
      <div className="space-y-4 p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <StatSkeleton key={index} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel className="overflow-hidden lg:col-span-2">
            <PanelTitleSkeleton />
            <DataRowsSkeleton rows={5} />
          </Panel>
          <Panel>
            <PanelTitleSkeleton />
            <PanelBody className="space-y-4">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index}>
                  <Skeleton className="h-2.5 w-20 rounded-full" />
                  <Skeleton className="mt-2 h-3.5 rounded-full" style={{ width: `${80 - index * 9}%` }} />
                </div>
              ))}
            </PanelBody>
          </Panel>
        </div>
      </div>
    </LoadingRegion>
  );
}

export function FormPageLoadingSkeleton() {
  return (
    <LoadingRegion>
      <HeaderSkeleton breadcrumb actions={0} />
      <div className="max-w-4xl p-4 sm:p-5">
        <Panel>
          <PanelTitleSkeleton />
          <PanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className={index === 6 ? 'sm:col-span-2' : undefined}>
                <Skeleton className="h-3 w-24 rounded-full" />
                <Skeleton className={cn('mt-2 w-full', index === 6 ? 'h-24' : 'h-9')} />
              </div>
            ))}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Skeleton className="h-8 w-24 rounded-full" />
              <Skeleton className="h-8 w-28 rounded-full" />
            </div>
          </PanelBody>
        </Panel>
      </div>
    </LoadingRegion>
  );
}

export function CalendarSurfaceSkeleton({ className }: { className?: string }) {
  return (
    <LoadingRegion
      label="Kalenderdaten werden geladen"
      className={cn('flex h-full min-h-[34rem] flex-col gap-3 bg-[var(--color-canvas)] p-3 sm:p-4', className)}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2">
          <Skeleton className="size-9 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-full" />
        </div>
        <Skeleton className="h-7 w-40 rounded-full" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24 rounded-full" />
          <Skeleton className="size-9 rounded-full" />
        </div>
      </div>
      <Panel className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="grid grid-cols-7 border-b border-[var(--color-line-subtle)] bg-[var(--color-panel-sunken)]">
          {Array.from({ length: 7 }, (_, index) => (
            <div key={index} className="flex justify-center border-r border-[var(--color-line-subtle)] py-3 last:border-r-0">
              <Skeleton className="h-2.5 w-12 rounded-full" />
            </div>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-5">
          {Array.from({ length: 35 }, (_, index) => (
            <div
              key={index}
              className="min-h-20 border-r border-b border-[var(--color-line-subtle)] p-2 last:border-r-0"
            >
              <Skeleton className="ml-auto size-5 rounded-full" />
              {index % 3 === 0 ? <Skeleton className="mt-2 h-4 w-full rounded-full" /> : null}
              {index % 5 === 0 ? <Skeleton className="mt-1 h-4 w-3/4 rounded-full" /> : null}
            </div>
          ))}
        </div>
      </Panel>
    </LoadingRegion>
  );
}

export function CalendarPageLoadingSkeleton() {
  return <CalendarSurfaceSkeleton />;
}

export function RoutePlanningDataSkeleton() {
  return (
    <LoadingRegion label="Routendaten werden geladen" className="grid grid-cols-1 gap-4 xl:grid-cols-5">
      <Panel className="overflow-hidden xl:col-span-2">
        <PanelTitleSkeleton />
        <DataRowsSkeleton rows={5} />
      </Panel>
      <Panel className="xl:col-span-3">
        <PanelTitleSkeleton />
        <PanelBody>
          <Skeleton className="h-[400px] w-full rounded-[var(--radius-lg)]" />
        </PanelBody>
      </Panel>
    </LoadingRegion>
  );
}

export function RoutesPageLoadingSkeleton() {
  return (
    <LoadingRegion>
      <HeaderSkeleton actions={0} />
      <div className="space-y-4 p-4 sm:p-5">
        <Panel>
          <PanelBody className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            {[2, 1, 1, 1, 1].map((span, index) => (
              <div key={index} className={span === 2 ? 'col-span-2' : undefined}>
                <Skeleton className="h-3 w-20 rounded-full" />
                <Skeleton className="mt-2 h-9 w-full" />
              </div>
            ))}
            <div className="col-span-2 flex items-center justify-between gap-4 lg:col-span-6">
              <Skeleton className="h-3 w-64 max-w-[70%] rounded-full" />
              <Skeleton className="h-8 w-32 rounded-full" />
            </div>
          </PanelBody>
        </Panel>
        <RoutePlanningDataSkeleton />
      </div>
    </LoadingRegion>
  );
}

export function ReportsPageLoadingSkeleton() {
  return (
    <LoadingRegion>
      <HeaderSkeleton actions={2} tabs />
      <div className="space-y-4 p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <StatSkeleton key={index} />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }, (_, index) => (
            <Panel key={index}>
              <PanelTitleSkeleton />
              <PanelBody className="flex h-48 items-end gap-3">
                {[45, 72, 54, 84, 64, 76].map((height, barIndex) => (
                  <Skeleton key={barIndex} className="flex-1 rounded-t-[var(--radius-sm)]" style={{ height: `${height}%` }} />
                ))}
              </PanelBody>
            </Panel>
          ))}
        </div>
        <TableSkeleton rows={5} />
      </div>
    </LoadingRegion>
  );
}

export function NotificationsPageLoadingSkeleton() {
  return (
    <LoadingRegion>
      <HeaderSkeleton actions={1} />
      <div className="mx-auto max-w-3xl space-y-2 p-4 sm:p-5">
        {Array.from({ length: 6 }, (_, index) => (
          <Panel key={index} className="flex items-start gap-3 p-3.5">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3.5 rounded-full" style={{ width: `${62 - index * 3}%` }} />
              <Skeleton className="mt-2 h-3 w-full rounded-full" />
              <Skeleton className="mt-1.5 h-3 w-3/4 rounded-full" />
              <Skeleton className="mt-2 h-2.5 w-24 rounded-full" />
            </div>
            <Skeleton className="size-7 shrink-0 rounded-full" />
          </Panel>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function SettingsPageLoadingSkeleton() {
  return (
    <LoadingRegion>
      <HeaderSkeleton actions={0} tabs />
      <div className="max-w-4xl space-y-4 p-4 sm:p-5">
        {Array.from({ length: 2 }, (_, panelIndex) => (
          <Panel key={panelIndex}>
            <PanelTitleSkeleton />
            <PanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {Array.from({ length: panelIndex === 0 ? 4 : 3 }, (_, index) => (
                <div key={index}>
                  <Skeleton className="h-3 w-24 rounded-full" />
                  <Skeleton className="mt-2 h-9 w-full" />
                </div>
              ))}
              <div className="flex justify-end sm:col-span-2">
                <Skeleton className="h-8 w-28 rounded-full" />
              </div>
            </PanelBody>
          </Panel>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function DrawerContentSkeleton() {
  return (
    <LoadingRegion label="Details werden geladen" className="flex flex-1 flex-col">
      <div className="flex items-start justify-between border-b border-[var(--color-line-subtle)] p-4">
        <div className="flex-1">
          <Skeleton className="h-5 w-48 max-w-[75%] rounded-full" />
          <Skeleton className="mt-2 h-3 w-56 max-w-[85%] rounded-full" />
          <div className="mt-3 flex gap-2">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
        </div>
        <Skeleton className="size-8 rounded-full" />
      </div>
      <div className="space-y-5 p-4">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index}>
            <Skeleton className="h-2.5 w-20 rounded-full" />
            <div className="mt-2 flex items-center gap-3">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-3.5 rounded-full" style={{ width: `${76 - index * 6}%` }} />
                <Skeleton className="mt-2 h-2.5 w-1/2 rounded-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function DialogDataSkeleton() {
  return (
    <LoadingRegion label="Details werden geladen" className="space-y-3 py-2">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="rounded-[var(--radius-lg)] bg-[var(--color-panel-sunken)] p-3">
          <Skeleton className="h-3.5 rounded-full" style={{ width: `${70 - index * 7}%` }} />
          <Skeleton className="mt-2 h-2.5 w-2/3 rounded-full" />
        </div>
      ))}
    </LoadingRegion>
  );
}

export function AuthFormLoadingSkeleton() {
  return (
    <LoadingRegion label="Formular wird geladen" className="space-y-5">
      <div className="space-y-2 text-center">
        <Skeleton className="mx-auto h-6 w-40 rounded-full" />
        <Skeleton className="mx-auto h-3 w-64 max-w-full rounded-full" />
      </div>
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index}>
          <Skeleton className="h-3 w-20 rounded-full" />
          <Skeleton className="mt-2 h-10 w-full" />
        </div>
      ))}
      <Skeleton className="h-11 w-full rounded-full" />
      <Skeleton className="mx-auto h-3 w-44 rounded-full" />
    </LoadingRegion>
  );
}
