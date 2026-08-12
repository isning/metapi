import { randomUUID } from 'node:crypto';
import { sqliteTable, text, integer, real, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const sites = sqliteTable('sites', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  externalCheckinUrl: text('external_checkin_url'),
  platform: text('platform').notNull(), // 'new-api' | 'one-api' | 'veloera' | 'one-hub' | 'done-hub' | 'sub2api' | 'openai' | 'claude' | 'gemini' | 'codex' | 'gemini-cli' | 'antigravity'
  proxyUrl: text('proxy_url'),
  useSystemProxy: integer('use_system_proxy', { mode: 'boolean' }).default(false),
  customHeaders: text('custom_headers'),
  compatibilityPolicy: text('compatibility_policy'),
  status: text('status').notNull().default('active'), // 'active' | 'disabled'
  isPinned: integer('is_pinned', { mode: 'boolean' }).default(false),
  sortOrder: integer('sort_order').default(0),
  globalWeight: real('global_weight').default(1),
  apiKey: text('api_key'),
  postRefreshProbeEnabled: integer('post_refresh_probe_enabled', { mode: 'boolean' }).default(false),
  postRefreshProbeModel: text('post_refresh_probe_model').default(''),
  postRefreshProbeScope: text('post_refresh_probe_scope').default('single'),
  postRefreshProbeLatencyThresholdMs: integer('post_refresh_probe_latency_threshold_ms').default(0),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  statusIdx: index('sites_status_idx').on(table.status),
  platformUrlUnique: uniqueIndex('sites_platform_url_unique').on(table.platform, table.url),
}));

export const siteApiEndpoints = sqliteTable('site_api_endpoints', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  basePathMode: text('base_path_mode').notNull().default('protocol_default'),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  sortOrder: integer('sort_order').default(0),
  cooldownUntil: text('cooldown_until'),
  lastSelectedAt: text('last_selected_at'),
  lastFailedAt: text('last_failed_at'),
  lastFailureReason: text('last_failure_reason'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  siteUrlUnique: uniqueIndex('site_api_endpoints_site_url_unique').on(table.siteId, table.url),
  siteEnabledSortIdx: index('site_api_endpoints_site_enabled_sort_idx').on(table.siteId, table.enabled, table.sortOrder),
  siteCooldownIdx: index('site_api_endpoints_site_cooldown_idx').on(table.siteId, table.cooldownUntil),
}));

export const modelCatalogSources = sqliteTable('model_catalog_sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  sourceKey: text('source_key').notNull(),
  label: text('label').notNull(),
  discoveryMethod: text('discovery_method').notNull().default('GET'),
  discoveryUrl: text('discovery_url'),
  parser: text('parser').notNull().default('openai_models'),
  credentialScope: text('credential_scope').notNull().default('credential'),
  refreshPolicyJson: text('refresh_policy_json'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  metadataJson: text('metadata_json'),
  lastRefreshAt: text('last_refresh_at'),
  lastModelCount: integer('last_model_count').default(0),
  lastError: text('last_error'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  siteSourceKeyUnique: uniqueIndex('model_catalog_sources_site_source_key_unique').on(table.siteId, table.sourceKey),
  siteEnabledIdx: index('model_catalog_sources_site_enabled_idx').on(table.siteId, table.enabled),
}));

export const apiEndpointProfiles = sqliteTable('api_endpoint_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  profileKey: text('profile_key').notNull(),
  apiType: text('api_type').notNull(),
  label: text('label').notNull(),
  requestMethod: text('request_method').notNull().default('POST'),
  requestUrl: text('request_url'),
  defaultHeadersJson: text('default_headers_json'),
  modelCatalogSourceId: integer('model_catalog_source_id').references(() => modelCatalogSources.id, { onDelete: 'set null' }),
  authMode: text('auth_mode').notNull().default('bearer'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  priority: integer('priority').default(0),
  capabilityDefaultsJson: text('capability_defaults_json'),
  compatibilityPolicyRef: text('compatibility_policy_ref'),
  metadataJson: text('metadata_json'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  siteProfileKeyUnique: uniqueIndex('api_endpoint_profiles_site_profile_key_unique').on(table.siteId, table.profileKey),
  siteApiTypeIdx: index('api_endpoint_profiles_site_api_type_idx').on(table.siteId, table.apiType, table.enabled),
}));

export const endpointModelObservations = sqliteTable('endpoint_model_observations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  credentialKey: text('credential_key').notNull(),
  apiEndpointProfileId: integer('api_endpoint_profile_id').notNull().references(() => apiEndpointProfiles.id, { onDelete: 'cascade' }),
  modelName: text('model_name').notNull(),
  status: text('status').notNull(),
  failureClass: text('failure_class'),
  source: text('source').notNull().default('runtime'),
  observedAt: text('observed_at').default(sql`(datetime('now'))`),
  expiresAt: text('expires_at'),
  metadataJson: text('metadata_json'),
}, (table) => ({
  credentialProfileModelUnique: uniqueIndex('endpoint_model_observations_credential_profile_model_unique').on(table.siteId, table.credentialKey, table.apiEndpointProfileId, table.modelName),
  siteModelIdx: index('endpoint_model_observations_site_model_idx').on(table.siteId, table.modelName),
  profileStatusIdx: index('endpoint_model_observations_profile_status_idx').on(table.apiEndpointProfileId, table.status),
}));

