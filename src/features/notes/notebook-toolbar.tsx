'use client';

import {
  Eraser,
  Grid2X2,
  Hand,
  Highlighter,
  PenTool,
  Redo2,
  Rows3,
  SlidersHorizontal,
  Square,
  Trash2,
  Undo2,
} from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Switch, Tooltip } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

import type {
  NotebookBackgroundType,
  NotebookDrawingPreferences,
  NotebookTool,
} from './drawing-model';

export function NotebookToolbar({
  preferences,
  onPreferenceChange,
  background,
  onBackgroundChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  onResetView,
}: {
  preferences: NotebookDrawingPreferences;
  onPreferenceChange: <Key extends keyof NotebookDrawingPreferences>(
    key: Key,
    value: NotebookDrawingPreferences[Key],
  ) => void;
  background: NotebookBackgroundType;
  onBackgroundChange: (background: NotebookBackgroundType) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onResetView: () => void;
}) {
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const activeTool = preferences.lastTool;
  const activeColor =
    activeTool === 'highlighter' ? preferences.highlighterColor : preferences.penColor;
  const activeWidth =
    activeTool === 'highlighter'
      ? preferences.highlighterWidth
      : activeTool === 'eraser'
        ? preferences.eraserWidth
        : preferences.penWidth;
  const widthConfig =
    activeTool === 'highlighter'
      ? { key: 'highlighterWidth' as const, min: 6, max: 48 }
      : activeTool === 'eraser'
        ? { key: 'eraserWidth' as const, min: 8, max: 64 }
        : { key: 'penWidth' as const, min: 1, max: 18 };

  const selectTool = (tool: NotebookTool) => onPreferenceChange('lastTool', tool);

  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20 flex justify-center">
      <div className="pointer-events-auto relative max-w-full">
        {settingsOpen ? (
          <div className="absolute right-0 bottom-[calc(100%+0.5rem)] w-[min(22rem,calc(100vw-2rem))] rounded-[var(--radius-xl)] border border-[var(--color-line-subtle)] bg-[color-mix(in_srgb,var(--color-panel)_94%,transparent)] p-4 shadow-[var(--shadow-popover)] backdrop-blur-xl">
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 flex items-center justify-between text-[length:var(--text-xs)] font-medium text-[var(--color-ink-muted)]">
                  <span>
                    {activeTool === 'eraser'
                      ? 'Radierergröße'
                      : activeTool === 'highlighter'
                        ? 'Markerbreite'
                        : 'Stiftbreite'}
                  </span>
                  <span className="tabular">{Math.round(activeWidth)} px</span>
                </span>
                <input
                  type="range"
                  min={widthConfig.min}
                  max={widthConfig.max}
                  step={activeTool === 'pen' ? 0.5 : 1}
                  value={activeWidth}
                  onChange={(event) =>
                    onPreferenceChange(widthConfig.key, Number(event.target.value))
                  }
                  className="h-2 w-full accent-[var(--color-brand)]"
                />
              </label>

              {activeTool === 'pen' ? (
                <>
                  <RangeSetting
                    label="Stabilisierung"
                    value={preferences.stabilization}
                    onChange={(value) => onPreferenceChange('stabilization', value)}
                  />
                  <RangeSetting
                    label="Druckempfindlichkeit"
                    value={preferences.pressureSensitivity}
                    onChange={(value) => onPreferenceChange('pressureSensitivity', value)}
                  />
                </>
              ) : null}

              {activeTool === 'highlighter' ? (
                <RangeSetting
                  label="Deckkraft"
                  value={preferences.highlighterOpacity}
                  min={0.1}
                  max={0.7}
                  onChange={(value) => onPreferenceChange('highlighterOpacity', value)}
                />
              ) : null}

              <div>
                <div className="mb-2 text-[length:var(--text-xs)] font-medium text-[var(--color-ink-muted)]">
                  Papier
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ['grid', Grid2X2, 'Kariert'],
                      ['lined', Rows3, 'Liniert'],
                      ['blank', Square, 'Blanko'],
                    ] as const
                  ).map(([value, Icon, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => onBackgroundChange(value)}
                      aria-pressed={background === value}
                      className={cn(
                        'flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border px-2 text-[length:var(--text-xs)] transition-colors',
                        background === value
                          ? 'border-[var(--color-brand)] bg-[var(--color-brand-subtle)] text-[var(--color-brand)]'
                          : 'border-[var(--color-line)] bg-[var(--color-panel-sunken)] text-[var(--color-ink-muted)] hover:border-[var(--color-line-strong)]',
                      )}
                    >
                      <Icon className="size-3.5" aria-hidden />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-3 py-2.5">
                <span>
                  <span className="block text-[length:var(--text-xs)] font-medium">
                    Mit Finger zeichnen
                  </span>
                  <span className="block text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
                    Aus: Finger verschiebt das Papier
                  </span>
                </span>
                <Switch
                  checked={preferences.touchDrawEnabled}
                  onCheckedChange={(checked) =>
                    onPreferenceChange('touchDrawEnabled', Boolean(checked))
                  }
                  aria-label="Mit Finger zeichnen"
                />
              </div>
            </div>
          </div>
        ) : null}

        <div
          className="scrollbar-none flex max-w-[calc(100vw-2rem)] items-center gap-1 overflow-x-auto rounded-[var(--radius-xl)] border border-[var(--color-line-subtle)] bg-[color-mix(in_srgb,var(--color-panel)_90%,transparent)] p-1.5 shadow-[var(--shadow-popover)] backdrop-blur-xl"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <ToolButton
            label="Stift"
            active={activeTool === 'pen'}
            onClick={() => selectTool('pen')}
            icon={<PenTool aria-hidden />}
          />
          <ToolButton
            label="Marker"
            active={activeTool === 'highlighter'}
            onClick={() => selectTool('highlighter')}
            icon={<Highlighter aria-hidden />}
          />
          <ToolButton
            label="Radierer"
            active={activeTool === 'eraser'}
            onClick={() => selectTool('eraser')}
            icon={<Eraser aria-hidden />}
          />

          <div className="mx-1 h-6 w-px shrink-0 bg-[var(--color-line)]" aria-hidden />

          {activeTool !== 'eraser' ? (
            <Tooltip content={activeTool === 'highlighter' ? 'Markerfarbe' : 'Stiftfarbe'}>
              <label
                className="relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-panel-raised)] pointer-coarse:size-11"
                aria-label={activeTool === 'highlighter' ? 'Markerfarbe' : 'Stiftfarbe'}
              >
                <span
                  className="size-5 rounded-full border border-black/10 shadow-sm pointer-coarse:size-6"
                  style={{ backgroundColor: activeColor }}
                  aria-hidden
                />
                <input
                  type="color"
                  value={activeColor}
                  onChange={(event) =>
                    onPreferenceChange(
                      activeTool === 'highlighter' ? 'highlighterColor' : 'penColor',
                      event.target.value,
                    )
                  }
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
              </label>
            </Tooltip>
          ) : null}

          <Tooltip content="Werkzeug einstellen">
            <Button
              type="button"
              variant={settingsOpen ? 'primary' : 'ghost'}
              size="icon"
              onClick={() => setSettingsOpen((open) => !open)}
              aria-label="Werkzeug einstellen"
              aria-expanded={settingsOpen}
            >
              <SlidersHorizontal aria-hidden />
            </Button>
          </Tooltip>

          <div className="mx-1 h-6 w-px shrink-0 bg-[var(--color-line)]" aria-hidden />

          <Tooltip content="Rückgängig">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={!canUndo}
              onClick={onUndo}
              aria-label="Rückgängig"
            >
              <Undo2 aria-hidden />
            </Button>
          </Tooltip>
          <Tooltip content="Wiederholen">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={!canRedo}
              onClick={onRedo}
              aria-label="Wiederholen"
            >
              <Redo2 aria-hidden />
            </Button>
          </Tooltip>
          <Tooltip content="Ansicht zurücksetzen">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onResetView}
              aria-label="Ansicht zurücksetzen"
            >
              <Hand aria-hidden />
            </Button>
          </Tooltip>
          <Tooltip content="Inhalt leeren (kann rückgängig gemacht werden)">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClear}
              aria-label="Notiz leeren"
              className="text-[var(--color-danger)] hover:text-[var(--color-danger)]"
            >
              <Trash2 aria-hidden />
            </Button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

function ToolButton({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <Button
        type="button"
        variant={active ? 'primary' : 'ghost'}
        size="icon"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
      >
        {icon}
      </Button>
    </Tooltip>
  );
}

function RangeSetting({
  label,
  value,
  min = 0,
  max = 1,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-[length:var(--text-xs)] font-medium text-[var(--color-ink-muted)]">
        <span>{label}</span>
        <span className="tabular">{Math.round(value * 100)} %</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.05}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-2 w-full accent-[var(--color-brand)]"
      />
    </label>
  );
}

