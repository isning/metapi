import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('TokenRoutes tab layout', () => {
  it('uses the shared segmented tab bar for page-level route tabs', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/pages/TokenRoutes.tsx'), 'utf8');

    expect(source).toMatch(/import\s+SegmentedTabBar\s+from\s+['"]\.\.\/components\/SegmentedTabBar\.js['"]/);
    expect(source).toContain('<SegmentedTabBar');
    expect(source).toContain('<SegmentedTabBar<RouteGroupListTab>');
    expect(source).toContain('<SegmentedTabBar<RouteWorkbenchTab>');
    expect(source).not.toContain('Tabs.TabsList className="grid h-auto w-full grid-cols-3');
    expect(source).not.toContain('Tabs.TabsList className="grid h-auto w-full grid-cols-5');
  });

  it('keeps page header actions aligned with the shared page action style', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/pages/TokenRoutes.tsx'), 'utf8');
    const headerStart = source.indexOf('<PageHeader');
    const tabsStart = source.indexOf('<Tabs.Tabs', headerStart);
    const headerSource = source.slice(headerStart, tabsStart);

    expect(headerSource).toContain('<PageActionBar>');
    expect(headerSource).toContain('<SecondaryActionButton');
    expect(headerSource).not.toContain('size="sm"');
  });

  it('renders route list skeletons and staggered item entrance motion', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/pages/TokenRoutes.tsx'), 'utf8');

    expect(source).toContain('function RouteGroupBrowserLoadingSkeleton');
    expect(source).toContain('function RouteGroupDetailLoadingSkeleton');
    expect(source).toContain('<RouteGroupListLoadingSkeleton isMobile={isMobile} />');
    expect(source).toContain('<RouteGroupBrowserLoadingSkeleton />');
    expect(source).toContain('<RouteGroupDetailLoadingSkeleton />');
    expect(source).toContain('animate-slide-up');
    expect(source).toContain('stagger-${Math.min(index + 1, 5)}');
  });

  it('mounts graph and JSON workbenches only when their tab is active', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/pages/TokenRoutes.tsx'), 'utf8');

    expect(source).toContain("{routeEditorMode === 'graph' && (");
    expect(source).toContain("{routeEditorMode === 'json' && <RouteGraphWorkbench mode=\"json\" />}");
  });
});
