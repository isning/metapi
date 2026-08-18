import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ProxyLogs mobile layout', () => {
  it('renders compact mobile summary cards for proxy logs', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/pages/ProxyLogs.tsx'), 'utf8');
    expect(source).toContain('MobileCard');
    expect(source).toContain(
      'import ResponsiveFilterPanel from "../components/ResponsiveFilterPanel.js";',
    );
    expect(source).toContain('<ResponsiveFilterPanel');
    expect(source).toContain('compact');
    expect(source).toContain('grid grid-cols-2 gap-x-4 gap-y-1');
    expect(source).toContain('subtitle={');
    expect(source).toContain('RequestPathsDetail');
    expect(source.match(/<DetailDisclosureCard title=\{tr\('pages\.proxyLogs\.requestPaths'\)\}>/g)?.length).toBe(2);
  });
});