export const siteDisabledModels = sqliteTable('site_disabled_models', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  modelName: text('model_name').notNull(),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
}, (table) => ({
  siteModelUnique: uniqueIndex('site_disabled_models_site_model_unique').on(table.siteId, table.modelName),
  siteIdIdx: index('site_disabled_models_site_id_idx').on(table.siteId),
}));

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  username: text('username'),
  accessToken: text('access_token').notNull(),
  apiToken: text('api_token'),
  balance: real('balance').default(0),
  balanceUsed: real('balance_used').default(0),
  quota: real('quota').default(0),
  unitCost: real('unit_cost'),
  valueScore: real('value_score').default(0),
  status: text('status').default('active'), // 'active' | 'disabled' | 'expired'
  isPinned: integer('is_pinned', { mode: 'boolean' }).default(false),
  sortOrder: integer('sort_order').default(0),
  checkinEnabled: integer('checkin_enabled', { mode: 'boolean' }).default(true),
  lastCheckinAt: text('last_checkin_at'),
  lastBalanceRefresh: text('last_balance_refresh'),
  oauthProvider: text('oauth_provider'),
  oauthAccountKey: text('oauth_account_key'),
  oauthProjectId: text('oauth_project_id'),
  extraConfig: text('extra_config'), // JSON string
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  siteIdIdx: index('accounts_site_id_idx').on(table.siteId),
  statusIdx: index('accounts_status_idx').on(table.status),
  siteStatusIdx: index('accounts_site_status_idx').on(table.siteId, table.status),
  oauthProviderIdx: index('accounts_oauth_provider_idx').on(table.oauthProvider),
  oauthIdentityIdx: index('accounts_oauth_identity_idx').on(table.oauthProvider, table.oauthAccountKey, table.oauthProjectId),
}));

export const accountTokens = sqliteTable('account_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  token: text('token').notNull(),
  tokenGroup: text('token_group'),
  compatibilityPolicy: text('compatibility_policy'),
  valueStatus: text('value_status').notNull().default('ready'),
  source: text('source').default('manual'), // 'manual' | 'sync' | 'migration'
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  isDefault: integer('is_default', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  accountIdIdx: index('account_tokens_account_id_idx').on(table.accountId),
  accountEnabledIdx: index('account_tokens_account_enabled_idx').on(table.accountId, table.enabled),
  enabledIdx: index('account_tokens_enabled_idx').on(table.enabled),
}));

export const credentialEndpointBindings = sqliteTable('credential_endpoint_bindings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  accountId: integer('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  tokenId: integer('token_id').references(() => accountTokens.id, { onDelete: 'cascade' }),
  credentialKey: text('credential_key').notNull(),
  credentialKind: text('credential_kind').notNull(),
  apiEndpointProfileId: integer('api_endpoint_profile_id').notNull().references(() => apiEndpointProfiles.id, { onDelete: 'cascade' }),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  support: text('support').notNull().default('supported'),
  source: text('source').notNull().default('manual'),
  priority: integer('priority').default(0),
  capabilityOverrideJson: text('capability_override_json'),
  compatibilityPolicyRef: text('compatibility_policy_ref'),
  pricingPolicyRef: text('pricing_policy_ref'),
  measuredPricingRef: text('measured_pricing_ref'),
  metadataJson: text('metadata_json'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  credentialProfileUnique: uniqueIndex('credential_endpoint_bindings_credential_profile_unique').on(table.siteId, table.credentialKey, table.apiEndpointProfileId),
  siteCredentialIdx: index('credential_endpoint_bindings_site_credential_idx').on(table.siteId, table.credentialKey),
  accountIdx: index('credential_endpoint_bindings_account_idx').on(table.accountId),
  tokenIdx: index('credential_endpoint_bindings_token_idx').on(table.tokenId),
  profileIdx: index('credential_endpoint_bindings_profile_idx').on(table.apiEndpointProfileId),
}));

export const checkinLogs = sqliteTable('checkin_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  status: text('status').notNull(), // 'success' | 'failed' | 'skipped'
  message: text('message'),
  reward: text('reward'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
}, (table) => ({
  accountCreatedIdx: index('checkin_logs_account_created_at_idx').on(table.accountId, table.createdAt),
  createdAtIdx: index('checkin_logs_created_at_idx').on(table.createdAt),
  statusIdx: index('checkin_logs_status_idx').on(table.status),
}));

export const modelAvailability = sqliteTable('model_availability', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  modelName: text('model_name').notNull(),
  available: integer('available', { mode: 'boolean' }),
  isManual: integer('is_manual', { mode: 'boolean' }).default(false),
  latencyMs: integer('latency_ms'),
  checkedAt: text('checked_at').default(sql`(datetime('now'))`),
}, (table) => ({
  accountModelUnique: uniqueIndex('model_availability_account_model_unique').on(table.accountId, table.modelName),
  accountAvailableIdx: index('model_availability_account_available_idx').on(table.accountId, table.available),
  modelNameIdx: index('model_availability_model_name_idx').on(table.modelName),
}));

export const tokenModelAvailability = sqliteTable('token_model_availability', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tokenId: integer('token_id').notNull().references(() => accountTokens.id, { onDelete: 'cascade' }),
  modelName: text('model_name').notNull(),
  available: integer('available', { mode: 'boolean' }),
  latencyMs: integer('latency_ms'),
  checkedAt: text('checked_at').default(sql`(datetime('now'))`),
}, (table) => ({
  tokenModelUnique: uniqueIndex('token_model_availability_token_model_unique').on(table.tokenId, table.modelName),
  tokenAvailableIdx: index('token_model_availability_token_available_idx').on(table.tokenId, table.available),
  modelNameIdx: index('token_model_availability_model_name_idx').on(table.modelName),
  availableIdx: index('token_model_availability_available_idx').on(table.available),
}));

export const upstreamModelCostPricings = sqliteTable('upstream_model_cost_pricings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scope: text('scope').notNull(), // 'site_model' | 'account_model' | 'token_model' | 'token_model_group'
  scopeKey: text('scope_key').notNull(),
  siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  accountId: integer('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  tokenId: integer('token_id').references(() => accountTokens.id, { onDelete: 'cascade' }),
  tokenGroup: text('token_group'),
  modelName: text('model_name').notNull(),
  normalizedModelName: text('normalized_model_name').notNull(),
  displayName: text('display_name'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  planJson: text('plan_json').notNull(),
  planFingerprint: text('plan_fingerprint').notNull(),
  sourceType: text('source_type').notNull().default('user'),
  metadataJson: text('metadata_json'),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  siteModelIdx: index('upstream_model_cost_pricings_site_model_idx').on(table.siteId, table.normalizedModelName, table.enabled),
  accountModelIdx: index('upstream_model_cost_pricings_account_model_idx').on(table.accountId, table.normalizedModelName, table.enabled),
  tokenModelIdx: index('upstream_model_cost_pricings_token_model_idx').on(table.tokenId, table.normalizedModelName, table.enabled),
  tokenGroupModelIdx: index('upstream_model_cost_pricings_token_group_model_idx').on(table.tokenId, table.tokenGroup, table.normalizedModelName, table.enabled),
  scopeKeyUnique: uniqueIndex('upstream_model_cost_pricings_scope_key_unique').on(table.scopeKey),
}));

