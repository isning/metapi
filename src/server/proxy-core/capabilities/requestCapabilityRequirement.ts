import type {
  ApiType,
  ApiVariantCapabilityState,
} from '../apiVariants.js';

export type RuntimeCapabilityLossPolicy =
  | 'lossless_required'
  | 'lossy_allowed'
  | 'native_required';

export type RuntimeCapabilityFallbackPolicy =
  | 'compatible_variants_only'
  | 'single_native_variant';

export type RuntimeCapabilityFeatureScope =
  | 'input'
  | 'output'
  | 'transport'
  | 'operation'
  | 'native_protocol';

export type CapabilityDiagnostic = {
  level: 'info' | 'warn' | 'error';
  code: string;
  i18nKey: string;
  values?: Record<string, string | number | boolean | null>;
};

export type RuntimeFeatureRequirement = {
  feature: string;
  scope: RuntimeCapabilityFeatureScope;
  requiredState?: Exclude<ApiVariantCapabilityState, 'unsupported' | 'unknown'> | 'supported';
  labelI18nKey?: string;
};

export type RuntimeCapabilityRequirement = {
  sourceFormat: string;
  surface: string;
  acceptableApiTypes: ApiType[];
  requiredFeatures: RuntimeFeatureRequirement[];
  optionalFeatures?: RuntimeFeatureRequirement[];
  lossPolicy: RuntimeCapabilityLossPolicy;
  fallbackPolicy: RuntimeCapabilityFallbackPolicy;
  diagnostics?: CapabilityDiagnostic[];
};

export function runtimeCapabilityRequiresSingleNativeVariant(
  requirement: RuntimeCapabilityRequirement | null | undefined,
): boolean {
  return requirement?.fallbackPolicy === 'single_native_variant'
    || requirement?.lossPolicy === 'native_required';
}
