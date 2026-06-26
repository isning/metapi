import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const scanRoots = [
  path.join(repoRoot, 'src/web/App.tsx'),
  path.join(repoRoot, 'src/web/components'),
  path.join(repoRoot, 'src/web/pages'),
];

const pageScanRoot = path.join(repoRoot, 'src/web/pages');

const bannedLegacyPatterns = [
  /\bmodal-(?:backdrop|content|footer|header|title|close-button|body)\b/,
  /\bmobile-filter-panel\b/,
  /\bmobile-actions-bar\b/,
  /\bmobile-card(?:-[a-z0-9-]+)?\b/,
  /\bmobile-field(?:-[a-z0-9-]+)?\b/,
  /\buser-dropdown\b/,
  /\bbtn-[a-z0-9-]+\b/,
  /\bbadge-link\b/,
  /\btoolbar-search\b/,
  /\binfo-tip\b/,
  /\btopbar-badge\b/,
  /\btopbar-(?:logo|nav|right|icon-btn|search|avatar)[a-z0-9-]*\b/,
  /(?:className=["'][^"']*|\.)(?:sidebar-(?:item|group|collapse)[a-z0-9-]*)\b/,
  /\bmobile-nav(?:-[a-z0-9-]+)?\b/,
  /\bcheckin-toggle-badge\b/,
  /\bsite-observability-(?:count|platform)-badge\b/,
  /\bdashboard-(?:stat|stat-grid)[a-z0-9-]*\b/,
  /\bsite-observability-(?:panel|grid|header|title|subtitle|card|metric|legend|empty)[a-z0-9-]*\b/,
  /\boauth-(?:toolbar|table|workbench|drawer|guide|window|form|field|input|textarea|toggle|page-message|mobile|status|quota|cell|actions)[a-z0-9-]*\b/,
  /\bsettingsModern[A-Za-z0-9_]*\b/,
  /\bpage-(?:header|title|actions|subtitle)\b/,
  /className=["'](?:data-table(?:\s|["'])|[^"']*\sdata-table(?:\s|["']))/,
  /(?<!-)\btoolbar\b(?!-)/,
  /\bmodel-card[a-z0-9-]*\b/,
  /\bmodel-tag[a-z0-9-]*\b/,
  /\bmodern-select(?:-[a-z0-9-]+)?\b/,
  /\bfilter-(?:panel|item)[a-z0-9-]*\b/,
  /\bfilter-chip\b/,
  /\bpill-tabs?\b/,
  /\bpill-tab\b/,
  /\bproxy-logs-[a-z0-9-]+\b/,
  /\baccounts-(?:page-actions|sort-select|actions-col|actions-cell|row-actions)\b/,
  /\bsites-(?:page-actions|sort-select)\b/,
  /\broute-wizard\b/,
  /\broute-filter-(?:row|bar)\b/,
  /\broute-graph-(?:node-form|switch-field|operation|panel-section|json-editor)\b/,
  /\bdownstream-key-advanced-toggle\b/,
  /\bdownstream-key-(?:modal|advanced)[a-z0-9-]*\b/,
  /\btoast-(?:container|success|error|info|exit|progress)\b/,
  /\bcompat-policy-[a-z0-9-]+\b/,
  /\bchart-container\b/,
  /\balert-(?:success|info|warning|error|title)\b/,
  /\bstat-summary-(?:card|purple|blue|green|orange|label|value)\b/,
  /\binputStyle\b/,
  /className=["']skeleton\b/,
  /spinner spinner-sm/,
  /className=["']empty-state\b/,
  /\bempty-state-(?:title|desc|icon)\b/,
];

const bannedPageControlPatterns = [
  /<\s*(?:button|input|select|textarea|table|thead|tbody|tr|th|td)(?:\s|>|\/)/,
  /type=["'](?:checkbox|radio|range)["']/,
  /\baccentColor\b/,
  /<Checkbox\b[^\n>]*\bonChange=/,
];

const bannedSharedControlPatterns = [
  /<\s*(?:button|input|select|textarea|table|thead|tbody|tr|th|td)(?:\s|>|\/)/,
];

const bannedPageVisualInlineStylePatterns = [
  /style=\{\{[^\n]*(?:--color-|color-mix|#[0-9a-fA-F]{3,8}|border|background|radius|zIndex|boxShadow|shadow)/,
];

const pageInlineStyleAllowedFiles = new Set([
  // Runtime grid columns are computed from debug panel presence.
  'src/web/pages/ModelTester.tsx',
  // Runtime progress width and route graph/list visual geometry.
  'src/web/pages/token-routes/SortableChannelRow.tsx',
  'src/web/pages/token-routes/RouteCard.tsx',
  'src/web/pages/token-routes/ManualRoutePanel.tsx',
  'src/web/pages/token-routes/RouteGraphWorkbench.tsx',
  // Runtime skeleton height is passed by the downstream key trend chart.
  'src/web/pages/downstream-keys/shared.tsx',
]);

const componentInlineStyleAllowedFiles = new Set([
  // Compatibility wrapper exposes runtime menu max height to Radix portals.
  'src/web/components/ModernSelect.tsx',
  // Brand identity and fallback avatars carry runtime size/color.
  'src/web/components/BrandIcon.tsx',
  // Route flow node/edge status colors are semantic graph data.
  'src/web/components/ModelRouteFlow.tsx',
  // Chart library sizing and dynamic swatches are centralized here.
  'src/web/components/charts/ChartShell.tsx',
  'src/web/components/charts/DownstreamKeyTrendChart.tsx',
]);

function walk(entryPath: string): string[] {
  const stat = statSync(entryPath);
  if (stat.isFile()) {
    if (!/\.(tsx|ts|css)$/.test(entryPath)) return [];
    if (entryPath.includes('.test.')) return [];
    return [entryPath];
  }
  return readdirSync(entryPath).flatMap((entry) => walk(path.join(entryPath, entry)));
}

function isShadcnPrimitivePath(filePath: string): boolean {
  const normalized = filePath.split(path.sep).join('/');
  return normalized.includes('/src/web/components/ui/');
}

describe('web UI migration guard', () => {
  it('keeps removed legacy UI contracts out of production web code', () => {
    const violations: string[] = [];

    for (const root of scanRoots) {
      for (const filePath of walk(root)) {
        const relativePath = path.relative(repoRoot, filePath);
        const source = readFileSync(filePath, 'utf8');
        for (const pattern of bannedLegacyPatterns) {
          if (pattern.test(source)) {
            violations.push(`${relativePath}: ${pattern}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps production pages on shadcn control primitives', () => {
    const violations: string[] = [];

    for (const filePath of walk(pageScanRoot).filter((candidate) => candidate.endsWith('.tsx'))) {
      const relativePath = path.relative(repoRoot, filePath);
      const source = readFileSync(filePath, 'utf8');
      for (const pattern of bannedPageControlPatterns) {
        if (pattern.test(source)) {
          violations.push(`${relativePath}: ${pattern}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps shared components on shadcn control primitives', () => {
    const violations: string[] = [];

    for (const root of scanRoots) {
      for (const filePath of walk(root).filter((candidate) => candidate.endsWith('.tsx'))) {
        if (isShadcnPrimitivePath(filePath)) continue;
        const relativePath = path.relative(repoRoot, filePath);
        const source = readFileSync(filePath, 'utf8');
        for (const pattern of bannedSharedControlPatterns) {
          if (pattern.test(source)) {
            violations.push(`${relativePath}: ${pattern}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps production pages on theme classes instead of visual inline styles', () => {
    const violations: string[] = [];

    for (const filePath of walk(pageScanRoot).filter((candidate) => candidate.endsWith('.tsx'))) {
      const relativePath = path.relative(repoRoot, filePath);
      const source = readFileSync(filePath, 'utf8');
      for (const pattern of bannedPageVisualInlineStylePatterns) {
        if (pattern.test(source)) {
          violations.push(`${relativePath}: ${pattern}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps page inline styles limited to named runtime exceptions', () => {
    const violations: string[] = [];

    for (const filePath of walk(pageScanRoot).filter((candidate) => candidate.endsWith('.tsx'))) {
      const relativePath = path.relative(repoRoot, filePath);
      const source = readFileSync(filePath, 'utf8');
      if (source.includes('style={{') && !pageInlineStyleAllowedFiles.has(relativePath)) {
        violations.push(relativePath);
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps component inline styles limited to named runtime exceptions', () => {
    const violations: string[] = [];
    const componentRoot = path.join(repoRoot, 'src/web/components');

    for (const filePath of walk(componentRoot).filter((candidate) => candidate.endsWith('.tsx'))) {
      if (isShadcnPrimitivePath(filePath)) continue;
      const relativePath = path.relative(repoRoot, filePath);
      const source = readFileSync(filePath, 'utf8');
      if (source.includes('style={{') && !componentInlineStyleAllowedFiles.has(relativePath)) {
        violations.push(relativePath);
      }
    }

    expect(violations).toEqual([]);
  });

  it('routes shared empty states through the shadcn empty primitive', () => {
    const source = readFileSync(path.join(repoRoot, 'src/web/components/EmptyStateBlock.tsx'), 'utf8');

    expect(source).toContain("./ui/empty/index.js");
    expect(source).toContain("<Empty");
    expect(source).toContain("<EmptyTitle");
    expect(source).toContain("<EmptyDescription");
    expect(source).not.toContain("flex flex-col items-center justify-center gap-2 p-8 text-center");
  });

  it('uses the shadcn collapsible primitive for proxy log disclosure cards', () => {
    const source = readFileSync(path.join(repoRoot, 'src/web/pages/ProxyLogs.tsx'), 'utf8');

    expect(source).toContain("../components/ui/collapsible/index.js");
    expect(source).toContain("<Collapsible");
    expect(source).toContain("<CollapsibleTrigger");
    expect(source).toContain("<CollapsibleContent");
  });
});
