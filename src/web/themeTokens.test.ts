import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/web/index.css', 'utf8');

function readRootVar(name: string): string {
  const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  const match = rootBlock.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing root variable ${name}`);
  return match[1].trim();
}

function readDarkVar(name: string): string {
  const darkBlock = css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  const match = darkBlock.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing dark variable ${name}`);
  return match[1].trim();
}

describe('web theme tokens', () => {
  it('maps shadcn light tokens to the existing Metapi palette', () => {
    expect(readRootVar('--background')).toBe('#f5f5f5');
    expect(readRootVar('--foreground')).toBe('#1a1a1a');
    expect(readRootVar('--card')).toBe('#ffffff');
    expect(readRootVar('--primary')).toBe('#4f46e5');
    expect(readRootVar('--accent')).toBe('#eef2ff');
    expect(readRootVar('--destructive')).toBe('#dc2626');
  });

  it('maps shadcn dark tokens to the existing Metapi dark palette', () => {
    expect(readDarkVar('--background')).toBe('#0f0f0f');
    expect(readDarkVar('--foreground')).toBe('#f0f0f0');
    expect(readDarkVar('--card')).toBe('#1a1a1a');
    expect(readDarkVar('--primary')).toBe('#6366f1');
    expect(readDarkVar('--accent')).toBe('#1e1b4b');
    expect(readDarkVar('--destructive')).toBe('#f87171');
  });
});