export const providerPricingCatalogCaches = sqliteTable('provider_pricing_catalog_caches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scopeKey: text('scope_key').notNull(),
  siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  accountId: integer('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  credentialKind: text('credential_kind'),
  catalogJson: text('catalog_json'),
  modelCount: integer('model_count').notNull().default(0),
  groupCount: integer('group_count').notNull().default(0),
  catalogFingerprint: text('catalog_fingerprint'),
  lastStatus: text('last_status').notNull().default('success'), // 'success' | 'error'
  lastError: text('last_error'),
  diagnosticsJson: text('diagnostics_json'),
  fetchedAt: text('fetched_at').notNull().default(sql`(datetime('now'))`),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  scopeKeyUnique: uniqueIndex('provider_pricing_catalog_caches_scope_key_unique').on(table.scopeKey),
  siteAccountIdx: index('provider_pricing_catalog_caches_site_account_idx').on(table.siteId, table.accountId),
  expiryIdx: index('provider_pricing_catalog_caches_expiry_idx').on(table.expiresAt),
  statusIdx: index('provider_pricing_catalog_caches_status_idx').on(table.lastStatus),
}));

export const walletAcquisitionProfiles = sqliteTable('wallet_acquisition_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scope: text('scope').notNull(), // 'site' | 'account' | 'token'
  scopeKey: text('scope_key').notNull(),
  siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  accountId: integer('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  tokenId: integer('token_id').references(() => accountTokens.id, { onDelete: 'cascade' }),
  inheritance: text('inheritance').notNull().default('inherit'), // 'inherit' | 'override' | 'disabled'
  walletUnit: text('wallet_unit').notNull().default('USD'),
  faceValuePrice: real('face_value_price'),
  rechargeDiscount: real('recharge_discount').notNull().default(1),
  dailyEarnedBalance: real('daily_earned_balance'),
  dailyEarnedBalanceSource: text('daily_earned_balance_source').notNull().default('observed_checkin'),
  observedWindowDays: integer('observed_window_days'),
  confidence: text('confidence').notNull().default('incomplete'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  scopeKeyUnique: uniqueIndex('wallet_acquisition_profiles_scope_key_unique').on(table.scopeKey),
  siteScopeIdx: index('wallet_acquisition_profiles_site_scope_idx').on(table.siteId, table.scope, table.enabled),
  accountIdx: index('wallet_acquisition_profiles_account_idx').on(table.accountId, table.enabled),
  tokenIdx: index('wallet_acquisition_profiles_token_idx').on(table.tokenId, table.enabled),
}));

export const fxRateSnapshots = sqliteTable('fx_rate_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fromCurrency: text('from_currency').notNull(),
  toCurrency: text('to_currency').notNull(),
  rate: real('rate').notNull(),
  source: text('source').notNull().default('manual'), // 'manual' | 'provider' | 'system_default'
  capturedAt: text('captured_at').notNull().default(sql`(datetime('now'))`),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  currencyCapturedIdx: index('fx_rate_snapshots_currency_captured_idx').on(table.fromCurrency, table.toCurrency, table.capturedAt),
  currencySourceIdx: index('fx_rate_snapshots_currency_source_idx').on(table.fromCurrency, table.toCurrency, table.source),
}));

export const routeGraphVersions = sqliteTable('route_graph_versions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  version: integer('version').notNull(),
  sourceGraphJson: text('source_graph_json').notNull(),
  status: text('status').notNull().default('archived'),
  createdBy: text('created_by').default('system'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  activatedAt: text('activated_at'),
}, (table) => ({
  versionUnique: uniqueIndex('route_graph_versions_version_unique').on(table.version),
  statusIdx: index('route_graph_versions_status_idx').on(table.status),
}));

export const routeGraphDrafts = sqliteTable('route_graph_drafts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  baseVersion: integer('base_version').references(() => routeGraphVersions.id, { onDelete: 'set null' }),
  revision: integer('revision').notNull().default(0),
  workingGraphJson: text('working_graph_json').notNull(),
  status: text('status').notNull().default('active'),
  diagnosticsJson: text('diagnostics_json'),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  statusIdx: index('route_graph_drafts_status_idx').on(table.status),
}));

/**
 * Authoritative edit batches for the active source-graph draft.  The graph
 * itself remains the editable truth; batches only provide guarded replay and
 * undo, never an alternative projection of the graph.
 */
export const routeGraphWorkspaceOperationBatches = sqliteTable('route_graph_workspace_operation_batches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  draftId: integer('draft_id').notNull().references(() => routeGraphDrafts.id, { onDelete: 'cascade' }),
  sourceRevision: integer('source_revision').notNull(),
  resultRevision: integer('result_revision').notNull(),
  forwardOperationsJson: text('forward_operations_json').notNull(),
  inverseOperationsJson: text('inverse_operations_json').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  draftRevisionIdx: index('route_graph_workspace_operation_batches_draft_revision_idx').on(table.draftId, table.resultRevision),
}));

export const routeGraphActiveVersion = sqliteTable('route_graph_active_version', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  versionId: integer('version_id').notNull().references(() => routeGraphVersions.id, { onDelete: 'cascade' }),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  singletonUnique: uniqueIndex('route_graph_active_version_singleton_unique').on(table.id),
}));

