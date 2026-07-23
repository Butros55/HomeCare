'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import {
  Eraser,
  Grid2X2,
  Highlighter,
  Maximize,
  Minus,
  PenTool,
  Plus,
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

import {
  ERASER_WIDTH_PRESETS,
  HIGHLIGHTER_COLOR_PRESETS,
  HIGHLIGHTER_WIDTH_PRESETS,
  PEN_COLOR_PRESETS,
  PEN_STYLE_HINTS,
  PEN_STYLE_LABELS,
  PEN_WIDTH_PRESETS,
  type NotebookBackgroundType,
  type NotebookDrawingPreferences,
  type NotebookPenStyle,
  type NotebookTool,
} from './drawing-model';

/**
 * Werkzeugleiste des Notizbuchs: schwebendes Dock am unteren Rand, damit die
 * Seite darüber möglichst vollständig „Papier" bleibt. Feineinstellungen
 * (Farbpalette, Breite, Stiftart, Papier, Ansicht) stecken in Popovers, damit
 * das Dock auch auf dem iPad hochkant schmal bleibt.
 */
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
  onZoomIn,
  onZoomOut,
  scale,
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
  onZoomIn: () => void;
  onZoomOut: () => void;
  scale: number;
}) {
  const activeTool = preferences.lastTool;
  const isEraser = activeTool === 'eraser';
  const isHighlighter = activeTool === 'highlighter';

  const activeColor = isHighlighter ? preferences.highlighterColor : preferences.penColor;
  const colorKey = isHighlighter ? ('highlighterColor' as const) : ('penColor' as const);
  const colorPresets = isHighlighter ? HIGHLIGHTER_COLOR_PRESETS : PEN_COLOR_PRESETS;

  const widthConfig = isHighlighter
    ? {
        key: 'highlighterWidth' as const,
        value: preferences.highlighterWidth,
        presets: HIGHLIGHTER_WIDTH_PRESETS,
        min: 6,
        max: 48,
        step: 1,
        label: 'Markerbreite',
      }
    : isEraser
      ? {
          key: 'eraserWidth' as const,
          value: preferences.eraserWidth,
          presets: ERASER_WIDTH_PRESETS,
          min: 8,
          max: 64,
          step: 1,
          label: 'Radierergröße',
        }
      : {
          key: 'penWidth' as const,
          value: preferences.penWidth,
          presets: PEN_WIDTH_PRESETS,
          min: 1,
          max: 18,
          step: 0.5,
          label: 'Stiftbreite',
        };

  const selectTool = (tool: NotebookTool) => onPreferenceChange('lastTool', tool);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div
        className="scrollbar-none pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-[var(--color-line-subtle)] bg-[color-mix(in_srgb,var(--color-panel)_92%,transparent)] p-1.5 shadow-[var(--shadow-popover)] backdrop-blur-xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <ToolButton
          label="Stift"
          hint="Taste P"
          active={activeTool === 'pen'}
          onClick={() => selectTool('pen')}
          icon={<PenTool aria-hidden />}
        />
        <ToolButton
          label="Marker"
          hint="Taste H"
          active={isHighlighter}
          onClick={() => selectTool('highlighter')}
          icon={<Highlighter aria-hidden />}
        />
        <ToolButton
          label="Radierer"
          hint="Taste E"
          active={isEraser}
          onClick={() => selectTool('eraser')}
          icon={<Eraser aria-hidden />}
        />

        <Divider />

        {/* Farbe – Palette + freie Farbwahl (beim Radierer ohne Funktion). */}
        {!isEraser ? (
          <ToolPopover
            label={isHighlighter ? 'Markerfarbe' : 'Stiftfarbe'}
            trigger={
              <span
                className="size-5 rounded-full border border-black/15 shadow-inner pointer-coarse:size-6"
                style={{ backgroundColor: activeColor }}
                aria-hidden
              />
            }
          >
            <PopoverSection title={isHighlighter ? 'Markerfarbe' : 'Stiftfarbe'}>
              <div className="grid grid-cols-5 gap-2">
                {colorPresets.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => onPreferenceChange(colorKey, color)}
                    aria-label={`Farbe ${color}`}
                    aria-pressed={activeColor.toLowerCase() === color.toLowerCase()}
                    className={cn(
                      'flex size-9 items-center justify-center rounded-full border-2 transition-transform pointer-coarse:size-11',
                      activeColor.toLowerCase() === color.toLowerCase()
                        ? 'border-[var(--color-brand)] scale-105'
                        : 'border-transparent hover:scale-105',
                    )}
                  >
                    <span
                      className="size-7 rounded-full border border-black/10 shadow-sm pointer-coarse:size-9"
                      style={{ backgroundColor: color }}
                      aria-hidden
                    />
                  </button>
                ))}
              </div>

              <label className="mt-3 flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-3 py-2">
                <span className="text-[length:var(--text-xs)] font-medium text-[var(--color-ink-muted)]">
                  Eigene Farbe
                </span>
                <span className="relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-panel)] pointer-coarse:size-10">
                  <span
                    className="size-5 rounded-full border border-black/10 pointer-coarse:size-6"
                    style={{ backgroundColor: activeColor }}
                    aria-hidden
                  />
                  <input
                    type="color"
                    value={activeColor}
                    onChange={(event) => onPreferenceChange(colorKey, event.target.value)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    aria-label="Eigene Farbe wählen"
                  />
                </span>
              </label>
            </PopoverSection>

            {/* Stiftart nur für den Stift – bestimmt das Schreibgefühl. */}
            {activeTool === 'pen' ? (
              <PopoverSection title="Stiftart" className="mt-4">
                <div className="space-y-1.5">
                  {(Object.keys(PEN_STYLE_LABELS) as NotebookPenStyle[]).map((style) => (
                    <button
                      key={style}
                      type="button"
                      onClick={() => onPreferenceChange('penStyle', style)}
                      aria-pressed={preferences.penStyle === style}
                      className={cn(
                        'flex w-full min-h-11 items-center justify-between gap-3 rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors',
                        preferences.penStyle === style
                          ? 'border-[var(--color-brand)] bg-[var(--color-brand-subtle)]'
                          : 'border-[var(--color-line)] bg-[var(--color-panel-sunken)] hover:border-[var(--color-line-strong)]',
                      )}
                    >
                      <span className="min-w-0">
                        <span
                          className={cn(
                            'block text-[length:var(--text-xs)] font-medium',
                            preferences.penStyle === style
                              ? 'text-[var(--color-brand)]'
                              : 'text-[var(--color-ink)]',
                          )}
                        >
                          {PEN_STYLE_LABELS[style]}
                        </span>
                        <span className="block text-[length:var(--text-2xs)] text-[var(--color-ink-subtle)]">
                          {PEN_STYLE_HINTS[style]}
                        </span>
                      </span>
                      <StylePreview style={style} color={preferences.penColor} />
                    </button>
                  ))}
                </div>
              </PopoverSection>
            ) : null}
          </ToolPopover>
        ) : null}

        {/* Strichbreite – Voreinstellungen + Feinregler. */}
        <ToolPopover
          label={widthConfig.label}
          trigger={
            <span
              className="rounded-full bg-[var(--color-ink)]"
              style={{
                width: `${Math.max(3, Math.min(18, widthConfig.value))}px`,
                height: `${Math.max(3, Math.min(18, widthConfig.value))}px`,
              }}
              aria-hidden
            />
          }
        >
          <PopoverSection title={widthConfig.label}>
            <div className="flex items-center gap-2">
              {widthConfig.presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onPreferenceChange(widthConfig.key, preset)}
                  aria-label={`${preset} px`}
                  aria-pressed={Math.abs(widthConfig.value - preset) < 0.01}
                  className={cn(
                    'flex h-11 flex-1 items-center justify-center rounded-[var(--radius-md)] border transition-colors',
                    Math.abs(widthConfig.value - preset) < 0.01
                      ? 'border-[var(--color-brand)] bg-[var(--color-brand-subtle)]'
                      : 'border-[var(--color-line)] bg-[var(--color-panel-sunken)] hover:border-[var(--color-line-strong)]',
                  )}
                >
                  <span
                    className="rounded-full bg-[var(--color-ink)]"
                    style={{
                      width: `${Math.min(20, preset)}px`,
                      height: `${Math.min(20, preset)}px`,
                    }}
                    aria-hidden
                  />
                </button>
              ))}
            </div>
            <label className="mt-3 block">
              <span className="mb-1.5 flex items-center justify-between text-[length:var(--text-xs)] font-medium text-[var(--color-ink-muted)]">
                <span>Feineinstellung</span>
                <span className="tabular">{Math.round(widthConfig.value)} px</span>
              </span>
              <input
                type="range"
                min={widthConfig.min}
                max={widthConfig.max}
                step={widthConfig.step}
                value={widthConfig.value}
                onChange={(event) =>
                  onPreferenceChange(widthConfig.key, Number(event.target.value))
                }
                className="h-2 w-full accent-[var(--color-brand)]"
              />
            </label>

            {isHighlighter ? (
              <RangeSetting
                className="mt-3"
                label="Deckkraft"
                value={preferences.highlighterOpacity}
                min={0.1}
                max={0.7}
                onChange={(value) => onPreferenceChange('highlighterOpacity', value)}
              />
            ) : null}
          </PopoverSection>
        </ToolPopover>

        <Divider />

        <Tooltip content="Rückgängig · Strg+Z">
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
        <Tooltip content="Wiederholen · Strg+Umschalt+Z">
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

        <Divider />

        {/* Papier + Ansicht + Verhalten. */}
        <ToolPopover label="Papier & Einstellungen" trigger={<SlidersHorizontal aria-hidden />}>
          <PopoverSection title="Papier">
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
                    'flex min-h-11 flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] border px-2 text-[length:var(--text-2xs)] transition-colors',
                    background === value
                      ? 'border-[var(--color-brand)] bg-[var(--color-brand-subtle)] text-[var(--color-brand)]'
                      : 'border-[var(--color-line)] bg-[var(--color-panel-sunken)] text-[var(--color-ink-muted)] hover:border-[var(--color-line-strong)]',
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          </PopoverSection>

          <PopoverSection title="Ansicht" className="mt-4">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={onZoomOut}
                aria-label="Verkleinern"
              >
                <Minus aria-hidden />
              </Button>
              <span className="tabular flex-1 text-center text-[length:var(--text-xs)] text-[var(--color-ink-muted)]">
                {Math.round(scale * 100)} %
              </span>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={onZoomIn}
                aria-label="Vergrößern"
              >
                <Plus aria-hidden />
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={onResetView}>
                <Maximize aria-hidden />
                Zurücksetzen
              </Button>
            </div>
          </PopoverSection>

          {activeTool === 'pen' ? (
            <PopoverSection title="Schreibverhalten" className="mt-4">
              <RangeSetting
                label="Stabilisierung"
                value={preferences.stabilization}
                max={0.9}
                onChange={(value) => onPreferenceChange('stabilization', value)}
              />
              <RangeSetting
                className="mt-3"
                label="Druckempfindlichkeit"
                value={preferences.pressureSensitivity}
                onChange={(value) => onPreferenceChange('pressureSensitivity', value)}
              />
            </PopoverSection>
          ) : null}

          <div className="mt-4 flex items-center justify-between gap-4 rounded-[var(--radius-md)] bg-[var(--color-panel-sunken)] px-3 py-2.5">
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
              onCheckedChange={(checked) => onPreferenceChange('touchDrawEnabled', Boolean(checked))}
              aria-label="Mit Finger zeichnen"
            />
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="mt-3 w-full text-[var(--color-danger)] hover:text-[var(--color-danger)]"
          >
            <Trash2 aria-hidden />
            Seite leeren
          </Button>
        </ToolPopover>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="mx-1 h-6 w-px shrink-0 bg-[var(--color-line)]" aria-hidden />;
}

