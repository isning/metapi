import {
  closestCenter,
  pointerWithin,
  type CollisionDetection,
} from '@dnd-kit/core';

import { fallbackStageIdFromDropTarget } from './fallbackStageOrdering.js';

const NEW_STAGE_PREFIX = 'new-fallback-stage:';

export function newFallbackStageDropTargetId(afterStageId: string): string {
  return `${NEW_STAGE_PREFIX}${afterStageId}`;
}

export function fallbackStageIdFromNewDropTarget(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith(NEW_STAGE_PREFIX)) return null;
  const id = value.slice(NEW_STAGE_PREFIX.length).trim();
  return id || null;
}

export const fallbackStageCollisionDetection: CollisionDetection = (args) => {
  const isActiveCollision = (collision: { id: unknown }) => String(collision.id) === String(args.active.id);
  const allPointerCollisions = pointerWithin(args);
  const activeCollision = allPointerCollisions.find(isActiveCollision);
  const pointerCollisions = allPointerCollisions.filter((collision) => !isActiveCollision(collision));
  const newStageCollisions = pointerCollisions.filter(
    (collision) => fallbackStageIdFromNewDropTarget(collision.id) !== null,
  );
  if (newStageCollisions.length) return newStageCollisions;
  const memberCollisions = pointerCollisions.filter(
    (collision) => fallbackStageIdFromDropTarget(collision.id) === null,
  );
  if (memberCollisions.length) return memberCollisions;
  if (activeCollision) return [activeCollision];
  const stageCollisions = pointerCollisions.filter(
    (collision) => fallbackStageIdFromDropTarget(collision.id) !== null,
  );
  return stageCollisions.length
    ? stageCollisions
    : closestCenter(args).filter((collision) => !isActiveCollision(collision));
};
