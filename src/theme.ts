import { useEffect, useState } from 'react';

/**
 * Light / dark theme.
 *
 * The preference ('system', 'light' or 'dark') is kept in localStorage. The
 * resolved theme is written to <html data-theme>, which index.css keys its
 * design tokens off. index.html applies it before first paint so there's no
 * flash of the wrong theme.
 *
 * Canvases can't read CSS, so `graphPalette` mirrors the graph tokens as plain
 * strings and is refreshed whenever the theme changes. Its `version` bumps on
 * every refresh so cached layers know to redraw.
 */

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'color-pitchy:theme';
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function readPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // storage unavailable
  }
  return 'system';
}

function resolve(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') return media?.matches ? 'dark' : 'light';
  return preference;
}

export type GraphPalette = {
  version: number;
  background: string;
  grid: string;
  label: string;
  /** Text and outlines drawn over the graph. */
  ink: string;
  /** Your take's pitch line. */
  takeLine: string;
  beatBand: string;
  beatTick: string;
  beatTickMajor: string;
  playhead: string;
  recordLine: string;
};

export const graphPalette: GraphPalette = {
  version: 0,
  background: '#f8fafc',
  grid: '#e2e8f0',
  label: '#475569',
  ink: '#0f172a',
  takeLine: '#334155',
  beatBand: 'rgba(15, 23, 42, 0.045)',
  beatTick: 'rgba(15, 23, 42, 0.3)',
  beatTickMajor: 'rgba(15, 23, 42, 0.55)',
  playhead: '#94a3b8',
  recordLine: '#ef4444',
};

const TOKEN_FOR: Record<Exclude<keyof GraphPalette, 'version'>, string> = {
  background: '--graph-bg',
  grid: '--graph-grid',
  label: '--graph-label',
  ink: '--graph-ink',
  takeLine: '--graph-take',
  beatBand: '--graph-beat-band',
  beatTick: '--graph-beat-tick',
  beatTickMajor: '--graph-beat-tick-major',
  playhead: '--graph-playhead',
  recordLine: '--record',
};

function refreshPalette() {
  const style = getComputedStyle(document.documentElement);
  for (const [key, token] of Object.entries(TOKEN_FOR) as [keyof typeof TOKEN_FOR, string][]) {
    const value = style.getPropertyValue(token).trim();
    if (value) graphPalette[key] = value;
  }
  graphPalette.version += 1;
}

let preference: ThemePreference = 'system';
const listeners = new Set<() => void>();

function apply() {
  const theme = resolve(preference);
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  refreshPalette();
  for (const listener of listeners) listener();
}

/** Call once at startup. */
export function initTheme() {
  preference = readPreference();
  apply();
  media?.addEventListener('change', () => {
    if (preference === 'system') apply();
  });
}

export function setThemePreference(next: ThemePreference) {
  preference = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore
  }
  apply();
}

/** Runs `listener` after every theme change (including the OS switching while on 'system'). */
export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTheme(): { preference: ThemePreference; theme: ResolvedTheme; setPreference: (p: ThemePreference) => void } {
  const [, force] = useState(0);
  useEffect(() => subscribeTheme(() => force((n) => n + 1)), []);
  return { preference, theme: resolve(preference), setPreference: setThemePreference };
}
