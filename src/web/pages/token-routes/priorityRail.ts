import type { CSSProperties } from 'react';
import type { PriorityRailDragTarget, PriorityRailSection } from './types.js';
import { getPriorityTagStyle } from './utils.js';

type PriorityRailTargetLike = {
  id: number;
  priority: number;
};

type BuildPriorityRailDragTargetsOptions = {
  activeTargetId: number;
  hoveredPriority: number | null;
  showNewLayerTarget: boolean;
};

export const PRIORITY_RAIL_NEW_LAYER_PREFIX = 'priority-rail:new-layer:';

export function createPriorityRailNewLayerId(priority: number): string {
  return `${PRIORITY_RAIL_NEW_LAYER_PREFIX}${priority}`;
}

export function isPriorityRailNewLayerId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PRIORITY_RAIL_NEW_LAYER_PREFIX);
}

function parsePriorityRailNewLayerPriority(value: string): number | null {
  const raw = value.slice(PRIORITY_RAIL_NEW_LAYER_PREFIX.length);
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildPriorityRailSections(
  targets: PriorityRailTargetLike[],
): PriorityRailSection[] {
  const grouped = new Map<number, number[]>();

  for (const target of targets || []) {
    const priority = Number.isFinite(target.priority) ? target.priority : 0;
    if (!grouped.has(priority)) grouped.set(priority, []);
    grouped.get(priority)!.push(target.id);
  }

  return Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([priority, targetIds]) => ({
      priority,
      targetCount: targetIds.length,
      targetIds,
    }));
}

function normalizePriorityRailTargets<T extends PriorityRailTargetLike>(targets: T[]): T[] {
  return [...(targets || [])].sort((a, b) => {
    const priorityA = Number.isFinite(a.priority) ? a.priority : 0;
    const priorityB = Number.isFinite(b.priority) ? b.priority : 0;
    if (priorityA === priorityB) return a.id - b.id;
    return priorityA - priorityB;
  });
}

export function buildPriorityRailDragTargets(
  sections: PriorityRailSection[],
  options: BuildPriorityRailDragTargetsOptions,
): PriorityRailDragTarget[] {
  const targets: PriorityRailDragTarget[] = sections.map((section) => ({
    kind: 'existing_layer',
    priority: section.priority,
    highlighted: section.priority === options.hoveredPriority,
  }));

  if (options.showNewLayerTarget) {
    const highestPriority = sections.reduce((max, section) => Math.max(max, section.priority), -1);
    targets.push({
      kind: 'new_layer',
      priority: highestPriority + 1,
      highlighted: false,
    });
  }

  return targets;
}

export function applyPriorityRailDrop<T extends PriorityRailTargetLike>(
  targets: T[],
  activeId: number,
  overId: number | string,
): T[] {
  const normalized = normalizePriorityRailTargets(targets);
  const activeTarget = normalized.find((target) => target.id === activeId);
  if (!activeTarget) return normalized;

  if (isPriorityRailNewLayerId(overId)) {
    const afterPriority = parsePriorityRailNewLayerPriority(overId);
    if (afterPriority == null) return normalized;
    const targetPriority = afterPriority + 1;

    return normalizePriorityRailTargets(
      normalized.map((target) => {
        const priority = Number.isFinite(target.priority) ? target.priority : 0;
        if (target.id === activeId) return { ...target, priority: targetPriority };
        if (target.id !== activeId && priority > afterPriority) {
          return { ...target, priority: priority + 1 };
        }
        return target;
      }),
    );
  }

  const overTarget = normalized.find((target) => target.id === Number(overId));
  if (!overTarget || overTarget.id === activeId) return normalized;

  const targetPriority = Number.isFinite(overTarget.priority) ? overTarget.priority : 0;

  return normalizePriorityRailTargets(
    normalized.map((target) => (
      target.id === activeId
        ? { ...target, priority: targetPriority }
        : target
    )),
  );
}

export function buildPriorityRailNodeStyle(priority: number, highlighted: boolean): CSSProperties {
  const tone = getPriorityTagStyle(priority);

  return {
    border: `1px solid ${highlighted ? 'var(--color-primary)' : 'color-mix(in srgb, currentColor 24%, transparent)'}`,
    background: highlighted
      ? `color-mix(in srgb, ${tone.background} 78%, var(--color-bg))`
      : tone.background,
    color: highlighted ? 'var(--color-primary)' : tone.color,
  };
}
