import { describe, expect, it } from 'vitest';
import {
  deleteJsonPath,
  hasJsonPath,
  setJsonPath,
} from './jsonPathMutation.js';

describe('jsonPathMutation', () => {
  it('sets, detects, and deletes nested object and array paths', () => {
    const payload: Record<string, unknown> = { messages: [{ content: [] }] };

    setJsonPath(payload, 'messages.0.content.0.text', 'hello');
    setJsonPath(payload, 'metadata.trace.id', 'trace-1');

    expect(payload).toEqual({
      messages: [{ content: [{ text: 'hello' }] }],
      metadata: { trace: { id: 'trace-1' } },
    });
    expect(hasJsonPath(payload, 'messages.0.content.0.text')).toBe(true);
    expect(hasJsonPath(payload, 'messages.1.content')).toBe(false);

    deleteJsonPath(payload, 'messages.0.content.0');
    deleteJsonPath(payload, 'metadata.trace.id');

    expect(payload).toEqual({
      messages: [{ content: [] }],
      metadata: { trace: {} },
    });
  });
});
