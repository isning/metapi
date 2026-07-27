export {
  buildMinimalJsonHeadersForCompatibility,
  hasEndpointMismatchHint,
  inferRequiredEndpointFromProtocolError,
  inferSuggestedEndpointFromUpstreamError,
  isEndpointDispatchDeniedError,
  isEndpointDowngradeError,
  isUnsupportedMediaTypeError,
  promoteRequiredEndpointCandidateAfterProtocolError,
  promoteResponsesCandidateAfterLegacyChatError,
  shouldPreferResponsesAfterLegacyChatError,
  type CompatibilityEndpoint,
  type CompatibilityEndpointPreference,
} from '../../protocol/endpointCompatibility.js';