export const compiledRuntimeArtifacts = sqliteTable('compiled_runtime_artifacts', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  artifactJson: text('artifact_json').notNull(),
  bundleHash: text('bundle_hash').notNull(),
  sourceGraphVersionId: integer('source_graph_version_id').references(() => routeGraphVersions.id, { onDelete: 'set null' }),
  sourceGraphHash: text('source_graph_hash'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  bundleHashIdx: index('compiled_runtime_artifacts_bundle_hash_idx').on(table.bundleHash),
  sourceGraphVersionUnique: uniqueIndex('compiled_runtime_artifacts_source_graph_version_unique').on(table.sourceGraphVersionId),
}));

export const compiledRuntimeActiveArtifact = sqliteTable('compiled_runtime_active_artifact', {
  id: integer('id').primaryKey(),
  artifactId: text('artifact_id').notNull().references(() => compiledRuntimeArtifacts.id, { onDelete: 'cascade' }),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  singletonUnique: uniqueIndex('compiled_runtime_active_artifact_singleton_unique').on(table.id),
}));

export const oauthRouteUnits = sqliteTable('oauth_route_units', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  name: text('name').notNull(),
  strategy: text('strategy').notNull().default('round_robin'),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  siteProviderIdx: index('oauth_route_units_site_provider_idx').on(table.siteId, table.provider),
  enabledIdx: index('oauth_route_units_enabled_idx').on(table.enabled),
}));

export const oauthRouteUnitMembers = sqliteTable('oauth_route_unit_members', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  unitId: integer('unit_id').notNull().references(() => oauthRouteUnits.id, { onDelete: 'cascade' }),
  accountId: integer('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').default(0),
  successCount: integer('success_count').default(0),
  failCount: integer('fail_count').default(0),
  totalLatencyMs: integer('total_latency_ms').default(0),
  totalCost: real('total_cost').default(0),
  lastUsedAt: text('last_used_at'),
  lastSelectedAt: text('last_selected_at'),
  lastFailAt: text('last_fail_at'),
  consecutiveFailCount: integer('consecutive_fail_count').notNull().default(0),
  cooldownLevel: integer('cooldown_level').notNull().default(0),
  cooldownUntil: text('cooldown_until'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  unitAccountUnique: uniqueIndex('oauth_route_unit_members_unit_account_unique').on(table.unitId, table.accountId),
  accountUnique: uniqueIndex('oauth_route_unit_members_account_unique').on(table.accountId),
  unitSortIdx: index('oauth_route_unit_members_unit_sort_idx').on(table.unitId, table.sortOrder),
  unitCooldownIdx: index('oauth_route_unit_members_unit_cooldown_idx').on(table.unitId, table.cooldownUntil),
}));

export const runtimeExecutionTargets = sqliteTable('runtime_execution_targets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceRef: text('source_ref').notNull().$defaultFn(() => randomUUID()),
  executionKey: text('execution_key').notNull(),
  siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  accountId: integer('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  tokenId: integer('token_id').references(() => accountTokens.id, { onDelete: 'set null' }),
  oauthRouteUnitId: integer('oauth_route_unit_id').references(() => oauthRouteUnits.id, { onDelete: 'set null' }),
  credentialBindingId: integer('credential_binding_id').references(() => credentialEndpointBindings.id, { onDelete: 'set null' }),
  endpointProfileId: integer('endpoint_profile_id').references(() => apiEndpointProfiles.id, { onDelete: 'set null' }),
  upstreamModelName: text('upstream_model_name').notNull(),
  normalizedModelName: text('normalized_model_name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  discovered: integer('discovered', { mode: 'boolean' }).notNull().default(true),
  source: text('source').notNull().default('availability_rebuild'),
  metadataJson: text('metadata_json'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  sourceRefUnique: uniqueIndex('runtime_execution_targets_source_ref_unique').on(table.sourceRef),
  executionKeyUnique: uniqueIndex('runtime_execution_targets_execution_key_unique').on(table.executionKey),
  siteModelIdx: index('runtime_execution_targets_site_model_idx').on(table.siteId, table.normalizedModelName, table.enabled),
  accountIdx: index('runtime_execution_targets_account_idx').on(table.accountId, table.enabled),
  tokenIdx: index('runtime_execution_targets_token_idx').on(table.tokenId, table.enabled),
  routeUnitIdx: index('runtime_execution_targets_route_unit_idx').on(table.oauthRouteUnitId, table.enabled),
}));

export const runtimeExecutionTargetState = sqliteTable('runtime_execution_target_state', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  executionTargetId: integer('execution_target_id').notNull().references(() => runtimeExecutionTargets.id, { onDelete: 'cascade' }),
  successCount: integer('success_count').notNull().default(0),
  failCount: integer('fail_count').notNull().default(0),
  totalLatencyMs: integer('total_latency_ms').notNull().default(0),
  latencySampleCount: integer('latency_sample_count').notNull().default(0),
  lastUsedAt: text('last_used_at'),
  lastSelectedAt: text('last_selected_at'),
  lastFailAt: text('last_fail_at'),
  consecutiveFailCount: integer('consecutive_fail_count').notNull().default(0),
  cooldownLevel: integer('cooldown_level').notNull().default(0),
  cooldownUntil: text('cooldown_until'),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  executionTargetUnique: uniqueIndex('runtime_execution_target_state_execution_target_unique').on(table.executionTargetId),
  cooldownIdx: index('runtime_execution_target_state_cooldown_idx').on(table.cooldownUntil),
}));

