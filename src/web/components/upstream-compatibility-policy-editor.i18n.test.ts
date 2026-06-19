import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('UpstreamCompatibilityPolicyEditor i18n', () => {
  it('uses translated UI copy instead of hard-coded English labels', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/components/UpstreamCompatibilityPolicyEditor.tsx'), 'utf8');

    expect(source).toContain("import { tr } from '../i18n.js'");
    expect(source).toContain("title={tr('上游兼容性')}");
    expect(source).toContain("description={tr('推理历史传输和上游回放行为。')}");

    for (const hardcoded of [
      'title="Upstream compatibility"',
      'Reasoning history transport and upstream replay behavior.',
      'label="Transport"',
      'label="Tool-call messages"',
      'label="Policy JSON"',
      'Advanced JSON',
      'Native carrier',
      'Drop reasoning history',
    ]) {
      expect(source).not.toContain(hardcoded);
    }
  });
});
