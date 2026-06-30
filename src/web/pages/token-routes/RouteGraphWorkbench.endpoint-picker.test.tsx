import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

vi.mock('../../components/ui/command/index.js', () => ({
  Command: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CommandInput: ({ onValueChange, value, ...props }: any) => (
    <input
      {...props}
      value={value}
      onChange={(event) => onValueChange?.(event.target.value)}
      onValueChange={onValueChange}
    />
  ),
  CommandList: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CommandEmpty: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CommandGroup: ({ children, heading, ...props }: any) => (
    <section {...props}>
      <div>{heading}</div>
      {children}
    </section>
  ),
  CommandItem: ({ children, onSelect, ...props }: any) => (
    <button type="button" {...props} onClick={() => onSelect?.()} onSelect={onSelect}>
      {children}
    </button>
  ),
  CommandDialog: ({ children }: any) => <div>{children}</div>,
  CommandSeparator: (props: any) => <div {...props} />,
  CommandShortcut: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));

import { RouteEndpointPicker } from './RouteGraphWorkbench.js';
import type { RouteEndpointCatalogItem } from './types.js';

function collectText(node: ReactTestInstance): string {
  return (node.children || []).map((child) => {
    if (typeof child === 'string') return child;
    return collectText(child);
  }).join('');
}

function endpointFixture(overrides: Partial<RouteEndpointCatalogItem> = {}): RouteEndpointCatalogItem {
  return {
    endpointId: 'route-endpoint:supply:tail',
    nodeId: 'route-endpoint:supply:tail',
    routeId: 50_000,
    label: 'tail-source-50000',
    endpointKind: 'supply',
    exposure: 'none',
    resolutionStatus: 'resolved',
    ownerKind: 'automatic_route',
    sourceKind: 'upstream_model',
    enabled: true,
    displayIcon: null,
    modelPattern: 'tail-model-50000',
    publicModelName: null,
    upstreamModels: ['tail-model-50000'],
    siteNames: ['tail-site'],
    sourceRouteIds: [50_000],
    tags: [],
    metadata: {},
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('RouteEndpointPicker paged catalog interaction', () => {
  it('searches remote endpoint catalog results and selects a tail endpoint beyond the first page', async () => {
    const onSearch = vi.fn();
    const onChange = vi.fn();
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(
        <RouteEndpointPicker
          readonly={false}
          catalog={[endpointFixture()]}
          pageInfo={{ page: 1, pageSize: 500, totalCount: 50_000, hasMore: true }}
          selectedEndpointIds={[]}
          onSearch={onSearch}
          onChange={onChange}
        />,
      );
    });

    expect(collectText(root.root)).toContain('显示 1 / 50000');
    expect(collectText(root.root)).toContain('tail-source-50000');

    await act(async () => {
      await Promise.resolve();
    });

    const input = root.root.find((node) => (
      typeof node.props.placeholder === 'string'
      && node.props.placeholder.includes('搜索端点')
    ));
    await act(async () => {
      input.props.onValueChange('tail-model-50000');
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect(onSearch).toHaveBeenCalledWith('tail-model-50000');

    const tailItem = root.root.find((node) => (
      typeof node.props.onSelect === 'function'
      && collectText(node).includes('tail-source-50000')
    ));
    await act(async () => {
      tailItem.props.onSelect();
    });

    expect(onChange).toHaveBeenCalledWith(['route-endpoint:supply:tail']);
  });

  it('loads the next backend page without exposing table-style page controls', async () => {
    const onLoadMore = vi.fn();
    const root = create(
      <RouteEndpointPicker
        readonly={false}
        catalog={[endpointFixture({ endpointId: 'route-endpoint:supply:head', nodeId: 'route-endpoint:supply:head', label: 'head-source' })]}
        pageInfo={{ page: 1, pageSize: 500, totalCount: 50_000, hasMore: true }}
        selectedEndpointIds={[]}
        onLoadMore={onLoadMore}
        onChange={vi.fn()}
      />,
    );

    expect(collectText(root.root)).toContain('显示 1 / 50000');

    const loadMore = root.root.find((node) => (
      node.type === 'button'
      && typeof node.props.onClick === 'function'
      && collectText(node).includes('加载更多端点')
    ));
    await act(async () => {
      loadMore.props.onClick();
    });

    expect(onLoadMore).toHaveBeenCalledWith('');
  });
});
