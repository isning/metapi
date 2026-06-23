import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('CenteredModal shadcn migration contract', () => {
  it('delegates modal rendering to the shared shadcn dialog wrapper', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/components/CenteredModal.tsx'), 'utf8');

    expect(source).toContain("./ui/dialog/index.js");
    expect(source).toContain("<Dialog.Root");
    expect(source).toContain("<Dialog.Content");
    expect(source).not.toContain("px-px");
    expect(source).not.toContain("px-1");
    expect(source).not.toContain(['modal', '-backdrop'].join(''));
    expect(source).not.toContain(['modal', '-content'].join(''));
    expect(source).not.toContain("createPortal");
  });
});

describe('Shared dialog viewport constraints', () => {
  it('keeps raw Dialog.Content inside the viewport by default', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/components/ui/dialog/index.tsx'), 'utf8');

    expect(source).toContain('max-h-[calc(100dvh-2rem)]');
    expect(source).toContain('overflow-y-auto');
  });
});
