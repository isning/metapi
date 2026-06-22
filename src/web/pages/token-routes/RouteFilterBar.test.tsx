import { create, type ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import RouteFilterBar from './RouteFilterBar.js';

function collectText(node: ReactTestInstance): string {
  return (node.children || []).map((child) => {
    if (typeof child === 'string') return child;
    return collectText(child);
  }).join('');
}

function renderBar(collapsed: boolean) {
  return (
    <RouteFilterBar
      totalRouteCount={3}
      activeBrand={null}
      setActiveBrand={vi.fn()}
      activeSite={null}
      setActiveSite={vi.fn()}
      activeEndpointType={null}
      setActiveEndpointType={vi.fn()}
      activeGroupFilter={null}
      setActiveGroupFilter={vi.fn()}
      enabledFilter="all"
      setEnabledFilter={vi.fn()}
      enabledCounts={{ enabled: 2, disabled: 1 }}
      brandList={{ list: [], otherCount: 0 }}
      siteList={[]}
      endpointTypeList={[]}
      groupRouteList={[]}
      collapsed={collapsed}
      onToggle={vi.fn()}
    />
  );
}

describe('RouteFilterBar', () => {
  it('keeps short filters grouped separately from long wrapping filter rows', () => {
    const root = create(renderBar(false));

    const content = root.root.find((node) => (
      node.props['data-slot'] === 'card-content'
    ));
    const filterLayout = content.find((node) => (
      node.type === 'div'
      && String(node.props.className || '').includes('border-t')
    ));
    const shortFilterRow = filterLayout.find((node) => (
      node.type === 'div'
      && String(node.props.className || '').includes('lg:grid-cols-[minmax(220px,max-content)_minmax(260px,1fr)]')
    ));

    expect(String(filterLayout.props.className || '')).toContain('grid gap-4');
    expect(shortFilterRow).toBeTruthy();
    expect(collectText(shortFilterRow)).toContain('状态');
    expect(collectText(shortFilterRow)).toContain('能力');
  });

  it('uses the shadcn collapsible content while expanded', () => {
    const root = create(renderBar(false));

    const content = root.root.find((node) => (
      String(node.props.className || '').includes('route-filter-collapsible')
    ));
    const expandedPanel = root.root.find((node) => (
      node.props['data-slot'] === 'card-content'
    ));

    expect(String(content.props.className)).toContain('route-filter-collapsible');
    expect(expandedPanel).toBeTruthy();
    expect(String(expandedPanel.props.className)).not.toContain('is-closing');
  });

  it('keeps the collapsible content mounted while collapsed so Radix can animate it', () => {
    const root = create(renderBar(true));
    const content = root.root.find((node) => (
      String(node.props.className || '').includes('route-filter-collapsible')
    ));
    expect(content).toBeTruthy();
  });

  it('lets Radix mark the content closed immediately when collapsed', () => {
    const root = create(renderBar(false));
    root.update(renderBar(true));
    const content = root.root.find((node) => (
      String(node.props.className || '').includes('route-filter-collapsible')
    ));
    expect(content).toBeTruthy();
  });
});
