import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/web/index.css', 'utf8');

function readBlock(selectorPattern: RegExp): string {
  return css.match(selectorPattern)?.[1] || '';
}

const rootBlock = readBlock(/:root\s*\{([\s\S]*?)\n\}/);
const darkBlock = readBlock(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);

function readVar(block: string, name: string): string {
  const match = block.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing variable ${name}`);
  return match[1].trim();
}

function readRootVar(name: string): string {
  return readVar(rootBlock, name);
}

function readDarkVar(name: string): string {
  return readVar(darkBlock, name);
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.trim();
  const match = value.match(/^#([0-9a-f]{6})$/i);
  if (!match) throw new Error(`Expected 6-digit hex color, received ${hex}`);
  const raw = match[1];
  return [
    Number.parseInt(raw.slice(0, 2), 16),
    Number.parseInt(raw.slice(2, 4), 16),
    Number.parseInt(raw.slice(4, 6), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLum = relativeLuminance(foreground);
  const backgroundLum = relativeLuminance(background);
  return (Math.max(foregroundLum, backgroundLum) + 0.05) / (Math.min(foregroundLum, backgroundLum) + 0.05);
}

function expectContrast(foreground: string, background: string, minimum = 4.5): void {
  expect(
    contrastRatio(foreground, background),
    `${foreground} on ${background}`,
  ).toBeGreaterThanOrEqual(minimum);
}

describe('web theme tokens', () => {
  it('defines the clean light control-room theme with shadcn semantic tokens', () => {
    expect(readRootVar('--background')).toBe('#f7f9fc');
    expect(readRootVar('--foreground')).toBe('#111827');
    expect(readRootVar('--card')).toBe('#ffffff');
    expect(readRootVar('--primary')).toBe('#2563eb');
    expect(readRootVar('--secondary')).toBe('#e9eef5');
    expect(readRootVar('--muted')).toBe('#eef3f8');
    expect(readRootVar('--accent')).toBe('#e8f1ff');
    expect(readRootVar('--border')).toBe('#d8e0ea');
    expect(readRootVar('--input')).toBe('#cbd5e1');
    expect(readRootVar('--warning')).toBe('#b45309');
    expect(readRootVar('--success')).toBe('#047857');
    expect(readRootVar('--info')).toBe('#0369a1');
  });

  it('defines a high-contrast dark theme instead of the old flat gray stack', () => {
    expect(readDarkVar('--background')).toBe('#0a0f16');
    expect(readDarkVar('--foreground')).toBe('#eef4fb');
    expect(readDarkVar('--card')).toBe('#111827');
    expect(readDarkVar('--primary')).toBe('#60a5fa');
    expect(readDarkVar('--secondary')).toBe('#182333');
    expect(readDarkVar('--muted')).toBe('#1a2432');
    expect(readDarkVar('--accent')).toBe('#17314f');
    expect(readDarkVar('--border')).toBe('#263445');
    expect(readDarkVar('--input')).toBe('#334155');
    expect(readDarkVar('--warning')).toBe('#f59e0b');
    expect(readDarkVar('--success')).toBe('#34d399');
    expect(readDarkVar('--info')).toBe('#38bdf8');
  });

  it('keeps legacy Metapi aliases anchored to the semantic theme layer', () => {
    expect(readRootVar('--color-bg')).toBe('var(--background)');
    expect(readRootVar('--color-bg-base')).toBe('var(--background)');
    expect(readRootVar('--color-bg-card')).toBe('var(--card)');
    expect(readRootVar('--color-text-primary')).toBe('var(--foreground)');
    expect(readRootVar('--color-text-secondary')).toBe('var(--muted-foreground)');
    expect(readRootVar('--color-primary')).toBe('var(--primary)');
    expect(readRootVar('--color-danger')).toBe('var(--destructive)');
    expect(readRootVar('--color-error')).toBe('var(--destructive)');
    expect(readRootVar('--color-surface-subtle')).toBe('#eef3f8');

    expect(readDarkVar('--color-bg')).toBe('var(--background)');
    expect(readDarkVar('--color-bg-base')).toBe('var(--background)');
    expect(readDarkVar('--color-bg-card')).toBe('var(--card)');
    expect(readDarkVar('--color-text-primary')).toBe('var(--foreground)');
    expect(readDarkVar('--color-text-secondary')).toBe('var(--muted-foreground)');
    expect(readDarkVar('--color-primary')).toBe('var(--primary)');
    expect(readDarkVar('--color-danger')).toBe('var(--destructive)');
    expect(readDarkVar('--color-error')).toBe('var(--destructive)');
    expect(readDarkVar('--color-surface-subtle')).toBe('#1a2432');
  });

  it('uses the shadcn base layer for default border and body theme styling', () => {
    expect(css).toContain('@layer base');
    expect(css).toContain('@apply border-border outline-ring/50;');
    expect(css).toContain('@apply bg-background text-foreground;');
  });

  it('provides chart tokens for canvas-backed visualizations', () => {
    for (let index = 1; index <= 8; index += 1) {
      expect(readRootVar(`--chart-${index}`)).toMatch(/^#[0-9a-f]{6}$/i);
      expect(readDarkVar(`--chart-${index}`)).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(readRootVar('--chart-1')).toBe(readRootVar('--primary'));
    expect(readDarkVar('--chart-1')).toBe(readDarkVar('--primary'));
  });

  it('keeps normal text pairs above WCAG AA contrast', () => {
    expectContrast(readRootVar('--foreground'), readRootVar('--background'));
    expectContrast(readRootVar('--card-foreground'), readRootVar('--card'));
    expectContrast(readRootVar('--muted-foreground'), readRootVar('--card'));
    expectContrast(readRootVar('--muted-foreground'), readRootVar('--muted'));
    expectContrast(readRootVar('--accent-foreground'), readRootVar('--accent'));
    expectContrast(readRootVar('--primary-foreground'), readRootVar('--primary'));
    expectContrast(readRootVar('--success-foreground'), readRootVar('--success'));
    expectContrast(readRootVar('--warning-foreground'), readRootVar('--warning'));
    expectContrast(readRootVar('--info-foreground'), readRootVar('--info'));
    expectContrast(readRootVar('--destructive-foreground'), readRootVar('--destructive'));

    expectContrast(readDarkVar('--foreground'), readDarkVar('--background'));
    expectContrast(readDarkVar('--card-foreground'), readDarkVar('--card'));
    expectContrast(readDarkVar('--muted-foreground'), readDarkVar('--card'));
    expectContrast(readDarkVar('--muted-foreground'), readDarkVar('--muted'));
    expectContrast(readDarkVar('--accent-foreground'), readDarkVar('--accent'));
    expectContrast(readDarkVar('--primary-foreground'), readDarkVar('--primary'));
    expectContrast(readDarkVar('--success-foreground'), readDarkVar('--success'));
    expectContrast(readDarkVar('--warning-foreground'), readDarkVar('--warning'));
    expectContrast(readDarkVar('--info-foreground'), readDarkVar('--info'));
    expectContrast(readDarkVar('--destructive-foreground'), readDarkVar('--destructive'));
  });
});
