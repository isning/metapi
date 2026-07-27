import { describe, expect, it } from 'vitest';
import { DEFAULT_API_VARIANT_CAPABILITY } from '../apiVariants.js';
import { matchApiVariantCapability } from './apiVariantCapabilityMatcher.js';
import type { RuntimeCapabilityRequirement } from './requestCapabilityRequirement.js';

const textRequirement: RuntimeCapabilityRequirement = {
  sourceFormat: 'test',
  surface: 'generate',
  acceptableApiTypes: ['openai_chat_completions'],
  requiredFeatures: [
    { feature: 'input.text', scope: 'input', requiredState: 'supported' },
  ],
  lossPolicy: 'lossy_allowed',
  fallbackPolicy: 'compatible_variants_only',
};

describe('apiVariantCapabilityMatcher', () => {
  it('accepts a variant that satisfies generic feature requirements', () => {
    const result = matchApiVariantCapability({
      requirement: textRequirement,
      apiType: 'openai_chat_completions',
      bindingSupport: 'supported',
      capability: {
        ...DEFAULT_API_VARIANT_CAPABILITY,
        input: {
          ...DEFAULT_API_VARIANT_CAPABILITY.input,
          text: 'emulated',
        },
      },
    });

    expect(result.ok).toBe(true);
  });

  it('filters unacceptable API types before feature matching', () => {
    const result = matchApiVariantCapability({
      requirement: textRequirement,
      apiType: 'openai_responses',
      bindingSupport: 'supported',
      capability: DEFAULT_API_VARIANT_CAPABILITY,
    });

    expect(result.ok).toBe(false);
    expect(result.filteredReasonCode).toBe('runtime_capability.api_type_unacceptable');
  });

  it('does not let unknown bindings satisfy lossless requirements', () => {
    const requirement: RuntimeCapabilityRequirement = {
      ...textRequirement,
      lossPolicy: 'lossless_required',
    };

    const result = matchApiVariantCapability({
      requirement,
      apiType: 'openai_chat_completions',
      bindingSupport: 'unknown',
      allowUnknownBindingProbe: true,
      capability: {
        ...DEFAULT_API_VARIANT_CAPABILITY,
        input: {
          ...DEFAULT_API_VARIANT_CAPABILITY.input,
          text: 'native',
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.filteredReasonCode).toBe('runtime_capability.binding_unknown');
  });

  it('matches opaque operation and native protocol capability keys without interpreting them', () => {
    const requirement: RuntimeCapabilityRequirement = {
      sourceFormat: 'test',
      surface: 'native-op',
      acceptableApiTypes: ['vendor_native'],
      requiredFeatures: [
        { feature: 'operation.customNativeCall', scope: 'operation', requiredState: 'native' },
        { feature: 'native.vendor.someFeature', scope: 'native_protocol', requiredState: 'native' },
      ],
      lossPolicy: 'native_required',
      fallbackPolicy: 'single_native_variant',
    };

    const result = matchApiVariantCapability({
      requirement,
      apiType: 'vendor_native',
      bindingSupport: 'supported',
      capability: {
        ...DEFAULT_API_VARIANT_CAPABILITY,
        operations: {
          'operation.customNativeCall': 'native',
        },
        nativeProtocols: {
          'native.vendor.someFeature': 'native',
        },
      },
    });

    expect(result.ok).toBe(true);
  });
});
