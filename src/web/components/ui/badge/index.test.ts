import { describe, expect, it } from 'vitest';
import { badgeVariants } from './index.js';

describe('Badge', () => {
  it('uses soft token-driven colors for semantic badge variants', () => {
    expect(badgeVariants({ variant: 'destructive' })).toContain('bg-destructive/10');
    expect(badgeVariants({ variant: 'destructive' })).toContain('text-destructive');
    expect(badgeVariants({ variant: 'success' })).toContain('bg-success/10');
    expect(badgeVariants({ variant: 'success' })).toContain('text-success');
    expect(badgeVariants({ variant: 'warning' })).toContain('bg-warning/10');
    expect(badgeVariants({ variant: 'warning' })).toContain('text-warning');
    expect(badgeVariants({ variant: 'info' })).toContain('bg-info/10');
    expect(badgeVariants({ variant: 'info' })).toContain('text-info');
  });
});
