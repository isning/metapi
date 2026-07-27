import type { RuntimeCapabilityRequirement, RuntimeFeatureRequirement } from '../capabilities/requestCapabilityRequirement.js';

type GeminiRequestCapabilityClass =
  | 'text_bridge_safe'
  | 'rich_bridge_required'
  | 'gemini_native_required';

type GeminiAction = 'generateContent' | 'streamGenerateContent' | 'countTokens';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function collectPartKinds(body: Record<string, unknown>): Set<string> {
  const kinds = new Set<string>();
  const contents = Array.isArray(body.contents) ? body.contents : [];
  for (const content of contents) {
    if (!isRecord(content)) continue;
    const parts = Array.isArray(content.parts) ? content.parts : [];
    for (const part of parts) {
      if (!isRecord(part)) continue;
      for (const key of Object.keys(part)) {
        kinds.add(key);
      }
    }
  }
  return kinds;
}

function nativeRequirement(feature: string, labelI18nKey: string): RuntimeFeatureRequirement {
  return {
    feature,
    scope: 'native_protocol',
    requiredState: 'native',
    labelI18nKey,
  };
}

function classifyGeminiRequest(input: {
  body: Record<string, unknown>;
  action: GeminiAction;
}): {
  classification: GeminiRequestCapabilityClass;
  requiredFeatures: RuntimeFeatureRequirement[];
  diagnostics: RuntimeCapabilityRequirement['diagnostics'];
} {
  const requiredFeatures: RuntimeFeatureRequirement[] = [];
  const diagnostics: RuntimeCapabilityRequirement['diagnostics'] = [];
  const body = input.body;

  if (input.action === 'countTokens') {
    return {
      classification: 'gemini_native_required',
      requiredFeatures: [{
        feature: 'operation.countTokens',
        scope: 'operation',
        requiredState: 'native',
        labelI18nKey: 'routeRuntime.capabilities.operation.countTokens',
      }],
      diagnostics,
    };
  }

  const nativeFields: Array<[string, string, string]> = [
    ['cachedContent', 'native.gemini.cachedContent', 'routeRuntime.capabilities.gemini.cachedContent'],
    ['thinkingConfig', 'native.gemini.thinkingConfig', 'routeRuntime.capabilities.gemini.thinkingConfig'],
    ['thoughtSignature', 'native.gemini.thoughtSignature', 'routeRuntime.capabilities.gemini.thoughtSignature'],
    ['safetySettings', 'native.gemini.safetySettings', 'routeRuntime.capabilities.gemini.safetySettings'],
  ];
  for (const [field, feature, labelI18nKey] of nativeFields) {
    if (hasOwn(body, field)) {
      requiredFeatures.push(nativeRequirement(feature, labelI18nKey));
    }
  }

  const allowedTopLevel = new Set([
    'contents',
    'systemInstruction',
    'generationConfig',
    'tools',
    'toolConfig',
    'cachedContent',
    'safetySettings',
    'thinkingConfig',
    'thoughtSignature',
  ]);
  for (const key of Object.keys(body)) {
    if (!allowedTopLevel.has(key)) {
      requiredFeatures.push(nativeRequirement(
        `native.gemini.field.${key}`,
        'routeRuntime.capabilities.gemini.unknownField',
      ));
      diagnostics.push({
        level: 'warn',
        code: 'gemini_capability.unknown_field',
        i18nKey: 'routeRuntime.capability.gemini.unknownField',
        values: { field: key },
      });
    }
  }

  if (requiredFeatures.length > 0) {
    return {
      classification: 'gemini_native_required',
      requiredFeatures,
      diagnostics,
    };
  }

  const partKinds = collectPartKinds(body);
  const richPartKinds = [...partKinds].filter((kind) => kind !== 'text');
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  const hasToolConfig = isRecord(body.toolConfig);
  const generationConfig = isRecord(body.generationConfig) ? body.generationConfig : {};
  const hasJsonSchema = isRecord(generationConfig.responseSchema);

  if (richPartKinds.length > 0 || hasTools || hasToolConfig || hasJsonSchema) {
    const richFeatures: RuntimeFeatureRequirement[] = [];
    if (richPartKinds.some((kind) => kind === 'inlineData' || kind === 'fileData')) {
      richFeatures.push({ feature: 'input.image', scope: 'input', requiredState: 'emulated' });
    }
    if (hasTools || hasToolConfig) {
      richFeatures.push({ feature: 'input.tools', scope: 'input', requiredState: 'emulated' });
      richFeatures.push({ feature: 'output.toolCalls', scope: 'output', requiredState: 'emulated' });
    }
    if (hasJsonSchema) {
      richFeatures.push({ feature: 'input.jsonSchema', scope: 'input', requiredState: 'emulated' });
    }
    return {
      classification: 'rich_bridge_required',
      requiredFeatures: [],
      diagnostics: [
        ...diagnostics,
        ...richFeatures.map((feature) => ({
          level: 'info' as const,
          code: 'gemini_capability.rich_bridge_feature',
          i18nKey: feature.labelI18nKey || `routeRuntime.capabilities.${feature.feature}`,
          values: { feature: feature.feature },
        })),
      ],
    };
  }

  return {
    classification: 'text_bridge_safe',
    requiredFeatures: [],
    diagnostics,
  };
}

export function analyzeGeminiRuntimeCapability(input: {
  normalizedBody: Record<string, unknown>;
  action: GeminiAction;
}): RuntimeCapabilityRequirement {
  const analyzed = classifyGeminiRequest({
    body: input.normalizedBody,
    action: input.action,
  });
  const isNative = analyzed.classification === 'gemini_native_required';
  const isRich = analyzed.classification === 'rich_bridge_required';
  return {
    sourceFormat: 'gemini',
    surface: input.action,
    acceptableApiTypes: isNative
      ? ['gemini_generate_content', 'vendor_native']
      : isRich
      ? [
        'openai_responses',
        'anthropic_messages',
        'newapi_responses',
        'gemini_generate_content',
        'vendor_native',
      ]
      : [
        'openai_chat_completions',
        'openai_responses',
        'anthropic_messages',
        'newapi_chat_completions',
        'newapi_responses',
        'gemini_generate_content',
        'vendor_native',
      ],
    requiredFeatures: analyzed.requiredFeatures,
    optionalFeatures: [],
    lossPolicy: isNative || isRich ? 'lossless_required' : 'lossy_allowed',
    fallbackPolicy: isNative ? 'single_native_variant' : 'compatible_variants_only',
    diagnostics: analyzed.diagnostics,
  };
}
