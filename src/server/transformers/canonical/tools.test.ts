import { describe, expect, it } from 'vitest';

import {
  isCanonicalFunctionTool,
  isCanonicalNamedToolChoice,
  type CanonicalTool,
  type CanonicalToolChoice,
} from './tools.js';

describe('canonical tool guards', () => {
  it('classifies named function tools separately from raw passthrough tools', () => {
    const functionTool: CanonicalTool = {
      name: 'lookup_weather',
      description: 'Lookup weather',
      inputSchema: { type: 'object' },
    };
    const rawTool: CanonicalTool = {
      type: 'web_search',
      raw: { type: 'web_search_preview' },
    };

    expect(isCanonicalFunctionTool(functionTool)).toBe(true);
    expect(isCanonicalFunctionTool(rawTool)).toBe(false);
  });

  it('accepts only explicit named tool-choice objects', () => {
    const choices: Array<[CanonicalToolChoice | undefined, boolean]> = [
      [undefined, false],
      ['auto', false],
      ['none', false],
      ['required', false],
      [{ type: 'tool', name: 'lookup_weather' }, true],
      [{ type: 'raw', value: 'auto' }, false],
      [{ type: 'raw', value: { type: 'tool', name: 'lookup_weather' } }, false],
    ];

    for (const [choice, expected] of choices) {
      expect(isCanonicalNamedToolChoice(choice)).toBe(expected);
    }
  });
});
