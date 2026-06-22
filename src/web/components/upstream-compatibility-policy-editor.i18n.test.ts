import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('UpstreamCompatibilityPolicyEditor i18n', () => {
  it('uses translated UI copy instead of hard-coded English labels', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/components/UpstreamCompatibilityPolicyEditor.tsx'), 'utf8');

    expect(source).toContain("import { tr } from '../i18n.js'");
    expect(source).toContain("title={tr('upstreamCompatibility.title')}");
    expect(source).toContain("description={tr('upstreamCompatibility.description')}");
    expect(source).toContain("tr('upstreamCompatibility.inheritedTitle')");
    expect(source).toContain("tr('upstreamCompatibility.inheritedDescription').replace('{source}'");
    expect(source).toContain("'upstreamCompatibility.transport.native'");
    expect(source).not.toContain("value: 'inherit', label: 'upstreamCompatibility.transport.inherit'");
    expect(source).not.toContain('legacy.');

    for (const hardcoded of [
      "tr('上游兼容性')",
      "tr('推理历史传输和上游回放行为。')",
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
