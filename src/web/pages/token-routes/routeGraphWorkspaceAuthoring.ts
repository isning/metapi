import { makeNodeDraft } from './routeGraphRegistry.js';
import type { RouteGraphNode, RouteGraphNodeType } from './routeGraphTypes.js';
import type { RouteGraphWorkspaceNodeDraft } from '../../../shared/routeGraphOperations.js';

export type RouteGraphOccupiedRect = {
  x: number;
  y: number;
  width?: number;
  height?: number;
};

export function findAvailableRouteGraphPosition(
  desired: { x: number; y: number },
  occupied: readonly RouteGraphOccupiedRect[],
  size: { width: number; height: number },
  gap = 32,
): { x: number; y: number } {
  const stepX = size.width + gap;
  const stepY = size.height + gap;
  const isFree = (position: { x: number; y: number }) => occupied.every((rect) => (
    position.x + size.width + gap <= rect.x
    || rect.x + (rect.width || size.width) + gap <= position.x
    || position.y + size.height + gap <= rect.y
    || rect.y + (rect.height || size.height) + gap <= position.y
  ));
  if (isFree(desired)) return desired;

  for (let radius = 1; radius <= 12; radius += 1) {
    const offsets: Array<{ x: number; y: number }> = [
      { x: radius, y: 0 },
      { x: 0, y: radius },
      { x: -radius, y: 0 },
      { x: 0, y: -radius },
    ];
    for (let offset = 1; offset < radius; offset += 1) {
      offsets.push(
        { x: radius, y: offset },
        { x: radius - offset, y: radius },
        { x: -offset, y: radius },
        { x: -radius, y: radius - offset },
        { x: -radius, y: -offset },
        { x: -radius + offset, y: -radius },
        { x: offset, y: -radius },
        { x: radius, y: -radius + offset },
      );
    }
    for (const offset of offsets) {
      const candidate = {
        x: desired.x + offset.x * stepX,
        y: desired.y + offset.y * stepY,
      };
      if (isFree(candidate)) return candidate;
    }
  }
  return { x: desired.x + stepX * 13, y: desired.y };
}

export function createPrimitiveNodeDraft(
  type: RouteGraphNodeType,
  index: number,
  position: { x: number; y: number },
): RouteGraphWorkspaceNodeDraft {
  const draft = makeNodeDraft(type, index, position);
  if (draft.type !== 'route_endpoint') return draft as RouteGraphWorkspaceNodeDraft;
  const { routeEndpointId: _routeEndpointId, ...command } = draft as Omit<Extract<RouteGraphNode, { type: 'route_endpoint' }>, 'id'>;
  return command as RouteGraphWorkspaceNodeDraft;
}
