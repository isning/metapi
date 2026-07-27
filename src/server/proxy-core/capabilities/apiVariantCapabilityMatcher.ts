import type {
  ApiType,
  ApiVariantCapability,
  ApiVariantCapabilityState,
  ApiVariantSupportState,
} from '../apiVariants.js';
import type {
  CapabilityDiagnostic,
  RuntimeCapabilityFeatureScope,
  RuntimeCapabilityRequirement,
  RuntimeFeatureRequirement,
} from './requestCapabilityRequirement.js';

function stateSatisfies(
  actual: ApiVariantCapabilityState | undefined,
  required: RuntimeFeatureRequirement['requiredState'] | undefined,
): boolean {
  const normalizedRequired = required || 'supported';
  if (normalizedRequired === 'native') return actual === 'native';
  if (normalizedRequired === 'emulated') return actual === 'native' || actual === 'emulated';
  if (normalizedRequired === 'supported') return actual === 'native' || actual === 'emulated';
  return false;
}

function readFeatureState(
  capability: ApiVariantCapability,
  feature: RuntimeFeatureRequirement,
): ApiVariantCapabilityState | undefined {
  const key = feature.feature;
  if (feature.scope === 'input') {
    const inputKey = key.startsWith('input.') ? key.slice('input.'.length) : key;
    return capability.input[inputKey as keyof ApiVariantCapability['input']];
  }
  if (feature.scope === 'output') {
    const outputKey = key.startsWith('output.') ? key.slice('output.'.length) : key;
    return capability.output[outputKey as keyof ApiVariantCapability['output']];
  }
  if (feature.scope === 'operation') return capability.operations?.[key];
  if (feature.scope === 'native_protocol') return capability.nativeProtocols?.[key];
  if (feature.scope === 'transport') return capability.transport?.[key];
  return undefined;
}

function diagnosticForMissingFeature(
  feature: RuntimeFeatureRequirement,
  apiType: ApiType,
): CapabilityDiagnostic {
  return {
    level: 'warn',
    code: 'runtime_capability.feature_missing',
    i18nKey: 'routeRuntime.capability.filtered.featureMissing',
    values: {
      feature: feature.feature,
      scope: feature.scope,
      apiType,
    },
  };
}

function bindingDiagnostic(
  code: string,
  apiType: ApiType,
  support: ApiVariantSupportState,
): CapabilityDiagnostic {
  return {
    level: support === 'unknown' ? 'info' : 'warn',
    code,
    i18nKey: `routeRuntime.capability.filtered.${code}`,
    values: {
      apiType,
      support,
    },
  };
}

export function matchApiVariantCapability(input: {
  requirement: RuntimeCapabilityRequirement | null | undefined;
  apiType: ApiType;
  capability: ApiVariantCapability;
  bindingSupport: ApiVariantSupportState;
  allowUnknownBindingProbe?: boolean;
}): {
  ok: boolean;
  filteredReasonCode?: string;
  diagnostics: CapabilityDiagnostic[];
} {
  const requirement = input.requirement;
  if (!requirement) {
    return { ok: true, diagnostics: [] };
  }

  if (!requirement.acceptableApiTypes.includes(input.apiType)) {
    return {
      ok: false,
      filteredReasonCode: 'runtime_capability.api_type_unacceptable',
      diagnostics: [{
        level: 'warn',
        code: 'runtime_capability.api_type_unacceptable',
        i18nKey: 'routeRuntime.capability.filtered.apiTypeUnacceptable',
        values: { apiType: input.apiType },
      }],
    };
  }

  if (input.bindingSupport === 'unsupported' || input.bindingSupport === 'blocked') {
    return {
      ok: false,
      filteredReasonCode: 'runtime_capability.binding_not_supported',
      diagnostics: [bindingDiagnostic('binding_not_supported', input.apiType, input.bindingSupport)],
    };
  }

  if (
    input.bindingSupport === 'unknown'
    && (
      requirement.lossPolicy === 'native_required'
      || requirement.lossPolicy === 'lossless_required'
      || input.allowUnknownBindingProbe !== true
    )
  ) {
    return {
      ok: false,
      filteredReasonCode: 'runtime_capability.binding_unknown',
      diagnostics: [bindingDiagnostic('binding_unknown', input.apiType, input.bindingSupport)],
    };
  }

  if (input.capability.status === 'unsupported') {
    return {
      ok: false,
      filteredReasonCode: 'runtime_capability.variant_unsupported',
      diagnostics: [{
        level: 'warn',
        code: 'runtime_capability.variant_unsupported',
        i18nKey: 'routeRuntime.capability.filtered.variantUnsupported',
        values: { apiType: input.apiType },
      }],
    };
  }

  const diagnostics: CapabilityDiagnostic[] = [];
  for (const feature of requirement.requiredFeatures) {
    const actual = readFeatureState(input.capability, feature);
    if (!stateSatisfies(actual, feature.requiredState)) {
      diagnostics.push(diagnosticForMissingFeature(feature, input.apiType));
    }
  }

  if (diagnostics.length > 0) {
    return {
      ok: false,
      filteredReasonCode: 'runtime_capability.feature_missing',
      diagnostics,
    };
  }

  return { ok: true, diagnostics: [] };
}

export function runtimeFeatureScopes(): RuntimeCapabilityFeatureScope[] {
  return ['input', 'output', 'transport', 'operation', 'native_protocol'];
}