export const proxyRequests = sqliteTable('proxy_requests', {
  id: text('id').primaryKey(),
  downstreamPath: text('downstream_path').notNull(),
  requestedModel: text('requested_model'),
  actualModel: text('actual_model'),
  finalSiteId: integer('final_site_id').references(() => sites.id, { onDelete: 'set null' }),
  finalAccountId: integer('final_account_id').references(() => accounts.id, { onDelete: 'set null' }),
  downstreamApiKeyId: integer('downstream_api_key_id'),
  routeEntrypointId: text('route_entrypoint_id'),
  runtimeEndpointId: text('runtime_endpoint_id'),
  finalExecutionAttemptId: text('final_execution_attempt_id'),
  runtimeBundleHash: text('runtime_bundle_hash'),
  status: text('status').notNull().default('started'),
  httpStatus: integer('http_status'),
  isStream: integer('is_stream', { mode: 'boolean' }),
  latencyMs: integer('latency_ms'),
  firstTokenLatencyMs: integer('first_token_latency_ms'),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  totalTokens: integer('total_tokens'),
  estimatedCost: real('estimated_cost'),
  billingDetails: text('billing_details'),
  decisionSnapshot: text('decision_snapshot'),
  errorMessage: text('error_message'),
  startedAt: text('started_at').notNull().default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
}, (table) => ({
  entryCompletedIdx: index('proxy_requests_entry_completed_at_idx').on(table.routeEntrypointId, table.completedAt),
  modelCompletedIdx: index('proxy_requests_model_completed_at_idx').on(table.requestedModel, table.completedAt),
  actualModelCompletedIdx: index('proxy_requests_actual_model_completed_at_idx').on(table.actualModel, table.completedAt),
  siteCompletedIdx: index('proxy_requests_site_completed_at_idx').on(table.finalSiteId, table.completedAt),
  accountCompletedIdx: index('proxy_requests_account_completed_at_idx').on(table.finalAccountId, table.completedAt),
  downstreamKeyCompletedIdx: index('proxy_requests_downstream_key_completed_at_idx').on(table.downstreamApiKeyId, table.completedAt),
  statusCompletedIdx: index('proxy_requests_status_completed_at_idx').on(table.status, table.completedAt),
}));

export const proxyLogs = sqliteTable('proxy_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  requestId: text('request_id').references(() => proxyRequests.id, { onDelete: 'cascade' }),
  executionAttemptId: text('execution_attempt_id'),
  accountId: integer('account_id'),
  downstreamApiKeyId: integer('downstream_api_key_id'),
  modelRequested: text('model_requested'),
  modelActual: text('model_actual'),
  routeEntrypointId: text('route_entrypoint_id'),
  runtimeEndpointId: text('runtime_endpoint_id'),
  runtimeArtifactId: text('runtime_artifact_id'),
  executionTargetId: integer('execution_target_id'),
  status: text('status'), // 'success' | 'failed' | 'retried'
  httpStatus: integer('http_status'),
  isStream: integer('is_stream', { mode: 'boolean' }),
  firstByteLatencyMs: integer('first_byte_latency_ms'),
  firstTokenLatencyMs: integer('first_token_latency_ms'),
  latencyMs: integer('latency_ms'),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  totalTokens: integer('total_tokens'),
  estimatedCost: real('estimated_cost'),
  billingDetails: text('billing_details'),
  clientFamily: text('client_family'),
  clientAppId: text('client_app_id'),
  clientAppName: text('client_app_name'),
  clientConfidence: text('client_confidence'),
  errorMessage: text('error_message'),
  retryCount: integer('retry_count').default(0),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
}, (table) => ({
  requestCreatedIdx: index('proxy_logs_request_created_at_idx').on(table.requestId, table.createdAt),
  createdAtIdx: index('proxy_logs_created_at_idx').on(table.createdAt),
  accountCreatedIdx: index('proxy_logs_account_created_at_idx').on(table.accountId, table.createdAt),
  statusCreatedIdx: index('proxy_logs_status_created_at_idx').on(table.status, table.createdAt),
  modelActualCreatedIdx: index('proxy_logs_model_actual_created_at_idx').on(table.modelActual, table.createdAt),
  executionAttemptCreatedIdx: index('proxy_logs_execution_attempt_created_at_idx').on(table.executionAttemptId, table.createdAt),
  routeEntrypointCreatedIdx: index('proxy_logs_route_entrypoint_created_at_idx').on(table.routeEntrypointId, table.createdAt),
  runtimeEndpointCreatedIdx: index('proxy_logs_runtime_endpoint_created_at_idx').on(table.runtimeEndpointId, table.createdAt),
  executionTargetCreatedIdx: index('proxy_logs_execution_target_created_at_idx').on(table.executionTargetId, table.createdAt),
  downstreamKeyCreatedIdx: index('proxy_logs_downstream_api_key_created_at_idx').on(table.downstreamApiKeyId, table.createdAt),
  clientAppCreatedIdx: index('proxy_logs_client_app_id_created_at_idx').on(table.clientAppId, table.createdAt),
  clientFamilyCreatedIdx: index('proxy_logs_client_family_created_at_idx').on(table.clientFamily, table.createdAt),
}));

export const proxyDebugTraces = sqliteTable('proxy_debug_traces', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  downstreamPath: text('downstream_path').notNull(),
  clientKind: text('client_kind'),
  sessionId: text('session_id'),
  traceHint: text('trace_hint'),
  requestedModel: text('requested_model'),
  downstreamApiKeyId: integer('downstream_api_key_id'),
  requestHeadersJson: text('request_headers_json'),
  requestBodyJson: text('request_body_json'),
  stickySessionKey: text('sticky_session_key'),
  stickyHitExecutionAttemptId: text('sticky_hit_execution_attempt_id'),
  selectedExecutionAttemptId: text('selected_execution_attempt_id'),
  routeEntrypointId: text('route_entrypoint_id'),
  runtimeEndpointId: text('runtime_endpoint_id'),
  selectedAccountId: integer('selected_account_id'),
  selectedSiteId: integer('selected_site_id'),
  selectedSitePlatform: text('selected_site_platform'),
  runtimeTraceJson: text('runtime_trace_json'),
  finalStatus: text('final_status'),
  finalHttpStatus: integer('final_http_status'),
  finalUpstreamPath: text('final_upstream_path'),
  finalResponseHeadersJson: text('final_response_headers_json'),
  finalResponseBodyJson: text('final_response_body_json'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  createdAtIdx: index('proxy_debug_traces_created_at_idx').on(table.createdAt),
  sessionCreatedIdx: index('proxy_debug_traces_session_created_at_idx').on(table.sessionId, table.createdAt),
  modelCreatedIdx: index('proxy_debug_traces_model_created_at_idx').on(table.requestedModel, table.createdAt),
  finalStatusCreatedIdx: index('proxy_debug_traces_final_status_created_at_idx').on(table.finalStatus, table.createdAt),
}));