function ToolButton({
  label,
  hint,
  active,
  onClick,
  icon,
}: {
  label: string;
  hint?: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <Tooltip content={hint ? `${label} · ${hint}` : label}>
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

/** Dock-Knopf mit Popover – hält die Leiste schmal, Details erscheinen darüber. */
function ToolPopover({
  label,
  trigger,
  children,
}: {
  label: string;
  trigger: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <PopoverPrimitive.Root>
      <Tooltip content={label}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label={label}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-panel-raised)] hover:text-[var(--color-ink)] data-[state=open]:bg-[var(--color-brand-subtle)] data-[state=open]:text-[var(--color-brand)] pointer-coarse:size-11 [&_svg]:size-4"
          >
            {trigger}
          </button>
        </PopoverPrimitive.Trigger>
      </Tooltip>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="top"
          sideOffset={10}
          collisionPadding={12}
          className="animate-pop-in z-50 w-[min(20rem,calc(100vw-1.5rem))] rounded-[var(--radius-xl)] border border-[var(--color-line-subtle)] bg-[color-mix(in_srgb,var(--color-panel)_96%,transparent)] p-4 shadow-[var(--shadow-popover)] backdrop-blur-xl"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function PopoverSection({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="mb-2 text-[length:var(--text-xs)] font-medium text-[var(--color-ink-muted)]">
        {title}
      </div>
      {children}
    </div>
  );
}

/** Kleine Strichvorschau, damit die Stiftart erkennbar ist. */
function StylePreview({ style, color }: { style: NotebookPenStyle; color: string }) {
  const path =
    style === 'ballpoint'
      ? 'M2 12 C 10 4, 22 20, 34 12'
      : style === 'brush'
        ? 'M2 13 C 10 3, 22 21, 34 11'
        : 'M2 13 C 10 5, 22 19, 34 11';
  const width = style === 'brush' ? 4.5 : style === 'ballpoint' ? 2 : 3;
  return (
    <svg viewBox="0 0 36 24" className="h-6 w-9 shrink-0" aria-hidden>
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        opacity={style === 'fountain' ? 0.9 : 1}
      />
    </svg>
  );
}

function RangeSetting({
  label,
  value,
  min = 0,
  max = 1,
  className,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  className?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className={cn('block', className)}>
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
