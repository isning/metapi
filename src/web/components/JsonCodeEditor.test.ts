import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('JsonCodeEditor theme contract', () => {
  it('tracks the app data-theme attribute and uses shadcn semantic tokens', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/components/JsonCodeEditor.tsx'), 'utf8');

    expect(source).toContain("getAttribute('data-theme')");
    expect(source).toContain("attributeFilter: ['class', 'data-theme']");
    expect(source).toContain("backgroundColor: 'var(--card)'");
    expect(source).toContain("color: 'var(--foreground)'");
    expect(source).toContain('syntaxHighlighting(HighlightStyle.define');
    expect(source).not.toContain('@codemirror/theme-one-dark');
    expect(source).not.toContain('oneDark');
  });
});
