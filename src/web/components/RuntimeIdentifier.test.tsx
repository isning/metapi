import { describe, expect, it } from 'vitest';
import { create } from 'react-test-renderer';
import RuntimeIdentifier, { formatRuntimeIdentifier } from './RuntimeIdentifier.js';

describe('RuntimeIdentifier', () => {
  it('keeps short identifiers readable and unchanged', () => {
    expect(formatRuntimeIdentifier('endpoint:gpt-5')).toBe('endpoint:gpt-5');
  });

  it('shortens long identifiers with semantic kind and tail', () => {
    const value = 'program:macro:route:managed:19a74079-3e2e-4753-9a5c-c9c5e80ce0ef:entry:candidate:macro:route:managed:19a74079-3e2e-4753-9a5c-c9c5e80ce0ef:edge:candidate:fallback-stage:managed:5625f9e5-cec1-4971-baf5-32e06ce5418d:route-endpoint:managed:8631ed20-133d-4cc8-ac3a-7ce238614d26';
    const result = formatRuntimeIdentifier(value, { kind: 'route-endpoint' });
    expect(result).toContain('route-endpoint');
    expect(result).toContain('7ce238614d26');
    expect(result.length).toBeLessThan(value.length);
  });

  it('retains the full value for inspection', () => {
    const value = 'program:macro:route:managed:1234567890:route-endpoint:managed:abcdef1234567890';
    const renderer = create(<RuntimeIdentifier value={value} kind="route-endpoint" context="Site · Account · Token" />);
    const root = renderer.root.findByProps({ 'data-full-value': value });
    expect(root.props.title).toBe(value);
    expect(root.props['aria-label']).toBe(value);
    expect(root.props.children[1].props.children).toBe('Site · Account · Token');
    const kind = renderer.root.findByProps({ className: 'runtime-identifier-kind block truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground' });
    expect(kind.children.join('')).toBeTruthy();
  });
});
