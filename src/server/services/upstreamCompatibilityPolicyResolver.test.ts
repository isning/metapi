import { describe, expect, it } from 'vitest';
import { resolveDispatchUpstreamCompatibilityPolicy } from './upstreamCompatibilityPolicyResolver.js';

describe('upstream compatibility policy resolver', () => {
  it('inherits compatibility policy from site, account, token, endpoint, and target layers in order', () => {
    const resolved = resolveDispatchUpstreamCompatibilityPolicy({
      defaultCompatibilityPolicy: {
        reasoningHistory: {
          transport: {
            mode: 'native',
          },
        },
      },
      site: {
        compatibilityPolicy: JSON.stringify({
          reasoningHistory: {
            transport: {
              mode: 'content_think_tag',
              maxReasoningBytes: 1024,
            },
          },
        }),
      },
      account: {
        extraConfig: JSON.stringify({
          compatibilityPolicy: {
            reasoningHistory: {
              transport: {
                thinkTag: {
                  openTag: '<reason>',
                },
              },
            },
          },
        }),
      },
      token: {
        compatibilityPolicy: {
          reasoningHistory: {
            transport: {
              overflow: 'drop',
            },
          },
        },
      },
      routeEndpointCompatibilityPolicy: {
        reasoningHistory: {
          transport: {
            thinkTag: {
              closeTag: '</reason>',
            },
          },
        },
      },
      selectedEndpointTarget: {
        compatibilityPolicy: {
          reasoningHistory: {
            transport: {
              mode: 'native',
              maxReasoningBytes: 2048,
            },
          },
        },
      },
    });

    expect(resolved.reasoningHistory.transport).toMatchObject({
      mode: 'native',
      maxReasoningBytes: 2048,
      overflow: 'drop',
      thinkTag: {
        openTag: '<reason>',
        closeTag: '</reason>',
        separator: '\n\n',
      },
    });
  });

  it('does not infer upstream behavior from a platform name on the site carrier', () => {
    const siteWithIgnoredPlatform = {
      platform: 'claude',
      compatibilityPolicy: undefined,
    } as unknown as { compatibilityPolicy?: string | Record<string, unknown> | null };

    const resolved = resolveDispatchUpstreamCompatibilityPolicy({
      defaultCompatibilityPolicy: {
        reasoningHistory: {
          transport: {
            mode: 'content_think_tag',
          },
        },
      },
      site: siteWithIgnoredPlatform,
    });

    expect(resolved.reasoningHistory.transport.mode).toBe('content_think_tag');
  });
});
