import { describe, expect, it } from 'vitest';
import { extractClaudeCodeSessionId } from '../../proxy-core/cliProfiles/claudeCodeProfile.js';
import { isCodexResponsesSurface } from '../../proxy-core/cliProfiles/codexProfile.js';
import { detectDownstreamClientContext } from '../../proxy-core/downstreamClientContext.js';

describe('extractClaudeCodeSessionId', () => {
  it('extracts session uuid from axonhub-compatible Claude Code user ids', () => {
    expect(extractClaudeCodeSessionId(
      'user_20836b5653ed68aa981604f502c0a491397f6053826a93c953423632578d38ad_account__session_f25958b8-e75c-455d-8b40-f006d87cc2a4',
    )).toBe('f25958b8-e75c-455d-8b40-f006d87cc2a4');
  });

  it('returns null for non-Claude-Code user ids', () => {
    expect(extractClaudeCodeSessionId('user_123')).toBe(null);
    expect(extractClaudeCodeSessionId('session_f25958b8-e75c-455d-8b40-f006d87cc2a4')).toBe(null);
  });
});

describe('isCodexResponsesSurface', () => {
  it('detects Codex responses surface from originator, stainless, and turn-state headers', () => {
    expect(isCodexResponsesSurface({
      originator: 'codex_cli_rs',
    })).toBe(true);

    expect(isCodexResponsesSurface({
      'x-stainless-lang': 'typescript',
    })).toBe(true);

    expect(isCodexResponsesSurface({
      'x-codex-turn-state': 'turn-state-123',
    })).toBe(true);
  });

  it('detects broader Codex official-client family headers from user-agent and originator prefixes', () => {
    expect(isCodexResponsesSurface({
      'user-agent': 'Mozilla/5.0 codex_chatgpt_desktop/1.2.3',
    })).toBe(true);

    expect(isCodexResponsesSurface({
      originator: 'codex_vscode',
    })).toBe(true);
  });

  it('returns false for generic responses clients', () => {
    expect(isCodexResponsesSurface({
      'content-type': 'application/json',
    })).toBe(false);
  });
});

