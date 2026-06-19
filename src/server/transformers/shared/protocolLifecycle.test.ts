import { describe, expect, it, vi } from 'vitest';

import { createProxyStreamLifecycle } from './protocolLifecycle.js';

describe('proxy stream lifecycle', () => {
  it('cancels upstream readers when the unframed SSE buffer exceeds the configured limit', async () => {
    const cancel = vi.fn(async () => undefined);
    const releaseLock = vi.fn();
    const end = vi.fn();
    const onLimitExceeded = vi.fn();
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: 12345') })
        .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('67890') }),
      cancel,
      releaseLock,
    };

    const lifecycle = createProxyStreamLifecycle({
      reader,
      response: { end },
      pullEvents: () => ({ events: [], rest: '' }),
      handleEvent: () => false,
      maxBufferBytes: 8,
      onLimitExceeded,
    });

    await lifecycle.run();

    expect(onLimitExceeded).toHaveBeenCalledWith('upstream SSE buffer exceeded 8 bytes');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });
});
