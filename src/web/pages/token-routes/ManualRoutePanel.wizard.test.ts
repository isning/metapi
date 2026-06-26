import { describe, expect, it } from 'vitest';

import {
  WIZARD_STEPS,
  getWizardStepIndex,
  moveSourceRouteId,
  toggleSourceRouteId,
} from './ManualRoutePanel.js';

describe('ManualRoutePanel wizard helpers', () => {
  it('keeps source route selection ordered and duplicate-free while toggling', () => {
    expect(toggleSourceRouteId([], 3)).toEqual([3]);
    expect(toggleSourceRouteId([3], 5)).toEqual([3, 5]);
    expect(toggleSourceRouteId([3, 5], 3)).toEqual([5]);
    expect(toggleSourceRouteId([3, 5], 5)).toEqual([3]);
  });

  it('moves selected route ids one priority band at a time without crossing boundaries', () => {
    const selected = [10, 20, 30];

    expect(moveSourceRouteId(selected, 20, -1)).toEqual([20, 10, 30]);
    expect(moveSourceRouteId(selected, 20, 1)).toEqual([10, 30, 20]);
    expect(moveSourceRouteId(selected, 10, -1)).toBe(selected);
    expect(moveSourceRouteId(selected, 30, 1)).toBe(selected);
    expect(moveSourceRouteId(selected, 99, 1)).toBe(selected);
  });

  it('defines the wizard rail as a stable linear workflow', () => {
    expect(WIZARD_STEPS.map((step) => step.id)).toEqual([
      'type',
      'match',
      'backend',
      'options',
      'review',
    ]);
    expect(getWizardStepIndex('type')).toBe(0);
    expect(getWizardStepIndex('backend')).toBe(2);
    expect(getWizardStepIndex('review')).toBe(4);
    expect(getWizardStepIndex('unknown' as never)).toBe(0);
  });
});
