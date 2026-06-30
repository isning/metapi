import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { SortableContext } from '@dnd-kit/sortable';

const sortableState = vi.hoisted(() => ({
  activeId: null as number | string | null,
}));

vi.mock('@dnd-kit/sortable', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/sortable')>('@dnd-kit/sortable');
  return {
    ...actual,
    useSortable: ({ id }: { id: number | string }) => ({
      attributes: {},
      listeners: {},
      setNodeRef: vi.fn(),
      setActivatorNodeRef: vi.fn(),
      transform: null,
      transition: null,
      isDragging: sortableState.activeId === id,
    }),
  };
});

import RouteCard from './RouteCard.js';
import type { RouteEndpointTarget, RouteSummaryRow } from './types.js';
import { getRouteRoutingStrategyDescription } from './routingStrategy.js';
import { translateOnlyRectSortingStrategy } from './sortingStrategies.js';

function collectText(node: ReactTestInstance): string {
  return (node.children || []).map((child) => {
    if (typeof child === 'string') return child;
    return collectText(child);
  }).join('');
}

afterEach(() => {
  sortableState.activeId = null;
});

const LONG_REGEX_PATTERN = 're:(?:.*|.*/)(minimax-m2.1)$';

function buildRoute(overrides: Partial<RouteSummaryRow> = {}): RouteSummaryRow {
  return {
    id: 42,
    match: { kind: 'model', requestedModelPattern: LONG_REGEX_PATTERN, displayName: 'm.' },
    backend: { kind: 'supply' },
    presentation: { displayName: 'm.', displayIcon: null },
    modelMapping: null,
    routingStrategy: 'weighted',
    enabled: true,
    targetCount: 4,
    enabledTargetCount: 4,
    siteNames: ['site-a'],
    decisionSnapshot: null,
    decisionRefreshedAt: null,
    ...overrides,
  };
}

function buildTarget(overrides: Partial<RouteEndpointTarget> = {}): RouteEndpointTarget {
  return {
    id: 11,
    accountId: 101,
    tokenId: 1001,
    sourceModel: 'gpt-4o-mini',
    priority: 0,
    weight: 1,
    enabled: true,
    manualOverride: false,
    successCount: 0,
    failCount: 0,
    account: { username: 'user_a' },
    site: { id: 1, name: 'site-a', platform: 'openai' },
    token: { id: 1001, name: 'token-a', accountId: 101, enabled: true, isDefault: true },
    ...overrides,
  };
}

