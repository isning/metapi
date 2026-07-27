import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { webI18nResources } from '../../i18n/resources/index.js';

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), `src/web/pages/token-routes/${relativePath}`), 'utf8');
}

describe('RouteGroupWorkspace native boundary', () => {
  const workspace = read('RouteGroupWorkspace.tsx');
  const resource = read('useRouteGroupWorkspaceResource.ts');
  const detail = read('RouteGroupDetail.tsx');
  const candidateRow = read('RouteGroupCandidateRow.tsx');
  const editor = read('RouteGroupEditorDialog.tsx');
  const sourcePicker = read('RouteGroupSourcePicker.tsx');
  const picker = read('RouteGroupCandidatePicker.tsx');
  const presentation = read('routeGroupPresentation.ts');
  const sources = [
    workspace,
    resource,
    detail,
    candidateRow,
    editor,
    sourcePicker,
    picker,
    presentation,
  ];

  it('uses Route Group management DTOs and opaque identifiers', () => {
    expect(workspace).toContain('RouteGroupManagementListItem');
    expect(detail).toContain('RouteGroupManagementCandidate');
    for (const source of sources) {
      expect(source).not.toContain('RouteSummaryRow');
      expect(source).not.toContain('RouteEndpointTarget');
      expect(source).not.toContain('tokenRouteContract');
      expect(source).not.toContain('routeId: number');
    }
  });

  it('keeps each data lifecycle in its owning module', () => {
    expect(resource).toContain('api.getRouteGroupPage');
    expect(resource).toContain('api.batchUpdateRouteGroups');
    expect(resource).toContain('const loadVisiblePage = useCallback');
    expect(resource).toContain('const revalidateVisiblePage = useCallback');
    expect(resource).toContain('const [listLoading, setListLoading]');
    expect(editor).toContain('.getRouteGroupSourceCatalog(');
    expect(editor).toContain('<RouteGroupSourcePicker');
    expect(sourcePicker).not.toMatch(/\bapi\.[A-Za-z][A-Za-z0-9]*\(/);
    expect(picker).toContain('.getRouteGroupCandidateCatalog(');
    expect(detail).toContain('useRouteGroupFallbackStages');
    expect(detail).toContain('api.moveRouteGroupCandidatesToFallbackStages');
    expect(detail).toContain('<RouteGroupCandidateRow');
    expect(candidateRow).toContain('api.updateRouteGroupMember');
    expect(candidateRow).toContain('api.deleteRouteGroupCandidate');
    expect(workspace).not.toMatch(/\bapi\.[A-Za-z][A-Za-z0-9]*\(/);
    expect(workspace).not.toContain('useRouteGroupFallbackStages');
  });

  it('keeps generated-field permissions separate from fallback-flow controls', () => {
    expect(presentation).toContain('function routeGroupCapabilities(');
    expect(presentation).toContain('canEditGeneratedFields');
    expect(presentation).toContain('canEditCandidateControl');
    expect(presentation).toContain('canEditFallbackFlow');
    expect(candidateRow).toMatch(/\{detailsOpen \? \(/);
    expect(detail).toContain('disabled: placementPending');
    expect(editor).toContain('capabilities.canEditGeneratedFields');
  });

  it('preserves optimistic fallback drag behavior without list revalidation', () => {
    expect(detail).toContain('const refreshStages = useCallback');
    expect(detail).toContain('const refreshStagesAndSummary = useCallback');
    const dragMutation = detail.slice(
      detail.indexOf('const moveCandidateByDrag'),
      detail.indexOf('const clearCandidateDrag'),
    );
    expect(dragMutation).not.toContain('refreshStages()');
    expect(dragMutation).toContain('setStages(group.id, nextStages)');
    expect(dragMutation).toContain('setStages(group.id, moved.stages)');
    expect(dragMutation).toContain('moveFallbackStageCandidateToNewStage');
    expect(dragMutation).toContain('changedFallbackStageCandidatePlacements');
    expect(dragMutation).not.toContain('onSummaryChanged');
    expect(detail).toContain('disabled: !active');
    expect(detail).toContain('active={activeCandidateId !== null}');
    expect(detail).toContain('grid-rows-[0fr] opacity-0');
    expect(detail).toContain('grid-rows-[1fr] opacity-100');
  });

  it('retains one list control implementation for every Route Group tab', () => {
    expect(workspace).toContain('const batchVisibilityActions');
    expect(workspace).toContain('batchVisibilityActions.map');
    expect(workspace).not.toContain('{tab === "manual" ? (');
    expect(workspace).toContain('route-card-collapsed route--collapsed');
    expect(workspace).toContain('route-list-workbench-layout');
    expect(workspace).toContain('SegmentedTabBar<GroupTab>');
    expect(workspace).toContain('ResponsiveFilterPanel');
  });

  it('keeps the page as a bounded orchestration and presentation shell', () => {
    expect(workspace.split('\n').length).toBeLessThanOrEqual(1500);
    expect(workspace).toContain('useRouteGroupWorkspaceResource(refreshSignal)');
    expect(workspace).toContain('<RouteGroupDetail');
    expect(workspace).toContain('<RouteGroupEditorDialog');
    expect(workspace).not.toContain('getRouteGroupSourceCatalog');
    expect(workspace).not.toContain('getRouteGroupCandidateCatalog');
    expect(workspace).not.toContain('moveRouteGroupCandidatesToFallbackStages');
  });

  it('uses current terminology and complete static i18n resources across extracted modules', () => {
    const combined = sources.join('\n');
    expect(combined).not.toContain('manualRoutePanel');
    expect(combined).not.toContain('priorityBuckets');
    expect(combined).not.toContain('pages.tokenRoutes.targets');
    expect(combined).toContain('pages.tokenRoutes.routeCard.manuallyAdjusted');
    const keys = Array.from(combined.matchAll(/tr\(["']([^"']+)["']\)/g), (match) => match[1]!);
    for (const key of keys) {
      expect(webI18nResources.zh[key]).toEqual(expect.any(String));
      expect(webI18nResources.en[key]).toEqual(expect.any(String));
    }
  });
});
