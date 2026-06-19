import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/web/index.css', 'utf8');

describe('shadcn overlay layering', () => {
  it('uses shadcn overlay layers without legacy z-index contracts', () => {
    expect(css).toContain('@theme inline');
    expect(css).not.toContain(['.modal', '-backdrop'].join(''));
    expect(css).not.toContain('--z-popover');
    expect(css).not.toContain('--z-overlay');
  });

  it.each([
    'src/web/components/ui/select/index.tsx',
    'src/web/components/ui/dropdown-menu/index.tsx',
    'src/web/components/ui/popover/index.tsx',
    'src/web/components/ui/context-menu/index.tsx',
    'src/web/components/ui/tooltip/index.tsx',
  ])('uses the shared popover layer in %s', (filePath) => {
    const source = readFileSync(filePath, 'utf8');
    expect(source).toContain('z-50');
    expect(source).not.toContain('z-[var(');
  });

  it('defines shadcn-compatible enter and exit animation utilities', () => {
    expect(css).toContain('@keyframes shadcn-enter');
    expect(css).toContain('@keyframes shadcn-exit');
    expect(css).toContain('@keyframes shadcn-modal-scale-in');
    expect(css).toContain('@keyframes shadcn-sheet-slide-in');
    expect(css).toContain('.animate-in');
    expect(css).toContain('.animate-out');
    expect(css).toContain('.data-\\[state\\=open\\]\\:animate-in[data-state="open"]');
    expect(css).toContain('.data-\\[state\\=closed\\]\\:animate-out[data-state="closed"]');
    expect(css).toContain('.shadcn-centered-motion');
    expect(css).toContain('.shadcn-overlay-motion[data-state="open"]');
    expect(css).toContain('.shadcn-sheet-motion[data-state="open"]');
  });

  it.each([
    ['src/web/components/ui/dialog/index.tsx', 'centeredContentMotionClassName'],
    ['src/web/components/ui/alert-dialog/index.tsx', 'centeredContentMotionClassName'],
    ['src/web/components/ui/sheet/index.tsx', 'sheetSideMotionClassName'],
    ['src/web/components/ui/select/index.tsx', 'popoverMotionClassName'],
    ['src/web/components/ui/dropdown-menu/index.tsx', 'popoverMotionClassName'],
    ['src/web/components/ui/popover/index.tsx', 'popoverMotionClassName'],
    ['src/web/components/ui/context-menu/index.tsx', 'popoverMotionClassName'],
    ['src/web/components/ui/tooltip/index.tsx', 'popoverMotionClassName'],
  ])('keeps overlay motion wired in %s', (filePath, motionContract) => {
    const source = readFileSync(filePath, 'utf8');
    expect(source).toContain('../motion.js');
    expect(source).toContain(motionContract);
  });

  it.each([
    ['src/web/components/ui/checkbox/index.tsx', 'CheckboxPrimitive.Indicator'],
    ['src/web/components/ui/radio-group/index.tsx', 'RadioGroupPrimitive.Indicator'],
    ['src/web/components/ui/tabs/index.tsx', 'TabsPrimitive.Content'],
  ])('keeps control state transitions animated in %s', (filePath, componentMarker) => {
    const source = readFileSync(filePath, 'utf8');
    expect(source).toContain(componentMarker);
    expect(source).toContain('animate-in');
    expect(source).toContain('fade-in-0');
  });

  it.each([
    'src/web/components/ui/dialog/index.tsx',
    'src/web/components/ui/alert-dialog/index.tsx',
  ])('keeps centered dialog positioning in the motion contract for %s', (filePath) => {
    const source = readFileSync(filePath, 'utf8');
    expect(source).toContain('centeredContentMotionClassName');
    expect(source).not.toContain('-translate-x-1/2');
    expect(source).not.toContain('-translate-y-1/2');
  });
});