function renderRouteCard({
  route = buildRoute(),
  expanded = false,
  compact = false,
}: {
  route?: RouteSummaryRow;
  expanded?: boolean;
  compact?: boolean;
} = {}) {
  return create(
    <RouteCard
      route={route}
      brand={null}
      expanded={expanded}
      compact={compact}
      onToggleExpand={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onToggleEnabled={vi.fn()}
      onClearCooldown={vi.fn()}
      clearingCooldown={false}
      onRoutingStrategyChange={vi.fn()}
      updatingRoutingStrategy={false}
      targets={[]}
      loadingTargets={false}
      routeDecision={null}
      loadingDecision={false}
      candidateView={{ routeCandidates: [], accountOptions: [], tokenOptionsByAccountId: {} }}
      targetTokenDraft={{}}
      updatingTarget={{}}
      savingPriority={false}
      onTokenDraftChange={vi.fn()}
      onSaveToken={vi.fn()}
      onDeleteTarget={vi.fn()}
      onToggleTargetEnabled={vi.fn()}
      onTargetDragEnd={vi.fn()}
      missingTokenSiteItems={[]}
      missingTokenGroupItems={[]}
      onCreateTokenForMissing={vi.fn()}
      onAddTarget={vi.fn()}
      onSiteBlockModel={vi.fn()}
      expandedSourceGroupMap={{}}
      onToggleSourceGroup={vi.fn()}
    />,
  );
}

describe('RouteCard', () => {
  it('renders oauth route unit summary and member labels on expanded targets', () => {
    const root = create(
      <RouteCard
        route={buildRoute({
          match: { kind: 'model', requestedModelPattern: 'gpt-4.1', displayName: 'gpt-4.1' },
          presentation: { displayName: 'gpt-4.1', displayIcon: null },
          targetCount: 1,
          enabledTargetCount: 1,
        })}
        brand={null}
        expanded
        onToggleExpand={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleEnabled={vi.fn()}
        onClearCooldown={vi.fn()}
        clearingCooldown={false}
        onRoutingStrategyChange={vi.fn()}
        updatingRoutingStrategy={false}
        targets={[
          buildTarget({
            account: { username: 'route-unit-anchor' },
            routeUnit: {
              id: 'pool-1',
              name: 'Codex Pool A',
              strategy: 'round_robin',
              memberCount: 3,
              members: [
                { accountId: 101, username: 'route-unit-anchor', siteName: 'site-a' },
                { accountId: 102, username: 'route-unit-backup', siteName: 'site-b' },
                { accountId: 103, username: 'route-unit-third', siteName: 'site-c' },
              ],
            },
          }),
        ]}
        loadingTargets={false}
        routeDecision={null}
        loadingDecision={false}
        candidateView={{ routeCandidates: [], accountOptions: [], tokenOptionsByAccountId: {} }}
        targetTokenDraft={{}}
        updatingTarget={{}}
        savingPriority={false}
        onTokenDraftChange={vi.fn()}
        onSaveToken={vi.fn()}
        onDeleteTarget={vi.fn()}
        onToggleTargetEnabled={vi.fn()}
        onTargetDragEnd={vi.fn()}
        missingTokenSiteItems={[]}
        missingTokenGroupItems={[]}
        onCreateTokenForMissing={vi.fn()}
        onAddTarget={vi.fn()}
        onSiteBlockModel={vi.fn()}
        expandedSourceGroupMap={{}}
        onToggleSourceGroup={vi.fn()}
      />,
    );

    const text = collectText(root.root);
    expect(text).toContain('Codex Pool A');
    expect(text).toContain('3 个成员');
    expect(text).toContain('轮询');
    expect(text).toContain('成员摘要');
    expect(text).toContain('route-unit-anchor');
    expect(text).toContain('route-unit-backup');
    expect(text).toContain('route-unit-third');
  });

  it('wraps the collapsed regex badge without hiding the full pattern', () => {
    const root = create(
      <RouteCard
        route={buildRoute()}
        brand={null}
        expanded={false}
        onToggleExpand={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleEnabled={vi.fn()}
        onClearCooldown={vi.fn()}
        clearingCooldown={false}
        onRoutingStrategyChange={vi.fn()}
        updatingRoutingStrategy={false}
        targets={undefined}
        loadingTargets={false}
        routeDecision={null}
        loadingDecision={false}
        candidateView={{ routeCandidates: [], accountOptions: [], tokenOptionsByAccountId: {} }}
        targetTokenDraft={{}}
        updatingTarget={{}}
        savingPriority={false}
        onTokenDraftChange={vi.fn()}
        onSaveToken={vi.fn()}
        onDeleteTarget={vi.fn()}
        onToggleTargetEnabled={vi.fn()}
        onTargetDragEnd={vi.fn()}
        missingTokenSiteItems={[]}
        missingTokenGroupItems={[]}
        onCreateTokenForMissing={vi.fn()}
        onAddTarget={vi.fn()}
        onSiteBlockModel={vi.fn()}
        expandedSourceGroupMap={{}}
        onToggleSourceGroup={vi.fn()}
      />,
    );

    expect(collectText(root.root)).toContain('m.');

    const regexBadge = root.root.find((node) => (
      node.props?.['data-tone'] === '-muted'
      && collectText(node) === LONG_REGEX_PATTERN
    ));

    expect(regexBadge.props.className).toContain('min-w-0');
    expect(regexBadge.props.className).toContain('whitespace-normal');
    expect(regexBadge.props.className).toContain('break-all');
    expect(regexBadge.props.className).not.toContain('truncate');
  });

  it('keeps collapsed route metadata in the same wrapping row instead of forcing a second line', () => {
    const root = create(
      <RouteCard
        route={buildRoute({
          match: { kind: 'model', requestedModelPattern: LONG_REGEX_PATTERN, displayName: 'minimax m2.1 群组名称' },
          presentation: { displayName: 'minimax m2.1 群组名称', displayIcon: null },
        })}
        brand={null}
        expanded={false}
        onToggleExpand={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleEnabled={vi.fn()}
        onClearCooldown={vi.fn()}
        clearingCooldown={false}
        onRoutingStrategyChange={vi.fn()}
        updatingRoutingStrategy={false}
        targets={undefined}
        loadingTargets={false}
        routeDecision={null}
        loadingDecision={false}
        candidateView={{ routeCandidates: [], accountOptions: [], tokenOptionsByAccountId: {} }}
        targetTokenDraft={{}}
        updatingTarget={{}}
        savingPriority={false}
        onTokenDraftChange={vi.fn()}
        onSaveToken={vi.fn()}
        onDeleteTarget={vi.fn()}
        onToggleTargetEnabled={vi.fn()}
        onTargetDragEnd={vi.fn()}
        missingTokenSiteItems={[]}
        missingTokenGroupItems={[]}
        onCreateTokenForMissing={vi.fn()}
        onAddTarget={vi.fn()}
        onSiteBlockModel={vi.fn()}
        expandedSourceGroupMap={{}}
        onToggleSourceGroup={vi.fn()}
      />,
    );

    const titleRow = root.root.find((node) => (
      node.type === 'div'
      && node.props['data-testid'] === 'collapsed-route-title-row'
    ));
    const body = root.root.find((node) => (
      node.type === 'div'
      && node.props['data-testid'] === 'collapsed-route-body'
    ));
    const content = root.root.find((node) => (
      node.type === 'div'
      && node.props['data-testid'] === 'collapsed-route-content'
    ));
    const icon = titleRow.find((node) => (
      node.type === 'span'
      && node.props['data-testid'] === 'collapsed-route-icon'
    ));
    const metaRow = root.root.find((node) => (
      node.type === 'div'
      && node.props['data-testid'] === 'collapsed-route-meta-row'
    ));
    const titleNode = titleRow.find((node) => (
      node.type === 'code'
      && collectText(node) === 'minimax m2.1 群组名称'
    ));
    const regexBadge = titleRow.find((node) => (
      node.props?.['data-tone'] === '-muted'
      && collectText(node) === LONG_REGEX_PATTERN
    ));

    expect(body.props.className).toContain('min-w-0');
    expect(body.props.className).not.toContain('grid-cols-[auto_minmax(0,1fr)]');
    expect(body.props.className).not.toContain('items-start');
    expect(body.props.className).not.toContain('overflow-hidden');
    expect(content.props.className).toContain('w-full');
    expect(content.props.className).toContain('flex-wrap');
    expect(content.props.className).toContain('items-center');
    expect(titleRow.props.className).toContain('flex-wrap');
    expect(titleRow.props.className).toContain('items-center');
    expect(titleRow.props.className).toContain('flex-[0_1_auto]');
    expect(icon.props.className).toContain('items-center');
    expect(icon.props.className).toContain('justify-center');
    expect(icon.props.className).not.toContain('self-start');
    expect(metaRow.props.className).toContain('flex-wrap');
    expect(metaRow.props.className).toContain('ml-auto');
    expect(metaRow.props.className).toContain('justify-end');
    expect(metaRow.props.className).not.toContain('col-start-2');
    expect(titleNode.props.className).toContain('min-w-0');
    expect(titleNode.props.className).toContain('break-words');
    expect(titleNode.props.className).not.toContain('truncate');
    expect(regexBadge.props.className).toContain('whitespace-normal');
    expect(regexBadge.props.className).toContain('break-all');
    expect(regexBadge.props.className).not.toContain('truncate');
  });

  it('does not render an empty model-pattern badge for manual route groups', () => {
    const manualGroup = buildRoute({
      match: { kind: 'model', requestedModelPattern: '', displayName: 'glm-5-rerouted' },
      backend: { kind: 'routes', routeIds: [11, 12, 13] },
      presentation: { displayName: 'glm-5-rerouted', displayIcon: null },
      targetCount: 5,
      enabledTargetCount: 5,
    });

    const collapsed = renderRouteCard({ route: manualGroup, expanded: false });
    const expanded = renderRouteCard({ route: manualGroup, expanded: true, compact: true });

    expect(collectText(collapsed.root)).toContain('glm-5-rerouted');
    expect(collectText(expanded.root)).toContain('glm-5-rerouted');
    expect(collapsed.root.findAll((node) => (
      node.props?.['data-tone'] === '-muted' && collectText(node) === ''
    ))).toHaveLength(0);
    expect(expanded.root.findAll((node) => (
      node.props?.['data-tone'] === '-muted' && collectText(node) === ''
    ))).toHaveLength(0);
  });

  it('renders a clear cooldown action on expanded cards', () => {
    const onClearCooldown = vi.fn();
    const root = create(
      <RouteCard
        route={buildRoute()}
        brand={null}
        expanded
        onToggleExpand={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleEnabled={vi.fn()}
        onClearCooldown={onClearCooldown}
        clearingCooldown={false}
        onRoutingStrategyChange={vi.fn()}
        updatingRoutingStrategy={false}
        targets={[]}
        loadingTargets={false}
        routeDecision={null}
        loadingDecision={false}
        candidateView={{ routeCandidates: [], accountOptions: [], tokenOptionsByAccountId: {} }}
        targetTokenDraft={{}}
        updatingTarget={{}}
        savingPriority={false}
        onTokenDraftChange={vi.fn()}
        onSaveToken={vi.fn()}
        onDeleteTarget={vi.fn()}
        onToggleTargetEnabled={vi.fn()}
        onTargetDragEnd={vi.fn()}
        missingTokenSiteItems={[]}
        missingTokenGroupItems={[]}
        onCreateTokenForMissing={vi.fn()}
        onAddTarget={vi.fn()}
        onSiteBlockModel={vi.fn()}
        expandedSourceGroupMap={{}}
        onToggleSourceGroup={vi.fn()}
      />,
    );

    const button = root.root.find((node) => (
      node.type === 'button'
      && typeof node.props.onClick === 'function'
      && collectText(node).trim() === '清除冷却'
    ));

    button.props.onClick();
    expect(onClearCooldown).toHaveBeenCalledTimes(1);
  });

  it('lets keyboard users toggle the collapsed summary card', () => {
    const onToggleExpand = vi.fn();
    const root = create(
      <RouteCard
        route={buildRoute()}
        brand={null}
        expanded={false}
        summaryExpanded={false}
        onToggleExpand={onToggleExpand}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleEnabled={vi.fn()}
        onClearCooldown={vi.fn()}
        clearingCooldown={false}
        onRoutingStrategyChange={vi.fn()}
        updatingRoutingStrategy={false}
        targets={undefined}
        loadingTargets={false}
        routeDecision={null}
        loadingDecision={false}
        candidateView={{ routeCandidates: [], accountOptions: [], tokenOptionsByAccountId: {} }}
        targetTokenDraft={{}}
        updatingTarget={{}}
        savingPriority={false}
        onTokenDraftChange={vi.fn()}
        onSaveToken={vi.fn()}
        onDeleteTarget={vi.fn()}
        onToggleTargetEnabled={vi.fn()}
        onTargetDragEnd={vi.fn()}
        missingTokenSiteItems={[]}
        missingTokenGroupItems={[]}
        onCreateTokenForMissing={vi.fn()}
        onAddTarget={vi.fn()}
        onSiteBlockModel={vi.fn()}
        expandedSourceGroupMap={{}}
        onToggleSourceGroup={vi.fn()}
      />,
    );

    const summaryCard = root.root.find((node) => (
      node.props?.role === 'button'
      && typeof node.props.onKeyDown === 'function'
      && String(node.props.className || '').includes('route--collapsed')
    ));

    expect(summaryCard.props.role).toBe('button');
    expect(summaryCard.props.tabIndex).toBe(0);
    expect(summaryCard.props['aria-expanded']).toBe(false);

    summaryCard.props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() });
    summaryCard.props.onKeyDown({ key: ' ', preventDefault: vi.fn() });

    expect(onToggleExpand).toHaveBeenCalledTimes(2);
  });

  it('renders desktop priority rail summaries for multiple target layers', () => {
    const root = create(
      <RouteCard
        route={buildRoute()}
        brand={null}
        expanded
        onToggleExpand={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleEnabled={vi.fn()}
        onClearCooldown={vi.fn()}
        clearingCooldown={false}
        onRoutingStrategyChange={vi.fn()}
        updatingRoutingStrategy={false}
        targets={[
          buildTarget({
            id: 11,
            priority: 0,
            account: { username: 'user_a' },
            site: { id: 1, name: 'site-a', platform: 'openai' },
          }),
          buildTarget({
            id: 12,
            accountId: 102,
            tokenId: 1002,
            priority: 1,
            sourceModel: 'gpt-4.1',
            account: { username: 'user_b' },
            site: { id: 2, name: 'site-b', platform: 'openai' },
            token: { id: 1002, name: 'token-b', accountId: 102, enabled: true, isDefault: false },
          }),
        ]}
        loadingTargets={false}
        routeDecision={null}
        loadingDecision={false}
        candidateView={{ routeCandidates: [], accountOptions: [], tokenOptionsByAccountId: {} }}
        targetTokenDraft={{}}
        updatingTarget={{}}
        savingPriority={false}
        onTokenDraftChange={vi.fn()}
        onSaveToken={vi.fn()}
        onDeleteTarget={vi.fn()}
        onToggleTargetEnabled={vi.fn()}
        onTargetDragEnd={vi.fn()}
        missingTokenSiteItems={[]}
        missingTokenGroupItems={[]}
        onCreateTokenForMissing={vi.fn()}
        onAddTarget={vi.fn()}
        onSiteBlockModel={vi.fn()}
        expandedSourceGroupMap={{}}
        onToggleSourceGroup={vi.fn()}
      />,
    );

    const text = collectText(root.root);
    expect(text).toContain('P0 · 1');
    expect(text).toContain('P1 · 1');
    expect(text).toContain('user_a');
    expect(text).toContain('user_b');

    const p0RailNode = root.root.find((node) => (
      node.type === 'div'
      && collectText(node) === 'P0 · 1'
      && node.props?.style?.borderRadius === 999
    ));
    const p1RailNode = root.root.find((node) => (
      node.type === 'div'
      && collectText(node) === 'P1 · 1'
      && node.props?.style?.borderRadius === 999
    ));

    expect(p0RailNode.props.style.background).not.toBe('var(--color-bg)');
    expect(p1RailNode.props.style.background).not.toBe('var(--color-bg)');
    expect(p0RailNode.props.style.color).not.toBe(p1RailNode.props.style.color);
  });

  it('renders oauth route unit summary badges on expanded cards', () => {
    const root = create(
      <RouteCard
        route={buildRoute()}
        brand={null}
        expanded
        onToggleExpand={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleEnabled={vi.fn()}
        onClearCooldown={vi.fn()}
        clearingCooldown={false}
        onRoutingStrategyChange={vi.fn()}
        updatingRoutingStrategy={false}
        targets={[
          buildTarget({
            id: 11,
            account: { username: 'pool-representative' },
            site: { id: 1, name: 'site-a', platform: 'openai' },
            ...( {
              routeUnit: {
                id: 7,
                name: 'Codex 池',
                memberCount: 3,
                strategy: 'round_robin',
                members: [
                  { accountId: 101, username: 'user_a', siteName: 'site-a' },
                  { accountId: 102, username: 'user_b', siteName: 'site-b' },
                  { accountId: 103, username: 'user_c', siteName: 'site-c' },
                ],
              },
            } as any ),
          }),
        ]}
        loadingTargets={false}
        routeDecision={null}
        loadingDecision={false}
        candidateView={{ routeCandidates: [], accountOptions: [], tokenOptionsByAccountId: {} }}
        targetTokenDraft={{}}
        updatingTarget={{}}
        savingPriority={false}
        onTokenDraftChange={vi.fn()}
        onSaveToken={vi.fn()}
        onDeleteTarget={vi.fn()}
        onToggleTargetEnabled={vi.fn()}
        onTargetDragEnd={vi.fn()}
        missingTokenSiteItems={[]}
        missingTokenGroupItems={[]}
        onCreateTokenForMissing={vi.fn()}
        onAddTarget={vi.fn()}
        onSiteBlockModel={vi.fn()}
        expandedSourceGroupMap={{}}
        onToggleSourceGroup={vi.fn()}
      />,
    );

    const text = collectText(root.root);
    expect(text).toContain('OAuth 路由池');
    expect(text).toContain('Codex 池');
    expect(text).toContain('3 个成员');
    expect(text).toContain('轮询');
    expect(text).toContain('成员摘要');
  });

  it('uses translate-only rect sorting for flat target shell rows', () => {
    const root = create(
      <RouteCard
        route={buildRoute()}
        brand={null}
        expanded
        onToggleExpand={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleEnabled={vi.fn()}
        onClearCooldown={vi.fn()}
        clearingCooldown={false}
        onRoutingStrategyChange={vi.fn()}
        updatingRoutingStrategy={false}
        targets={[
          buildTarget({ id: 11, priority: 0 }),
          buildTarget({ id: 12, accountId: 102, tokenId: 1002, priority: 1 }),
        ]}
        loadingTargets={false}
        routeDecision={null}
        loadingDecision={false}
        candidateView={{ routeCandidates: [], accountOptions: [], tokenOptionsByAccountId: {} }}
        targetTokenDraft={{}}
        updatingTarget={{}}
        savingPriority={false}
        onTokenDraftChange={vi.fn()}
        onSaveToken={vi.fn()}
        onDeleteTarget={vi.fn()}
        onToggleTargetEnabled={vi.fn()}
        onTargetDragEnd={vi.fn()}
        missingTokenSiteItems={[]}
        missingTokenGroupItems={[]}
        onCreateTokenForMissing={vi.fn()}
        onAddTarget={vi.fn()}
        onSiteBlockModel={vi.fn()}
        expandedSourceGroupMap={{}}
        onToggleSourceGroup={vi.fn()}
      />,
    );

    const sortableContext = root.root.findByType(SortableContext);
    expect(sortableContext.props.strategy).toBe(translateOnlyRectSortingStrategy);
  });

  it('shows a new-layer drop target while dragging inside compact desktop detail panels', () => {
    const renderCard = () => (
      <RouteCard
        route={buildRoute()}
        brand={null}
        expanded
        compact
        detailPanel
        onToggleExpand={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleEnabled={vi.fn()}
        onClearCooldown={vi.fn()}
        clearingCooldown={false}
        onRoutingStrategyChange={vi.fn()}
        updatingRoutingStrategy={false}
        targets={[
          buildTarget({ id: 11, priority: 0 }),
          buildTarget({ id: 12, accountId: 102, tokenId: 1002, priority: 0 }),
        ]}
        loadingTargets={false}
        routeDecision={null}
        loadingDecision={false}
        candidateView={{ routeCandidates: [], accountOptions: [], tokenOptionsByAccountId: {} }}
        targetTokenDraft={{}}
        updatingTarget={{}}
        savingPriority={false}
        onTokenDraftChange={vi.fn()}
        onSaveToken={vi.fn()}
        onDeleteTarget={vi.fn()}
        onToggleTargetEnabled={vi.fn()}
        onTargetDragEnd={vi.fn()}
        missingTokenSiteItems={[]}
        missingTokenGroupItems={[]}
        onCreateTokenForMissing={vi.fn()}
        onAddTarget={vi.fn()}
        onSiteBlockModel={vi.fn()}
        expandedSourceGroupMap={{}}
        onToggleSourceGroup={vi.fn()}
      />
    );
    const root = create(renderCard());

    const dndContext = root.root.find((node) => (
      typeof node.props.onDragStart === 'function'
      && typeof node.props.onDragEnd === 'function'
      && typeof node.props.onDragCancel === 'function'
    ));

    act(() => {
      sortableState.activeId = 12;
      dndContext.props.onDragStart?.({
        active: { id: 12 },
      });
      root.update(renderCard());
    });

    expect(collectText(root.root)).toContain('放到新档位');
    const shells = root.root.findAll((node) => (
      node.type === 'div'
      && node.props['data-testid'] === 'route-target-shell'
    ));
    const activeShell = shells.find((node) => node.props['data-target-id'] === 12);
    expect(activeShell).toBeDefined();
    expect(activeShell?.props.style.visibility).toBe('hidden');

    const newLayerTarget = root.root.find((node) => (
      node.type === 'div'
      && node.props['data-testid'] === 'route-priority-new-layer-target'
    ));
    expect(newLayerTarget.props.className).toContain('flex');
    expect(newLayerTarget.props.className).toContain('min-h-8');
  });

  it('keeps compact desktop detail bucket headers outside draggable target shells', () => {
    const root = create(
      <RouteCard
        route={buildRoute()}
        brand={null}
        expanded
        compact
        detailPanel
        onToggleExpand={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleEnabled={vi.fn()}
        onClearCooldown={vi.fn()}
        clearingCooldown={false}
        onRoutingStrategyChange={vi.fn()}
        updatingRoutingStrategy={false}
        targets={[
          buildTarget({ id: 11, priority: 0 }),
          buildTarget({ id: 12, accountId: 102, tokenId: 1002, priority: 0 }),
          buildTarget({ id: 21, accountId: 103, tokenId: 1003, priority: 1 }),
        ]}
        loadingTargets={false}
        routeDecision={null}
        loadingDecision={false}
        candidateView={{ routeCandidates: [], accountOptions: [], tokenOptionsByAccountId: {} }}
        targetTokenDraft={{}}
        updatingTarget={{}}
        savingPriority={false}
        onTokenDraftChange={vi.fn()}
        onSaveToken={vi.fn()}
        onDeleteTarget={vi.fn()}
        onToggleTargetEnabled={vi.fn()}
        onTargetDragEnd={vi.fn()}
        missingTokenSiteItems={[]}
        missingTokenGroupItems={[]}
        onCreateTokenForMissing={vi.fn()}
        onAddTarget={vi.fn()}
        onSiteBlockModel={vi.fn()}
        expandedSourceGroupMap={{}}
        onToggleSourceGroup={vi.fn()}
      />,
    );

    const bucketHeaders = root.root.findAll((node) => (
      node.type === 'div'
      && node.props['data-testid'] === 'route-priority-bucket-header'
    ));
    const shells = root.root.findAll((node) => (
      node.type === 'div'
      && node.props['data-testid'] === 'route-target-shell'
    ));

    expect(bucketHeaders.map((node) => collectText(node))).toEqual([
      'P0 · 2 目标',
      'P1 · 1 目标',
    ]);
    expect(shells).toHaveLength(3);
    expect(collectText(shells[0]!)).not.toContain('P0 · 2 目标');
    expect(collectText(shells[2]!)).not.toContain('P1 · 1 目标');
  });

  it('renders desktop target rows in sortable shell order within a single sortable list', () => {
    const root = create(
      <RouteCard
        route={buildRoute()}
        brand={null}
        expanded
        onToggleExpand={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleEnabled={vi.fn()}
        onClearCooldown={vi.fn()}
        clearingCooldown={false}
        onRoutingStrategyChange={vi.fn()}
        updatingRoutingStrategy={false}
        targets={[
          buildTarget({ id: 11, priority: 0 }),
          buildTarget({ id: 12, accountId: 102, tokenId: 1002, priority: 0 }),
          buildTarget({ id: 21, accountId: 103, tokenId: 1003, priority: 1 }),
        ]}
        loadingTargets={false}
        routeDecision={null}
        loadingDecision={false}
        candidateView={{ routeCandidates: [], accountOptions: [], tokenOptionsByAccountId: {} }}
        targetTokenDraft={{}}
        updatingTarget={{}}
        savingPriority={false}
        onTokenDraftChange={vi.fn()}
        onSaveToken={vi.fn()}
        onDeleteTarget={vi.fn()}
        onToggleTargetEnabled={vi.fn()}
        onTargetDragEnd={vi.fn()}
        missingTokenSiteItems={[]}
        missingTokenGroupItems={[]}
        onCreateTokenForMissing={vi.fn()}
        onAddTarget={vi.fn()}
        onSiteBlockModel={vi.fn()}
        expandedSourceGroupMap={{}}
        onToggleSourceGroup={vi.fn()}
      />,
    );

    const sortableList = root.root.find((node) => (
      node.type === 'div'
      && node.props['data-testid'] === 'route-target-sortable-list'
    ));
    const directShells = sortableList.findAll((node) => (
      node.type === 'div'
      && node.props['data-testid'] === 'route-target-shell'
    ));

    expect(directShells.map((child) => child.props['data-target-id'])).toEqual([11, 12, 21]);
  });

  it('omits long explanatory copy in compact detail panels', () => {
    const root = create(
      <RouteCard
        route={buildRoute({
          match: { kind: 'model', requestedModelPattern: 'gpt-4o-*', displayName: 'gpt-4o' },
          presentation: { displayName: 'gpt-4o', displayIcon: null },
        })}
        brand={null}
        expanded
        compact
        detailPanel
        onToggleExpand={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleEnabled={vi.fn()}
        onClearCooldown={vi.fn()}
        clearingCooldown={false}
        onRoutingStrategyChange={vi.fn()}
        updatingRoutingStrategy={false}
        targets={[buildTarget()]}
        loadingTargets={false}
        routeDecision={null}
        loadingDecision={false}
        candidateView={{ routeCandidates: [], accountOptions: [], tokenOptionsByAccountId: {} }}
        targetTokenDraft={{}}
        updatingTarget={{}}
        savingPriority={false}
        onTokenDraftChange={vi.fn()}
        onSaveToken={vi.fn()}
        onDeleteTarget={vi.fn()}
        onToggleTargetEnabled={vi.fn()}
        onTargetDragEnd={vi.fn()}
        missingTokenSiteItems={[]}
        missingTokenGroupItems={[]}
        onCreateTokenForMissing={vi.fn()}
        onAddTarget={vi.fn()}
        onSiteBlockModel={vi.fn()}
        expandedSourceGroupMap={{}}
        onToggleSourceGroup={vi.fn()}
      />,
    );

    const detailText = collectText(root.root);
    expect(detailText).not.toContain('通配符路由按请求实时决策');
    expect(detailText).not.toContain(getRouteRoutingStrategyDescription('weighted'));
  });

  it('places compact route strategy and add target controls on the same row', () => {
    const root = create(
      <RouteCard
        route={buildRoute()}
        brand={null}
        expanded
        compact
        detailPanel
        onToggleExpand={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleEnabled={vi.fn()}
        onClearCooldown={vi.fn()}
        clearingCooldown={false}
        onRoutingStrategyChange={vi.fn()}
        updatingRoutingStrategy={false}
        targets={[buildTarget()]}
        loadingTargets={false}
        routeDecision={null}
        loadingDecision={false}
        candidateView={{ routeCandidates: [], accountOptions: [], tokenOptionsByAccountId: {} }}
        targetTokenDraft={{}}
        updatingTarget={{}}
        savingPriority={false}
        onTokenDraftChange={vi.fn()}
        onSaveToken={vi.fn()}
        onDeleteTarget={vi.fn()}
        onToggleTargetEnabled={vi.fn()}
        onTargetDragEnd={vi.fn()}
        missingTokenSiteItems={[]}
        missingTokenGroupItems={[]}
        onCreateTokenForMissing={vi.fn()}
        onAddTarget={vi.fn()}
        onSiteBlockModel={vi.fn()}
        expandedSourceGroupMap={{}}
        onToggleSourceGroup={vi.fn()}
      />,
    );

    const compactActionRow = root.root.find((node) => (
      node.type === 'div'
      && node.props['data-testid'] === 'compact-route-action-row'
    ));
    const strategySelectWrap = compactActionRow.find((node) => (
      node.type === 'div'
      && node.props['data-testid'] === 'compact-route-strategy-select'
    ));
    const addRouteTargetButton = compactActionRow.find((node) => (
      node.type === 'button'
      && collectText(node).includes('添加目标')
    ));

    expect(compactActionRow.props.className).toContain('flex');
    expect(compactActionRow.props.className).toContain('justify-start');
    expect(collectText(compactActionRow)).toContain('路由策略');
    expect(collectText(compactActionRow)).toContain('添加目标');
    expect(strategySelectWrap.props.style.flex).toBe('0 0 168px');
    expect(strategySelectWrap.props.style.flex).toBe('0 0 168px');
  });

  it('keeps compact status badges inline with the route name', () => {
    const root = create(
      <RouteCard
        route={buildRoute({
          match: { kind: 'model', requestedModelPattern: 'gpt-5.2-codex', displayName: 'm.' },
          targetCount: 16,
        })}
        brand={null}
        expanded
        compact
        detailPanel
        onToggleExpand={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleEnabled={vi.fn()}
        onClearCooldown={vi.fn()}
        clearingCooldown={false}
        onRoutingStrategyChange={vi.fn()}
        updatingRoutingStrategy={false}
        targets={[buildTarget()]}
        loadingTargets={false}
        routeDecision={null}
        loadingDecision={false}
        candidateView={{ routeCandidates: [], accountOptions: [], tokenOptionsByAccountId: {} }}
        targetTokenDraft={{}}
        updatingTarget={{}}
        savingPriority={false}
        onTokenDraftChange={vi.fn()}
        onSaveToken={vi.fn()}
        onDeleteTarget={vi.fn()}
        onToggleTargetEnabled={vi.fn()}
        onTargetDragEnd={vi.fn()}
        missingTokenSiteItems={[]}
        missingTokenGroupItems={[]}
        onCreateTokenForMissing={vi.fn()}
        onAddTarget={vi.fn()}
        onSiteBlockModel={vi.fn()}
        expandedSourceGroupMap={{}}
        onToggleSourceGroup={vi.fn()}
      />,
    );

    const compactHeaderMain = root.root.find((node) => (
      node.type === 'div'
      && node.props['data-testid'] === 'compact-route-header-main'
    ));

    expect(compactHeaderMain.props.className).toContain('flex-row');
    expect(collectText(compactHeaderMain)).toContain('gpt-5.2-codex');
    expect(collectText(compactHeaderMain)).toContain('启用');
    expect(collectText(compactHeaderMain)).toContain('16 目标');
  });

  it('skips collapsed rerenders when only expanded-target state changes', () => {
    const routeTarget = buildRoute();
    let routeGraphReadCount = 0;
    const route = new Proxy(routeTarget, {
      get(target, property, receiver) {
        if (property === 'match') {
          routeGraphReadCount += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    }) as RouteSummaryRow;
    const callbacks = {
      onToggleExpand: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onToggleEnabled: vi.fn(),
      onClearCooldown: vi.fn(),
      onRoutingStrategyChange: vi.fn(),
      onTokenDraftChange: vi.fn(),
      onSaveToken: vi.fn(),
      onDeleteTarget: vi.fn(),
      onToggleTargetEnabled: vi.fn(),
      onTargetDragEnd: vi.fn(),
      onCreateTokenForMissing: vi.fn(),
      onAddTarget: vi.fn(),
      onSiteBlockModel: vi.fn(),
      onToggleSourceGroup: vi.fn(),
    };
    const candidateView = { routeCandidates: [], accountOptions: [], tokenOptionsByAccountId: {} };

    const renderCard = (targetTokenDraft: Record<number, number>, updatingTarget: Record<number, boolean>) => (
      <RouteCard
        route={route}
        brand={null}
        expanded={false}
        onToggleExpand={callbacks.onToggleExpand}
        onEdit={callbacks.onEdit}
        onDelete={callbacks.onDelete}
        onToggleEnabled={callbacks.onToggleEnabled}
        onClearCooldown={callbacks.onClearCooldown}
        clearingCooldown={false}
        onRoutingStrategyChange={callbacks.onRoutingStrategyChange}
        updatingRoutingStrategy={false}
        targets={undefined}
        loadingTargets={false}
        routeDecision={null}
        loadingDecision={false}
        candidateView={candidateView}
        targetTokenDraft={targetTokenDraft}
        updatingTarget={updatingTarget}
        savingPriority={false}
        onTokenDraftChange={callbacks.onTokenDraftChange}
        onSaveToken={callbacks.onSaveToken}
        onDeleteTarget={callbacks.onDeleteTarget}
        onToggleTargetEnabled={callbacks.onToggleTargetEnabled}
        onTargetDragEnd={callbacks.onTargetDragEnd}
        missingTokenSiteItems={[]}
        missingTokenGroupItems={[]}
        onCreateTokenForMissing={callbacks.onCreateTokenForMissing}
        onAddTarget={callbacks.onAddTarget}
        onSiteBlockModel={callbacks.onSiteBlockModel}
        expandedSourceGroupMap={{}}
        onToggleSourceGroup={callbacks.onToggleSourceGroup}
      />
    );

    let root!: WebTestRenderer;
    act(() => {
      root = create(renderCard({}, {}));
    });

    const initialReadCount = routeGraphReadCount;

    act(() => {
      root.update(renderCard({ 11: 1001 }, { 11: true }));
    });

    expect(routeGraphReadCount).toBe(initialReadCount);
  });

  it('skips collapsed rerenders when only expanded-only callback identities change', () => {
    const routeTarget = buildRoute();
    let routeGraphReadCount = 0;
    const route = new Proxy(routeTarget, {
      get(target, property, receiver) {
        if (property === 'match') {
          routeGraphReadCount += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    }) as RouteSummaryRow;
    const callbacksA = {
      onToggleExpand: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onToggleEnabled: vi.fn(),
      onClearCooldown: vi.fn(),
      onRoutingStrategyChange: vi.fn(),
      onTokenDraftChange: vi.fn(),
      onSaveToken: vi.fn(),
      onDeleteTarget: vi.fn(),
      onToggleTargetEnabled: vi.fn(),
      onTargetDragEnd: vi.fn(),
      onCreateTokenForMissing: vi.fn(),
      onAddTarget: vi.fn(),
      onSiteBlockModel: vi.fn(),
      onToggleSourceGroup: vi.fn(),
    };
    const callbacksB = {
      ...callbacksA,
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onClearCooldown: vi.fn(),
      onRoutingStrategyChange: vi.fn(),
      onTokenDraftChange: vi.fn(),
      onSaveToken: vi.fn(),
      onDeleteTarget: vi.fn(),
      onToggleTargetEnabled: vi.fn(),
      onTargetDragEnd: vi.fn(),
      onCreateTokenForMissing: vi.fn(),
      onAddTarget: vi.fn(),
      onSiteBlockModel: vi.fn(),
      onToggleSourceGroup: vi.fn(),
    };
    const candidateView = { routeCandidates: [], accountOptions: [], tokenOptionsByAccountId: {} };

    const renderCard = (callbacks: typeof callbacksA) => (
      <RouteCard
        route={route}
        brand={null}
        expanded={false}
        onToggleExpand={callbacks.onToggleExpand}
        onEdit={callbacks.onEdit}
        onDelete={callbacks.onDelete}
        onToggleEnabled={callbacks.onToggleEnabled}
        onClearCooldown={callbacks.onClearCooldown}
        clearingCooldown={false}
        onRoutingStrategyChange={callbacks.onRoutingStrategyChange}
        updatingRoutingStrategy={false}
        targets={undefined}
        loadingTargets={false}
        routeDecision={null}
        loadingDecision={false}
        candidateView={candidateView}
        targetTokenDraft={{}}
        updatingTarget={{}}
        savingPriority={false}
        onTokenDraftChange={callbacks.onTokenDraftChange}
        onSaveToken={callbacks.onSaveToken}
        onDeleteTarget={callbacks.onDeleteTarget}
        onToggleTargetEnabled={callbacks.onToggleTargetEnabled}
        onTargetDragEnd={callbacks.onTargetDragEnd}
        missingTokenSiteItems={[]}
        missingTokenGroupItems={[]}
        onCreateTokenForMissing={callbacks.onCreateTokenForMissing}
        onAddTarget={callbacks.onAddTarget}
        onSiteBlockModel={callbacks.onSiteBlockModel}
        expandedSourceGroupMap={{}}
        onToggleSourceGroup={callbacks.onToggleSourceGroup}
      />
    );

    const root = create(renderCard(callbacksA));
    const initialReadCount = routeGraphReadCount;

    act(() => {
      root.update(renderCard(callbacksB));
    });

    expect(routeGraphReadCount).toBe(initialReadCount);
  });
});
