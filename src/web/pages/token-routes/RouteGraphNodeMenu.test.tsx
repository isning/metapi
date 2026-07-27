import type { ReactNode } from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { RouteGraphNodeType } from './routeGraphTypes.js';
import RouteGraphNodeMenu from './RouteGraphNodeMenu.js';

// The menu primitives are a rendering boundary here; keep the real node menu
// mapping and selection callbacks under test without requiring a browser portal.
vi.mock('../../components/ui/dropdown-menu/index.js', () => ({
  Root: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Trigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  Content: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Item: ({ children, onSelect, ...props }: { children: ReactNode; onSelect?: () => void }) => (
    <button type="button" {...props} onClick={onSelect}>{children}</button>
  ),
  Separator: () => null,
}));

describe('RouteGraphNodeMenu', () => {
  it.each(['entry', 'filter', 'dispatcher', 'route_endpoint', 'synthetic_endpoint'] as const)(
    'selects the %s node type from its menu item',
    (type: RouteGraphNodeType) => {
      const onSelect = vi.fn();
      const root = create(<RouteGraphNodeMenu onSelect={onSelect} />);
      const item = root.root.findAllByProps({ 'data-testid': `route-graph-add-node-${type}` })
        .find((node) => node.type === 'button')!;

      act(() => item.props.onClick());

      expect(onSelect).toHaveBeenCalledWith(type);
      root.unmount();
    },
  );

  it('exposes the optional candidate-selector macro action', () => {
    const onSelectMacro = vi.fn();
    const root = create(<RouteGraphNodeMenu onSelect={vi.fn()} onSelectMacro={onSelectMacro} />);
    const item = root.root.findAllByProps({ 'data-testid': 'route-graph-add-macro-candidate-selector' })
      .find((node) => node.type === 'button')!;

    act(() => item.props.onClick());

    expect(onSelectMacro).toHaveBeenCalledOnce();
    root.unmount();
  });
});
