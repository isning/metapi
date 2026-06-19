import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('RouteGraphWorkbench diagnostics panel', () => {
  it('renders diagnostics as a compact problems list', () => {
    const source = readFileSync('src/web/pages/token-routes/RouteGraphWorkbench.tsx', 'utf8');
    const diagnosticBlock = source.slice(
      source.indexOf("if (tab === 'Diagnostics')"),
      source.indexOf("if (tab === 'Trace')"),
    );

    expect(diagnosticBlock).toContain('Problems');
    expect(diagnosticBlock).toContain('route-graph-diagnostic-row');
    expect(diagnosticBlock).toContain('route-graph-diagnostic-message');
    expect(diagnosticBlock).not.toContain("variant={item.severity === 'error' ? 'destructive' : 'outline'}");
  });

  it('keeps each diagnostic on one scan-friendly row', () => {
    const css = readFileSync('src/web/index.css', 'utf8');
    const row = css.match(/\.route-graph-diagnostic-row\s*\{[^}]+\}/);
    const message = css.match(/\.route-graph-diagnostic-message,[\s\S]*?\.route-graph-diagnostic-target\s*\{[^}]+\}/);

    expect(row?.[0]).toContain('grid-template-columns');
    expect(row?.[0]).toContain('border-bottom');
    expect(message?.[0]).toContain('text-overflow: ellipsis;');
    expect(message?.[0]).toContain('white-space: nowrap;');
  });
});