export const proxyDebugAttempts = sqliteTable('proxy_debug_attempts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  traceId: integer('trace_id').notNull().references(() => proxyDebugTraces.id, { onDelete: 'cascade' }),
  attemptIndex: integer('attempt_index').notNull(),
  endpoint: text('endpoint').notNull(),
  requestPath: text('request_path').notNull(),
  targetUrl: text('target_url').notNull(),
  runtimeExecutor: text('runtime_executor'),
  requestHeadersJson: text('request_headers_json'),
  requestBodyJson: text('request_body_json'),
  responseStatus: integer('response_status'),
  responseHeadersJson: text('response_headers_json'),
  responseBodyJson: text('response_body_json'),
  rawErrorText: text('raw_error_text'),
  recoverApplied: integer('recover_applied', { mode: 'boolean' }).default(false),
  downgradeDecision: integer('downgrade_decision', { mode: 'boolean' }).default(false),
  downgradeReason: text('downgrade_reason'),
  fallbackScope: text('fallback_scope'),
  failureClass: text('failure_class'),
  memoryWriteJson: text('memory_write_json'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
}, (table) => ({
  traceAttemptUnique: uniqueIndex('proxy_debug_attempts_trace_attempt_unique').on(table.traceId, table.attemptIndex),
  traceCreatedIdx: index('proxy_debug_attempts_trace_created_at_idx').on(table.traceId, table.createdAt),
}));

export const proxyVideoTasks = sqliteTable('proxy_video_tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  publicId: text('public_id').notNull(),
  upstreamVideoId: text('upstream_video_id').notNull(),
  siteUrl: text('site_url').notNull(),
  tokenValue: text('token_value').notNull(),
  requestedModel: text('requested_model'),
  actualModel: text('actual_model'),
  executionTargetId: integer('execution_target_id'),
  accountId: integer('account_id'),
  statusSnapshot: text('status_snapshot'),
  upstreamResponseMeta: text('upstream_response_meta'),
  lastUpstreamStatus: integer('last_upstream_status'),
  lastPolledAt: text('last_polled_at'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  publicIdUnique: uniqueIndex('proxy_video_tasks_public_id_unique').on(table.publicId),
  upstreamVideoIdIdx: index('proxy_video_tasks_upstream_video_id_idx').on(table.upstreamVideoId),
  createdAtIdx: index('proxy_video_tasks_created_at_idx').on(table.createdAt),
}));

export const proxyFiles = sqliteTable('proxy_files', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  publicId: text('public_id').notNull(),
  ownerType: text('owner_type').notNull(),
  ownerId: text('owner_id').notNull(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  purpose: text('purpose'),
  byteSize: integer('byte_size').notNull(),
  sha256: text('sha256').notNull(),
  contentBase64: text('content_base64').notNull(),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
  deletedAt: text('deleted_at'),
}, (table) => ({
  publicIdUnique: uniqueIndex('proxy_files_public_id_unique').on(table.publicId),
  ownerLookupIdx: index('proxy_files_owner_lookup_idx').on(table.ownerType, table.ownerId, table.deletedAt),
}));

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value'), // JSON
});

export const adminSnapshots = sqliteTable('admin_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  namespace: text('namespace').notNull(),
  snapshotKey: text('snapshot_key').notNull(),
  payload: text('payload').notNull(),
  generatedAt: text('generated_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  staleUntil: text('stale_until').notNull(),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  namespaceKeyUnique: uniqueIndex('admin_snapshots_namespace_key_unique').on(table.namespace, table.snapshotKey),
  expiresAtIdx: index('admin_snapshots_expires_at_idx').on(table.expiresAt),
  staleUntilIdx: index('admin_snapshots_stale_until_idx').on(table.staleUntil),
}));

export const analyticsProjectionCheckpoints = sqliteTable('analytics_projection_checkpoints', {
  projectorKey: text('projector_key').primaryKey(),
  timeZone: text('time_zone').notNull().default('Local'),
  lastProxyLogId: integer('last_proxy_log_id').notNull().default(0),
  lastProxyRequestCompletedAt: text('last_proxy_request_completed_at'),
  lastProxyRequestId: text('last_proxy_request_id'),
  watermarkCreatedAt: text('watermark_created_at'),
  leaseOwner: text('lease_owner'),
  leaseToken: text('lease_token'),
  leaseExpiresAt: text('lease_expires_at'),
  recomputeFromId: integer('recompute_from_id'),
  recomputeRequestedAt: text('recompute_requested_at'),
  recomputeReason: text('recompute_reason'),
  recomputeStartedAt: text('recompute_started_at'),
  recomputeCompletedAt: text('recompute_completed_at'),
  lastProjectedAt: text('last_projected_at'),
  lastSuccessfulAt: text('last_successful_at'),
  lastError: text('last_error'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  recomputeFromIdIdx: index('analytics_projection_checkpoints_recompute_from_id_idx').on(table.recomputeFromId),
  leaseExpiresAtIdx: index('analytics_projection_checkpoints_lease_expires_at_idx').on(table.leaseExpiresAt),
}));

export const siteDayUsage = sqliteTable('site_day_usage', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  localDay: text('local_day').notNull(),
  siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  totalCalls: integer('total_calls').notNull().default(0),
  successCalls: integer('success_calls').notNull().default(0),
  failedCalls: integer('failed_calls').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  totalLatencyMs: integer('total_latency_ms').notNull().default(0),
  latencyCount: integer('latency_count').notNull().default(0),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  daySiteUnique: uniqueIndex('site_day_usage_day_site_unique').on(table.localDay, table.siteId),
  dayIdx: index('site_day_usage_day_idx').on(table.localDay),
  siteIdx: index('site_day_usage_site_id_idx').on(table.siteId),
  nonNegative: check(
    'site_day_usage_non_negative',
    sql`${table.totalCalls} >= 0 and ${table.successCalls} >= 0 and ${table.failedCalls} >= 0 and ${table.totalTokens} >= 0 and ${table.totalLatencyMs} >= 0 and ${table.latencyCount} >= 0`,
  ),
}));

