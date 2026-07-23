'use client';

import * as React from 'react';

import {
  DEFAULT_NOTEBOOK_PREFERENCES,
  type NotebookDrawingPreferences,
  type NotebookPenStyle,
  type NotebookTool,
} from './drawing-model';

const STORAGE_KEY = 'hcp.notebook.drawing-preferences.v1';

function numberInRange(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function hexColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function normalizeNotebookPreferences(value: unknown): NotebookDrawingPreferences {
  const stored =
    value && typeof value === 'object' ? (value as Partial<NotebookDrawingPreferences>) : {};
  const validTools = new Set<NotebookTool>(['pen', 'highlighter', 'eraser']);
  const validPenStyles = new Set<NotebookPenStyle>(['fountain', 'ballpoint', 'brush']);
  return {
    lastTool:
      typeof stored.lastTool === 'string' && validTools.has(stored.lastTool as NotebookTool)
        ? (stored.lastTool as NotebookTool)
        : DEFAULT_NOTEBOOK_PREFERENCES.lastTool,
    penStyle:
      typeof stored.penStyle === 'string' && validPenStyles.has(stored.penStyle as NotebookPenStyle)
        ? (stored.penStyle as NotebookPenStyle)
        : DEFAULT_NOTEBOOK_PREFERENCES.penStyle,
    penColor: hexColor(stored.penColor, DEFAULT_NOTEBOOK_PREFERENCES.penColor),
    penWidth: numberInRange(stored.penWidth, DEFAULT_NOTEBOOK_PREFERENCES.penWidth, 1, 18),
    highlighterColor: hexColor(
      stored.highlighterColor,
      DEFAULT_NOTEBOOK_PREFERENCES.highlighterColor,
    ),
    highlighterWidth: numberInRange(
      stored.highlighterWidth,
      DEFAULT_NOTEBOOK_PREFERENCES.highlighterWidth,
      6,
      48,
    ),
    highlighterOpacity: numberInRange(
      stored.highlighterOpacity,
      DEFAULT_NOTEBOOK_PREFERENCES.highlighterOpacity,
      0.1,
      0.7,
    ),
    eraserWidth: numberInRange(
      stored.eraserWidth,
      DEFAULT_NOTEBOOK_PREFERENCES.eraserWidth,
      8,
      64,
    ),
    stabilization: numberInRange(
      stored.stabilization,
      DEFAULT_NOTEBOOK_PREFERENCES.stabilization,
      0,
      0.9,
    ),
    pressureSensitivity: numberInRange(
      stored.pressureSensitivity,
      DEFAULT_NOTEBOOK_PREFERENCES.pressureSensitivity,
      0,
      1,
    ),
    touchDrawEnabled: Boolean(stored.touchDrawEnabled),
  };
}

export function useNotebookPreferences() {
  const [preferences, setPreferences] = React.useState<NotebookDrawingPreferences>(
    DEFAULT_NOTEBOOK_PREFERENCES,
  );
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    // Delay avoids a server/client hydration difference while still restoring
    // device-local tool preferences immediately after mount.
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored) setPreferences(normalizeNotebookPreferences(JSON.parse(stored)));
      } catch {
        // Restricted/private browsing may disable localStorage.
      } finally {
        setLoaded(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  React.useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Preferences are non-critical; the editor remains fully functional.
    }
  }, [loaded, preferences]);

  const updatePreference = React.useCallback(
    <Key extends keyof NotebookDrawingPreferences>(
      key: Key,
      value: NotebookDrawingPreferences[Key],
    ) => {
      setPreferences((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  return { preferences, updatePreference };
}

