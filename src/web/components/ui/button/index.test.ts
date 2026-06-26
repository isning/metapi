import { describe, expect, it } from 'vitest';
import { buttonVariants } from './index.js';

describe('Button', () => {
  it('exposes soft semantic variants for binary state controls', () => {
    expect(buttonVariants({ variant: 'softSuccess' })).toContain('bg-success/10');
    expect(buttonVariants({ variant: 'softSuccess' })).toContain('text-success');
    expect(buttonVariants({ variant: 'softDestructive' })).toContain('bg-destructive/10');
    expect(buttonVariants({ variant: 'softDestructive' })).toContain('text-destructive');
  });
});