export const siteHourUsage = sqliteTable('site_hour_usage', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  bucketStartUtc: text('bucket_start_utc').notNull(),
  siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  totalCalls: integer('total_calls').notNull().default(0),
  successCalls: integer('success_calls').notNull().default(0),
  failedCalls: integer('failed_calls').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  totalLatencyMs: integer('total_latency_ms').notNull().default(0),
  latencyCount: integer('latency_count').notNull().default(0),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  hourSiteUnique: uniqueIndex('site_hour_usage_hour_site_unique').on(table.bucketStartUtc, table.siteId),
  hourIdx: index('site_hour_usage_hour_idx').on(table.bucketStartUtc),
  siteIdx: index('site_hour_usage_site_id_idx').on(table.siteId),
  nonNegative: check(
    'site_hour_usage_non_negative',
    sql`${table.totalCalls} >= 0 and ${table.successCalls} >= 0 and ${table.failedCalls} >= 0 and ${table.totalTokens} >= 0 and ${table.totalLatencyMs} >= 0 and ${table.latencyCount} >= 0`,
  ),
}));

export const modelDayUsage = sqliteTable('model_day_usage', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  localDay: text('local_day').notNull(),
  siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  accountId: integer('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  totalCalls: integer('total_calls').notNull().default(0),
  successCalls: integer('success_calls').notNull().default(0),
  failedCalls: integer('failed_calls').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  totalLatencyMs: integer('total_latency_ms').notNull().default(0),
  latencyCount: integer('latency_count').notNull().default(0),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  daySiteAccountModelUnique: uniqueIndex('model_day_usage_day_site_account_model_unique').on(table.localDay, table.siteId, table.accountId, table.model),
  dayIdx: index('model_day_usage_day_idx').on(table.localDay),
  siteIdx: index('model_day_usage_site_id_idx').on(table.siteId),
  accountIdx: index('model_day_usage_account_id_idx').on(table.accountId),
  modelIdx: index('model_day_usage_model_idx').on(table.model),
  nonNegative: check(
    'model_day_usage_non_negative',
    sql`${table.totalCalls} >= 0 and ${table.successCalls} >= 0 and ${table.failedCalls} >= 0 and ${table.totalTokens} >= 0 and ${table.totalLatencyMs} >= 0 and ${table.latencyCount} >= 0`,
  ),
}));

export const routeRuntimeDayUsage = sqliteTable('route_runtime_day_usage', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  localDay: text('local_day').notNull(),
  runtimeIdentityKey: text('runtime_identity_key').notNull(),
  routeEntrypointId: text('route_entrypoint_id'),
  runtimeEndpointId: text('runtime_endpoint_id'),
  executionTargetId: integer('execution_target_id'),
  executionAttemptId: text('execution_attempt_id'),
  siteId: integer('site_id').references(() => sites.id, { onDelete: 'cascade' }),
  accountId: integer('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  totalCalls: integer('total_calls').notNull().default(0),
  successCalls: integer('success_calls').notNull().default(0),
  failedCalls: integer('failed_calls').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  totalLatencyMs: integer('total_latency_ms').notNull().default(0),
  latencyCount: integer('latency_count').notNull().default(0),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  dayIdentityUnique: uniqueIndex('route_runtime_day_usage_day_identity_unique').on(table.localDay, table.runtimeIdentityKey),
  dayIdx: index('route_runtime_day_usage_day_idx').on(table.localDay),
  routeEntrypointDayIdx: index('route_runtime_day_usage_entrypoint_day_idx').on(table.routeEntrypointId, table.localDay),
  runtimeEndpointDayIdx: index('route_runtime_day_usage_runtime_endpoint_day_idx').on(table.runtimeEndpointId, table.localDay),
  executionTargetDayIdx: index('route_runtime_day_usage_execution_target_day_idx').on(table.executionTargetId, table.localDay),
  executionAttemptDayIdx: index('route_runtime_day_usage_execution_attempt_day_idx').on(table.executionAttemptId, table.localDay),
  siteDayIdx: index('route_runtime_day_usage_site_day_idx').on(table.siteId, table.localDay),
  accountDayIdx: index('route_runtime_day_usage_account_day_idx').on(table.accountId, table.localDay),
  modelDayIdx: index('route_runtime_day_usage_model_day_idx').on(table.model, table.localDay),
  nonNegative: check(
    'route_runtime_day_usage_non_negative',
    sql`${table.totalCalls} >= 0 and ${table.successCalls} >= 0 and ${table.failedCalls} >= 0 and ${table.totalTokens} >= 0 and ${table.totalLatencyMs} >= 0 and ${table.latencyCount} >= 0`,
  ),
}));

