import { describe, expect, it } from 'vitest';
import { analyzeGeminiRuntimeCapability } from './geminiCapabilityAnalysis.js';

describe('geminiCapabilityAnalysis', () => {
  it('allows simple text generateContent requests to use bridge-compatible API types', () => {
    const requirement = analyzeGeminiRuntimeCapability({
      action: 'generateContent',
      normalizedBody: {
        contents: [
          { role: 'user', parts: [{ text: 'hello' }] },
        ],
      },
    });

    expect(requirement.lossPolicy).toBe('lossy_allowed');
    expect(requirement.fallbackPolicy).toBe('compatible_variants_only');
    expect(requirement.acceptableApiTypes).toContain('openai_chat_completions');
    expect(requirement.acceptableApiTypes).toContain('openai_responses');
    expect(requirement.acceptableApiTypes).toContain('anthropic_messages');
    expect(requirement.requiredFeatures).toEqual([]);
  });

  it('requires native capability for cachedContent', () => {
    const requirement = analyzeGeminiRuntimeCapability({
      action: 'generateContent',
      normalizedBody: {
        cachedContent: 'cachedContents/abc',
        contents: [
          { role: 'user', parts: [{ text: 'hello' }] },
        ],
      },
    });

    expect(requirement.lossPolicy).toBe('lossless_required');
    expect(requirement.fallbackPolicy).toBe('single_native_variant');
    expect(requirement.acceptableApiTypes).toEqual(['gemini_generate_content', 'vendor_native']);
    expect(requirement.requiredFeatures).toContainEqual({
      feature: 'native.gemini.cachedContent',
      scope: 'native_protocol',
      requiredState: 'native',
      labelI18nKey: 'routeRuntime.capabilities.gemini.cachedContent',
    });
  });

  it('requires countTokens operation support for countTokens requests', () => {
    const requirement = analyzeGeminiRuntimeCapability({
      action: 'countTokens',
      normalizedBody: {
        contents: [
          { role: 'user', parts: [{ text: 'hello' }] },
        ],
      },
    });

    expect(requirement.acceptableApiTypes).toEqual(['gemini_generate_content', 'vendor_native']);
    expect(requirement.requiredFeatures).toContainEqual({
      feature: 'operation.countTokens',
      scope: 'operation',
      requiredState: 'native',
      labelI18nKey: 'routeRuntime.capabilities.operation.countTokens',
    });
  });

  it('treats unknown Gemini top-level fields as native-required', () => {
    const requirement = analyzeGeminiRuntimeCapability({
      action: 'generateContent',
      normalizedBody: {
        contents: [
          { role: 'user', parts: [{ text: 'hello' }] },
        ],
        futureOnlyField: true,
      },
    });

    expect(requirement.fallbackPolicy).toBe('single_native_variant');
    expect(requirement.requiredFeatures[0]).toMatchObject({
      feature: 'native.gemini.field.futureOnlyField',
      scope: 'native_protocol',
      requiredState: 'native',
    });
  });
});
