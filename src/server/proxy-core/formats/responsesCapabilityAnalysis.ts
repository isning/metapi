import type {
  RuntimeCapabilityRequirement,
  RuntimeFeatureRequirement,
} from '../capabilities/requestCapabilityRequirement.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nativeRequirement(feature: string): RuntimeFeatureRequirement {
  return {
    feature,
    scope: 'native_protocol',
    requiredState: 'native',
    labelI18nKey: 'routeRuntime.capabilities.responses.native',
  };
}

const BRIDGE_SAFE_TOP_LEVEL_FIELDS = new Set([
  'model',
  'input',
  'instructions',
  'stream',
  'temperature',
  'top_p',
  'max_output_tokens',
  'metadata',
  'modalities',
  'audio',
  'parallel_tool_calls',
  'tools',
  'tool_choice',
  'user',
  'text',
]);

const BRIDGE_SAFE_INPUT_ITEM_TYPES = new Set([
  'message',
  'function_call',
  'function_call_output',
]);

function collectNativeFeatures(body: Record<string, unknown>): RuntimeFeatureRequirement[] {
  const features: RuntimeFeatureRequirement[] = [];
  const seen = new Set<string>();
  const add = (feature: string) => {
    if (seen.has(feature)) return;
    seen.add(feature);
    features.push(nativeRequirement(feature));
  };

  for (const key of Object.keys(body)) {
    if (!BRIDGE_SAFE_TOP_LEVEL_FIELDS.has(key)) add(`native.responses.field.${key}`);
  }

  const tools = Array.isArray(body.tools) ? body.tools : [];
  for (const tool of tools) {
    if (!isRecord(tool)) {
      add('native.responses.tool.invalid');
      continue;
    }
    const type = asTrimmedString(tool.type).toLowerCase();
    if (type !== 'function') add(`native.responses.tool.${type || 'unknown'}`);
  }

  const input = Array.isArray(body.input) ? body.input : [body.input];
  for (const item of input) {
    if (!isRecord(item)) continue;
    const type = asTrimmedString(item.type).toLowerCase();
    if (type && !BRIDGE_SAFE_INPUT_ITEM_TYPES.has(type)) {
      add(`native.responses.input_item.${type}`);
    }
  }

  return features;
}

export function analyzeResponsesRuntimeCapability(
  normalizedBody: Record<string, unknown>,
): RuntimeCapabilityRequirement | undefined {
  const nativeFeatures = collectNativeFeatures(normalizedBody);
  if (nativeFeatures.length === 0) return undefined;

  return {
    sourceFormat: 'responses',
    surface: 'create',
    acceptableApiTypes: ['openai_responses', 'newapi_responses'],
    // The configured Responses API type is the capability contract here. An
    // endpoint cannot advertise every future Responses extension in advance,
    // but it must never be replaced with a lossy protocol bridge.
    requiredFeatures: [],
    optionalFeatures: [],
    lossPolicy: 'native_required',
    fallbackPolicy: 'single_native_variant',
    diagnostics: nativeFeatures.map((feature) => ({
      level: 'info' as const,
      code: 'responses_capability.native_required',
      i18nKey: feature.labelI18nKey || 'routeRuntime.capabilities.responses.native',
      values: { feature: feature.feature },
    })),
  };
}
