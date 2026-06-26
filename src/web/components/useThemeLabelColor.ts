import { useEffect, useState } from 'react';

const DEFAULT_CHART_PALETTE = [
  '#2563eb',
  '#0891b2',
  '#047857',
  '#b45309',
  '#dc2626',
  '#7c3aed',
  '#be185d',
  '#0f766e',
];

function readThemeToken(name: string): string | null {
  if (typeof document === 'undefined') return null;

  const root = document.documentElement;
  if (!root || typeof globalThis.getComputedStyle !== 'function') return null;

  const value = globalThis.getComputedStyle(root).getPropertyValue(name).trim();
  return value || null;
}

function observeTheme(read: () => void): (() => void) | undefined {
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  if (!root || typeof globalThis.MutationObserver !== 'function') {
    return undefined;
  }

  const observer = new globalThis.MutationObserver(read);
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  return () => observer.disconnect();
}

export function useThemeToken(name: string, fallback: string): string {
  const [value, setValue] = useState(fallback);

  useEffect(() => {
    const read = () => {
      setValue(readThemeToken(name) || fallback);
    };

    read();
    return observeTheme(read);
  }, [fallback, name]);

  return value;
}

export function useThemeTokens(names: string[], fallbacks: string[]): string[] {
  const [values, setValues] = useState(fallbacks);
  const namesKey = names.join('|');
  const fallbacksKey = fallbacks.join('|');

  useEffect(() => {
    const read = () => {
      setValues(names.map((name, index) => readThemeToken(name) || fallbacks[index] || DEFAULT_CHART_PALETTE[index % DEFAULT_CHART_PALETTE.length]!));
    };

    read();
    return observeTheme(read);
  }, [fallbacksKey, namesKey]);

  return values;
}

export function useThemeLabelColor(fallback = '#728197'): string {
  return useThemeToken('--color-text-secondary', fallback);
}

export function useThemeChartPalette(fallback = DEFAULT_CHART_PALETTE): string[] {
  return useThemeTokens(
    ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6', '--chart-7', '--chart-8'],
    fallback,
  );
}