describe('detectDownstreamClientContext', () => {
  it('recognizes Codex requests and attaches Session_id as session and trace hint', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/responses',
      headers: {
        originator: 'codex_cli_rs',
        Session_id: 'codex-session-123',
      },
    })).toEqual({
      clientKind: 'codex',
      clientAppId: 'codex_cli_rs',
      clientAppName: 'Codex CLI',
      clientConfidence: 'exact',
      sessionId: 'codex-session-123',
      traceHint: 'codex-session-123',
    });
  });

  it('keeps Codex requests without Session_id as client-only context', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/responses/compact',
      headers: {
        'x-stainless-lang': 'typescript',
      },
    })).toEqual({
      clientKind: 'codex',
      clientAppId: 'codex',
      clientAppName: 'Codex',
      clientConfidence: 'heuristic',
    });
  });

  it('recognizes conversation_id-only Codex requests as continuation-capable sessions', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/responses',
      headers: {
        conversation_id: 'codex-conversation-123',
      },
    })).toEqual({
      clientKind: 'codex',
      clientAppId: 'codex',
      clientAppName: 'Codex',
      clientConfidence: 'heuristic',
      sessionId: 'codex-conversation-123',
      traceHint: 'codex-conversation-123',
    });
  });

  it('recognizes broader Codex official-client user-agent families without requiring stainless headers', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/responses',
      headers: {
        'user-agent': 'Mozilla/5.0 codex_chatgpt_desktop/1.2.3',
      },
    })).toEqual({
      clientKind: 'codex',
      clientAppId: 'codex_chatgpt_desktop',
      clientAppName: 'Codex Desktop',
      clientConfidence: 'exact',
    });
  });

  it('recognizes broader Codex official-client originator prefixes', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/responses',
      headers: {
        originator: 'codex_exec',
      },
    })).toEqual({
      clientKind: 'codex',
      clientAppId: 'codex_exec',
      clientAppName: 'Codex Exec',
      clientConfidence: 'exact',
    });
  });

  it('prefers explicit self-reported client names before protocol-family fallbacks', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/responses',
      headers: {
        'openai-beta': 'responses-2025-03-11',
        'x-openai-client-user-agent': '{"client":"openclaw"}',
      },
    })).toEqual({
      clientKind: 'codex',
      clientAppId: 'openclaw',
      clientAppName: 'openclaw',
      clientConfidence: 'exact',
    });
  });

  it('treats explicit OpenClaw user-agent headers as self-reported app names', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/responses',
      headers: {
        'openai-beta': 'responses-2025-03-11',
        'user-agent': 'OpenClaw/1.0',
      },
    })).toEqual({
      clientKind: 'codex',
      clientAppId: 'openclaw',
      clientAppName: 'OpenClaw',
      clientConfidence: 'exact',
    });
  });

  it('recognizes Claude Code requests from metadata.user_id without mutating the body', () => {
    const body = {
      model: 'claude-opus-4-6',
      metadata: {
        user_id: 'user_20836b5653ed68aa981604f502c0a491397f6053826a93c953423632578d38ad_account__session_f25958b8-e75c-455d-8b40-f006d87cc2a4',
      },
    };

    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/messages',
      body,
    })).toEqual({
      clientKind: 'claude_code',
      clientAppId: 'claude_code',
      clientAppName: 'Claude Code',
      clientConfidence: 'exact',
      sessionId: 'f25958b8-e75c-455d-8b40-f006d87cc2a4',
      traceHint: 'f25958b8-e75c-455d-8b40-f006d87cc2a4',
    });
    expect(body).toEqual({
      model: 'claude-opus-4-6',
      metadata: {
        user_id: 'user_20836b5653ed68aa981604f502c0a491397f6053826a93c953423632578d38ad_account__session_f25958b8-e75c-455d-8b40-f006d87cc2a4',
      },
    });
  });

  it('recognizes Claude Code from claude-cli request headers before Codex heuristics on /v1/messages', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/messages',
      headers: {
        'user-agent': 'claude-cli/2.1.63 (external, cli)',
        'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
        'anthropic-version': '2023-06-01',
        'x-app': 'cli',
        'x-stainless-lang': 'js',
      },
      body: {
        model: 'claude-sonnet-4-5',
      },
    })).toEqual({
      clientKind: 'claude_code',
      clientAppId: 'claude_code',
      clientAppName: 'Claude Code',
      clientConfidence: 'exact',
    });
  });

  it('falls back to generic when Claude metadata.user_id is missing or invalid', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/messages',
      body: {
        metadata: {
          user_id: 'user_123',
        },
      },
    })).toEqual({
      clientKind: 'generic',
    });
  });

  it('uses explicit generic session fields as affinity keys without changing client kind', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/messages',
      body: {
        metadata: {
          session_id: 'abc123',
        },
      },
    })).toEqual({
      clientKind: 'generic',
      sessionId: 'abc123',
      traceHint: 'abc123',
    });

    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'x-metapi-affinity-key': 'chat-session-1',
      },
      body: {
        model: 'gpt-4o',
      },
    })).toEqual({
      clientKind: 'generic',
      sessionId: 'chat-session-1',
      traceHint: 'chat-session-1',
    });
  });

  it('derives an opaque affinity key from stable prompt content when no session id is supplied', () => {
    const firstTurn = detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      body: {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Help me plan a database migration.' },
        ],
      },
    });
    const continuedTurn = detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      body: {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Help me plan a database migration.' },
          { role: 'assistant', content: 'First, take a backup.' },
          { role: 'user', content: 'Now give me the SQL.' },
        ],
      },
    });

    expect(firstTurn).toEqual({
      clientKind: 'generic',
      contentAffinityKey: expect.stringMatching(/^content:[A-Za-z0-9_-]+$/),
    });
    expect(continuedTurn.sessionId).toBeUndefined();
    expect(continuedTurn.contentAffinityKey).toBe(firstTurn.contentAffinityKey);
  });

  it('keeps content-derived affinity isolated when the stable prompt prefix differs', () => {
    const left = detectDownstreamClientContext({
      downstreamPath: '/v1/messages',
      body: {
        system: 'You are a concise assistant.',
        messages: [{ role: 'user', content: 'Summarize this report.' }],
      },
    });
    const right = detectDownstreamClientContext({
      downstreamPath: '/v1/messages',
      body: {
        system: 'You are a concise assistant.',
        messages: [{ role: 'user', content: 'Write a migration plan.' }],
      },
    });

    expect(left.contentAffinityKey).toMatch(/^content:/);
    expect(right.contentAffinityKey).toMatch(/^content:/);
    expect(right.contentAffinityKey).not.toBe(left.contentAffinityKey);
  });

  it('derives the same hint from OpenAI Responses string input and its continued array form', () => {
    const first = detectDownstreamClientContext({
      downstreamPath: '/v1/responses',
      body: { instructions: 'Be concise.', input: 'Inspect the route graph.' },
    });
    const continued = detectDownstreamClientContext({
      downstreamPath: '/v1/responses',
      body: {
        instructions: 'Be concise.',
        input: [
          { role: 'user', content: [{ type: 'input_text', text: 'Inspect the route graph.' }] },
          { role: 'assistant', content: [{ type: 'output_text', text: 'Starting.' }] },
        ],
      },
    });

    expect(first.contentAffinityKey).toMatch(/^content:/);
    expect(continued.contentAffinityKey).toBe(first.contentAffinityKey);
  });

  it('ignores system-like messages added after the first user turn', () => {
    const first = detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      body: { messages: [{ role: 'user', content: 'Start a session.' }] },
    });
    const continued = detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      body: {
        messages: [
          { role: 'user', content: 'Start a session.' },
          { role: 'assistant', content: 'Started.' },
          { role: 'developer', content: 'A later per-turn instruction.' },
          { role: 'user', content: 'Continue.' },
        ],
      },
    });

    expect(continued.contentAffinityKey).toBe(first.contentAffinityKey);
  });

  it('prefers an explicit affinity key over content-derived affinity', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: { 'x-metapi-affinity-key': 'explicit-session' },
      body: {
        messages: [{ role: 'user', content: 'This content must not become the session id.' }],
      },
    })).toEqual({
      clientKind: 'generic',
      sessionId: 'explicit-session',
      traceHint: 'explicit-session',
    });
  });

  it('normalizes Anthropic text blocks without letting tool or image blocks change the hint', () => {
    const textOnly = detectDownstreamClientContext({
      downstreamPath: '/v1/messages',
      body: {
        system: [{ type: 'text', text: '  Be   concise.  ' }],
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: 'Inspect   this route.' }],
        }],
      },
    });
    const withNonTextBlocks = detectDownstreamClientContext({
      downstreamPath: '/v1/messages',
      body: {
        system: [{ type: 'text', text: 'Be concise.' }],
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', data: 'not-part-of-affinity' } },
            { type: 'text', text: 'Inspect this route.' },
            { type: 'tool_result', content: 'not-part-of-affinity' },
          ],
        }],
      },
    });

    expect(textOnly.contentAffinityKey).toMatch(/^content:/);
    expect(withNonTextBlocks.contentAffinityKey).toBe(textOnly.contentAffinityKey);
  });

  it('derives stable Gemini hints from text parts and ignores later conversation turns', () => {
    const first = detectDownstreamClientContext({
      downstreamPath: '/v1beta/models/gemini-2.5-pro:generateContent',
      body: {
        contents: [{ role: 'user', parts: [{ text: 'Explain this schema.' }] }],
      },
    });
    const continued = detectDownstreamClientContext({
      downstreamPath: '/v1beta/models/gemini-2.5-pro:generateContent',
      body: {
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: 'image/png', data: 'not-part-of-affinity' } },
              { text: 'Explain this schema.' },
            ],
          },
          { role: 'model', parts: [{ text: 'The schema contains...' }] },
          { role: 'user', parts: [{ text: 'Now optimize it.' }] },
        ],
      },
    });

    expect(first.contentAffinityKey).toMatch(/^content:/);
    expect(continued.contentAffinityKey).toBe(first.contentAffinityKey);
  });

  it('includes native Gemini systemInstruction text in the content hint', () => {
    const concise = detectDownstreamClientContext({
      downstreamPath: '/v1beta/models/gemini-2.5-pro:generateContent',
      body: {
        systemInstruction: { parts: [{ text: 'Be concise.' }] },
        contents: [{ role: 'user', parts: [{ text: 'Inspect this route.' }] }],
      },
    });
    const detailed = detectDownstreamClientContext({
      downstreamPath: '/v1beta/models/gemini-2.5-pro:generateContent',
      body: {
        systemInstruction: { parts: [{ text: 'Be detailed.' }] },
        contents: [{ role: 'user', parts: [{ text: 'Inspect this route.' }] }],
      },
    });

    expect(concise.contentAffinityKey).toMatch(/^content:/);
    expect(detailed.contentAffinityKey).toMatch(/^content:/);
    expect(detailed.contentAffinityKey).not.toBe(concise.contentAffinityKey);
  });

  it('bounds content hints so text after the per-part limit cannot alter affinity', () => {
    const prefix = 'x'.repeat(4_096);
    const left = detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      body: { messages: [{ role: 'user', content: `${prefix}left-tail` }] },
    });
    const right = detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      body: { messages: [{ role: 'user', content: `${prefix}right-tail` }] },
    });

    expect(left.contentAffinityKey).toMatch(/^content:/);
    expect(right.contentAffinityKey).toBe(left.contentAffinityKey);
  });

  it('does not derive a content hint without a first user text prefix', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      body: {
        messages: [
          { role: 'system', content: 'System text alone is insufficient.' },
          { role: 'assistant', content: 'No user request yet.' },
        ],
      },
    })).toEqual({ clientKind: 'generic' });
  });

  it('recognizes Gemini CLI internal routes as a first-class downstream client kind', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1internal:generateContent',
      body: {
        model: 'gpt-4.1',
        contents: [
          {
            role: 'user',
            parts: [{ text: 'hello' }],
          },
        ],
      },
    })).toEqual({
      clientKind: 'gemini_cli',
      clientAppId: 'gemini_cli',
      clientAppName: 'Gemini CLI',
      clientConfidence: 'exact',
      contentAffinityKey: expect.stringMatching(/^content:[A-Za-z0-9_-]+$/),
    });
  });

  it('recognizes app fingerprints alongside a generic protocol family', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'x-title': 'Cherry Studio',
        'http-referer': 'https://cherry-ai.com',
      },
    })).toEqual({
      clientKind: 'generic',
      clientAppId: 'cherry_studio',
      clientAppName: 'Cherry Studio',
      clientConfidence: 'exact',
    });
  });

  it('keeps protocol family detection when an app fingerprint also matches', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/responses',
      headers: {
        originator: 'codex_cli_rs',
        'x-title': 'Cherry Studio',
        'http-referer': 'https://cherry-ai.com',
      },
    })).toEqual({
      clientKind: 'codex',
      clientAppId: 'cherry_studio',
      clientAppName: 'Cherry Studio',
      clientConfidence: 'exact',
    });
  });

  it('marks weak app-only matches as heuristic instead of upgrading protocol behavior', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'user-agent': 'CherryStudio/1.2.3',
      },
    })).toEqual({
      clientKind: 'generic',
      clientAppId: 'cherry_studio',
      clientAppName: 'Cherry Studio',
      clientConfidence: 'heuristic',
    });
  });

  it('marks OpenCode anthropic prompts as an app-level heuristic without changing protocol family', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/messages',
      body: {
        model: 'claude-sonnet-4-5',
        system: [
          {
            type: 'text',
            text: 'You are OpenCode, an interactive CLI tool that helps users with software engineering tasks. If the current working directory contains a file called OpenCode.md, it will be automatically added to your context.',
          },
        ],
      },
    })).toEqual({
      clientKind: 'generic',
      clientAppId: 'opencode',
      clientAppName: 'OpenCode',
      clientConfidence: 'heuristic',
    });
  });

  it('recognizes OpenCode anthropic prompts when system is provided as a plain string', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/messages',
      body: {
        model: 'claude-sonnet-4-5',
        system: 'You are OpenCode, an interactive CLI tool that helps users with software engineering tasks. If the current working directory contains a file called OpenCode.md, it will be automatically added to your context.',
      },
    })).toEqual({
      clientKind: 'generic',
      clientAppId: 'opencode',
      clientAppName: 'OpenCode',
      clientConfidence: 'heuristic',
    });
  });
});
