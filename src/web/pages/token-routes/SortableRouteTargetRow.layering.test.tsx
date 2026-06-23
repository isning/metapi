import { describe, expect, it, vi } from 'vitest';
import { create } from 'react-test-renderer';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableRouteTargetRow } from './SortableRouteTargetRow.js';
import type { RouteEndpointTarget } from './types.js';

function buildTarget(overrides: Partial<RouteEndpointTarget> = {}): RouteEndpointTarget {
  return {
    id: 301,
    routeId: 88,
    accountId: 7,
    tokenId: null,
    sourceModel: 'gpt-4.1',
    priority: 0,
    weight: 100,
    enabled: true,
    manualOverride: true,
    successCount: 12,
    failCount: 1,
    cooldownUntil: null,
    account: {
      username: 'cc',
      accessToken: null,
      extraConfig: null,
      credentialMode: 'oauth',
    },
    site: {
      id: 99,
      name: 'codelab',
      platform: 'openai',
    },
    token: null,
    ...overrides,
  };
}

describe('SortableRouteTargetRow layering', () => {
  it('does not force a base z-index on desktop rows when they are not being dragged', () => {
    const target = buildTarget();
    const root = create(
      <DndContext>
        <SortableContext items={[target.id]} strategy={verticalListSortingStrategy}>
          <SortableRouteTargetRow
            target={target}
            decisionCandidate={undefined}
            isExactRoute
            loadingDecision={false}
            isSavingPriority={false}
            tokenOptions={[
              {
                id: 501,
                name: 'shared-token',
                isDefault: true,
              },
            ]}
            activeTokenId={0}
            isUpdatingToken={false}
            onTokenDraftChange={vi.fn()}
            onSaveToken={vi.fn()}
            onDeleteTarget={vi.fn()}
            onToggleEnabled={vi.fn()}
            onSiteBlockModel={vi.fn()}
          />
        </SortableContext>
      </DndContext>,
    );

    const row = root.root.find((node) => (
      node.type === 'div'
      && node.props['data-layer-root']
    ));

    expect(row.props.style?.zIndex).toBeUndefined();
    expect(row.props.style?.borderLeft).toBeUndefined();
  });

  it('disables row tooltips while a drag interaction is in progress', () => {
    const target = buildTarget();
    const root = create(
      <DndContext>
        <SortableContext items={[target.id]} strategy={verticalListSortingStrategy}>
          <SortableRouteTargetRow
            target={target}
            dragInProgress
            decisionCandidate={undefined}
            isExactRoute
            loadingDecision={false}
            isSavingPriority={false}
            tokenOptions={[
              {
                id: 501,
                name: 'shared-token',
                isDefault: true,
              },
            ]}
            activeTokenId={0}
            isUpdatingToken={false}
            onTokenDraftChange={vi.fn()}
            onSaveToken={vi.fn()}
            onDeleteTarget={vi.fn()}
            onToggleEnabled={vi.fn()}
            onSiteBlockModel={vi.fn()}
          />
        </SortableContext>
      </DndContext>,
    );

    const tooltipNodes = root.root.findAll((node) => node.props['data-tooltip'] !== undefined);
    expect(tooltipNodes).toHaveLength(0);
  });

  it('treats target-management-disabled rows as non-interactive for the drag handle', () => {
    const target = buildTarget();
    const root = create(
      <DndContext>
        <SortableContext items={[target.id]} strategy={verticalListSortingStrategy}>
          <SortableRouteTargetRow
            target={target}
            targetManagementDisabled
            decisionCandidate={undefined}
            isExactRoute
            loadingDecision={false}
            isSavingPriority={false}
            tokenOptions={[
              {
                id: 501,
                name: 'shared-token',
                isDefault: true,
              },
            ]}
            activeTokenId={0}
            isUpdatingToken={false}
            onTokenDraftChange={vi.fn()}
            onSaveToken={vi.fn()}
            onDeleteTarget={vi.fn()}
            onToggleEnabled={vi.fn()}
            onSiteBlockModel={vi.fn()}
          />
        </SortableContext>
      </DndContext>,
    );

    const dragHandle = root.root.find((node) => (
      node.type === 'button'
      && node.props['aria-label'] === '拖拽调整优先级桶'
    ));

    expect(dragHandle.props.disabled).toBe(true);
    expect(dragHandle.props['data-tooltip']).toBe('该路由当前不可编辑优先级');
  });
});