export const billingCostAggregates = sqliteTable('billing_cost_aggregates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  observationGrain: text('observation_grain').notNull(),
  bucketKind: text('bucket_kind').notNull(),
  bucketStart: text('bucket_start').notNull(),
  subjectKind: text('subject_kind').notNull(),
  subjectKey: text('subject_key').notNull(),
  dimensionKey: text('dimension_key').notNull(),
  siteId: integer('site_id').references(() => sites.id, { onDelete: 'cascade' }),
  accountId: integer('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  model: text('model'),
  routeEntrypointId: text('route_entrypoint_id'),
  runtimeEndpointId: text('runtime_endpoint_id'),
  executionAttemptId: text('execution_attempt_id'),
  downstreamApiKeyId: integer('downstream_api_key_id'),
  quoteUnit: text('quote_unit').notNull(),
  currencyKey: text('currency_key').notNull().default(''),
  quoteSource: text('quote_source').notNull(),
  quoteSourceIdKey: text('quote_source_id_key').notNull().default(''),
  estimateLevelKey: text('estimate_level_key').notNull().default(''),
  planFingerprintKey: text('plan_fingerprint_key').notNull().default(''),
  totalAmount: real('total_amount'),
  knownObservationCount: integer('known_observation_count').notNull().default(0),
  unknownObservationCount: integer('unknown_observation_count').notNull().default(0),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  aggregateUnique: uniqueIndex('billing_cost_aggregates_dimension_unique').on(
    table.observationGrain,
    table.bucketKind,
    table.bucketStart,
    table.subjectKind,
    table.subjectKey,
    table.dimensionKey,
    table.quoteUnit,
    table.currencyKey,
    table.quoteSource,
    table.quoteSourceIdKey,
    table.estimateLevelKey,
    table.planFingerprintKey,
  ),
  subjectBucketIdx: index('billing_cost_aggregates_subject_bucket_idx').on(
    table.observationGrain,
    table.subjectKind,
    table.subjectKey,
    table.bucketKind,
    table.bucketStart,
  ),
  bucketIdx: index('billing_cost_aggregates_bucket_idx').on(table.bucketKind, table.bucketStart),
  siteBucketIdx: index('billing_cost_aggregates_site_bucket_idx').on(table.observationGrain, table.siteId, table.bucketStart),
  accountBucketIdx: index('billing_cost_aggregates_account_bucket_idx').on(table.observationGrain, table.accountId, table.bucketStart),
  modelBucketIdx: index('billing_cost_aggregates_model_bucket_idx').on(table.observationGrain, table.model, table.bucketStart),
  downstreamKeyBucketIdx: index('billing_cost_aggregates_downstream_key_bucket_idx').on(table.observationGrain, table.downstreamApiKeyId, table.bucketStart),
  nonNegative: check(
    'billing_cost_aggregates_non_negative',
    sql`(${table.totalAmount} is null or ${table.totalAmount} >= 0) and ${table.knownObservationCount} >= 0 and ${table.unknownObservationCount} >= 0`,
  ),
}));

export const downstreamApiKeys = sqliteTable('downstream_api_keys', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  key: text('key').notNull(),
  description: text('description'),
  groupName: text('group_name'),
  tags: text('tags'), // JSON array<string>
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  expiresAt: text('expires_at'),
  maxCost: real('max_cost'),
  usedCost: real('used_cost').default(0),
  maxRequests: integer('max_requests'),
  usedRequests: integer('used_requests').default(0),
  supportedModels: text('supported_models'), // JSON array<string>
  allowedPlanIds: text('allowed_plan_ids'), // JSON array<string compiled runtime plan id>
  siteWeightMultipliers: text('site_weight_multipliers'), // JSON object { [siteId]: multiplier }
  excludedSiteIds: text('excluded_site_ids'), // JSON array<number>
  excludedCredentialRefs: text('excluded_credential_refs'), // JSON array<DownstreamExcludedCredentialRef>
  lastUsedAt: text('last_used_at'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  keyUnique: uniqueIndex('downstream_api_keys_key_unique').on(table.key),
  nameIdx: index('downstream_api_keys_name_idx').on(table.name),
  enabledIdx: index('downstream_api_keys_enabled_idx').on(table.enabled),
  expiresAtIdx: index('downstream_api_keys_expires_at_idx').on(table.expiresAt),
}));

export const siteAnnouncements = sqliteTable('site_announcements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  sourceKey: text('source_key').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  level: text('level').notNull().default('info'),
  sourceUrl: text('source_url'),
  startsAt: text('starts_at'),
  endsAt: text('ends_at'),
  upstreamCreatedAt: text('upstream_created_at'),
  upstreamUpdatedAt: text('upstream_updated_at'),
  firstSeenAt: text('first_seen_at').default(sql`(datetime('now'))`),
  lastSeenAt: text('last_seen_at').default(sql`(datetime('now'))`),
  readAt: text('read_at'),
  dismissedAt: text('dismissed_at'),
  rawPayload: text('raw_payload'),
}, (table) => ({
  siteSourceKeyUnique: uniqueIndex('site_announcements_site_source_key_unique').on(table.siteId, table.sourceKey),
  siteIdFirstSeenAtIdx: index('site_announcements_site_id_first_seen_at_idx').on(table.siteId, table.firstSeenAt),
  readAtIdx: index('site_announcements_read_at_idx').on(table.readAt),
}));

export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(), // 'checkin' | 'balance' | 'token' | 'proxy' | 'status'
  title: text('title').notNull(),
  summary: text('summary'),
  description: text('description'),
  message: text('message'),
  level: text('level').notNull().default('info'), // 'info' | 'warning' | 'error'
  severity: text('severity').notNull().default('info'), // 'critical' | 'warning' | 'info' | 'success'
  scope: text('scope').notNull().default('activity'), // 'notification' | 'attention' | 'activity' | 'announcement'
  category: text('category'),
  state: text('state').notNull().default('open'), // 'open' | 'read' | 'acknowledged' | 'snoozed' | 'resolved'
  read: integer('read', { mode: 'boolean' }).default(false),
  readAt: text('read_at'),
  acknowledgedAt: text('acknowledged_at'),
  snoozedUntil: text('snoozed_until'),
  resolvedAt: text('resolved_at'),
  subjectType: text('subject_type'),
  subjectId: text('subject_id'),
  subjectLabel: text('subject_label'),
  detailsJson: text('details_json'),
  actionsJson: text('actions_json'),
  dedupeKey: text('dedupe_key'),
  occurrenceCount: integer('occurrence_count').notNull().default(1),
  firstSeenAt: text('first_seen_at'),
  lastSeenAt: text('last_seen_at'),
  source: text('source'),
  relatedId: integer('related_id'),
  relatedType: text('related_type'), // 'account' | 'site' | 'route'
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  readCreatedIdx: index('events_read_created_at_idx').on(table.read, table.createdAt),
  typeCreatedIdx: index('events_type_created_at_idx').on(table.type, table.createdAt),
  scopeStateCreatedIdx: index('events_scope_state_created_at_idx').on(table.scope, table.state, table.createdAt),
  categoryCreatedIdx: index('events_category_created_at_idx').on(table.category, table.createdAt),
  subjectIdx: index('events_subject_idx').on(table.subjectType, table.subjectId),
  dedupeKeyIdx: index('events_dedupe_key_idx').on(table.dedupeKey),
  createdAtIdx: index('events_created_at_idx').on(table.createdAt),
}));
