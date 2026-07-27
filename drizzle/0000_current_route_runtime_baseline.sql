CREATE TABLE `account_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`name` text NOT NULL,
	`token` text NOT NULL,
	`token_group` text,
	`compatibility_policy` text,
	`value_status` text DEFAULT 'ready' NOT NULL,
	`source` text DEFAULT 'manual',
	`enabled` integer DEFAULT true,
	`is_default` integer DEFAULT false,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_tokens_account_id_idx` ON `account_tokens` (`account_id`);--> statement-breakpoint
CREATE INDEX `account_tokens_account_enabled_idx` ON `account_tokens` (`account_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `account_tokens_enabled_idx` ON `account_tokens` (`enabled`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`username` text,
	`access_token` text NOT NULL,
	`api_token` text,
	`balance` real DEFAULT 0,
	`balance_used` real DEFAULT 0,
	`quota` real DEFAULT 0,
	`unit_cost` real,
	`value_score` real DEFAULT 0,
	`status` text DEFAULT 'active',
	`is_pinned` integer DEFAULT false,
	`sort_order` integer DEFAULT 0,
	`checkin_enabled` integer DEFAULT true,
	`last_checkin_at` text,
	`last_balance_refresh` text,
	`oauth_provider` text,
	`oauth_account_key` text,
	`oauth_project_id` text,
	`extra_config` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `accounts_site_id_idx` ON `accounts` (`site_id`);--> statement-breakpoint
CREATE INDEX `accounts_status_idx` ON `accounts` (`status`);--> statement-breakpoint
CREATE INDEX `accounts_site_status_idx` ON `accounts` (`site_id`,`status`);--> statement-breakpoint
CREATE INDEX `accounts_oauth_provider_idx` ON `accounts` (`oauth_provider`);--> statement-breakpoint
CREATE INDEX `accounts_oauth_identity_idx` ON `accounts` (`oauth_provider`,`oauth_account_key`,`oauth_project_id`);--> statement-breakpoint
CREATE TABLE `admin_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`namespace` text NOT NULL,
	`snapshot_key` text NOT NULL,
	`payload` text NOT NULL,
	`generated_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`stale_until` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_snapshots_namespace_key_unique` ON `admin_snapshots` (`namespace`,`snapshot_key`);--> statement-breakpoint
CREATE INDEX `admin_snapshots_expires_at_idx` ON `admin_snapshots` (`expires_at`);--> statement-breakpoint
CREATE INDEX `admin_snapshots_stale_until_idx` ON `admin_snapshots` (`stale_until`);--> statement-breakpoint
CREATE TABLE `analytics_projection_checkpoints` (
	`projector_key` text PRIMARY KEY NOT NULL,
	`time_zone` text DEFAULT 'Local' NOT NULL,
	`last_proxy_log_id` integer DEFAULT 0 NOT NULL,
	`last_proxy_request_completed_at` text,
	`last_proxy_request_id` text,
	`watermark_created_at` text,
	`lease_owner` text,
	`lease_token` text,
	`lease_expires_at` text,
	`recompute_from_id` integer,
	`recompute_requested_at` text,
	`recompute_reason` text,
	`recompute_started_at` text,
	`recompute_completed_at` text,
	`last_projected_at` text,
	`last_successful_at` text,
	`last_error` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX `analytics_projection_checkpoints_recompute_from_id_idx` ON `analytics_projection_checkpoints` (`recompute_from_id`);--> statement-breakpoint
CREATE INDEX `analytics_projection_checkpoints_lease_expires_at_idx` ON `analytics_projection_checkpoints` (`lease_expires_at`);--> statement-breakpoint
CREATE TABLE `api_endpoint_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`profile_key` text NOT NULL,
	`api_type` text NOT NULL,
	`label` text NOT NULL,
	`request_method` text DEFAULT 'POST' NOT NULL,
	`request_url` text,
	`default_headers_json` text,
	`model_catalog_source_id` integer,
	`auth_mode` text DEFAULT 'bearer' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 0,
	`capability_defaults_json` text,
	`compatibility_policy_ref` text,
	`metadata_json` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_catalog_source_id`) REFERENCES `model_catalog_sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_endpoint_profiles_site_profile_key_unique` ON `api_endpoint_profiles` (`site_id`,`profile_key`);--> statement-breakpoint
CREATE INDEX `api_endpoint_profiles_site_api_type_idx` ON `api_endpoint_profiles` (`site_id`,`api_type`,`enabled`);--> statement-breakpoint
CREATE TABLE `billing_cost_aggregates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`observation_grain` text NOT NULL,
	`bucket_kind` text NOT NULL,
	`bucket_start` text NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_key` text NOT NULL,
	`dimension_key` text NOT NULL,
	`site_id` integer,
	`account_id` integer,
	`model` text,
	`route_entrypoint_id` text,
	`runtime_endpoint_id` text,
	`execution_attempt_id` text,
	`downstream_api_key_id` integer,
	`quote_unit` text NOT NULL,
	`currency_key` text DEFAULT '' NOT NULL,
	`quote_source` text NOT NULL,
	`quote_source_id_key` text DEFAULT '' NOT NULL,
	`estimate_level_key` text DEFAULT '' NOT NULL,
	`plan_fingerprint_key` text DEFAULT '' NOT NULL,
	`total_amount` real,
	`known_observation_count` integer DEFAULT 0 NOT NULL,
	`unknown_observation_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "billing_cost_aggregates_non_negative" CHECK(("billing_cost_aggregates"."total_amount" is null or "billing_cost_aggregates"."total_amount" >= 0) and "billing_cost_aggregates"."known_observation_count" >= 0 and "billing_cost_aggregates"."unknown_observation_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_cost_aggregates_dimension_unique` ON `billing_cost_aggregates` (`observation_grain`,`bucket_kind`,`bucket_start`,`subject_kind`,`subject_key`,`dimension_key`,`quote_unit`,`currency_key`,`quote_source`,`quote_source_id_key`,`estimate_level_key`,`plan_fingerprint_key`);--> statement-breakpoint
CREATE INDEX `billing_cost_aggregates_subject_bucket_idx` ON `billing_cost_aggregates` (`observation_grain`,`subject_kind`,`subject_key`,`bucket_kind`,`bucket_start`);--> statement-breakpoint
CREATE INDEX `billing_cost_aggregates_bucket_idx` ON `billing_cost_aggregates` (`bucket_kind`,`bucket_start`);--> statement-breakpoint
CREATE INDEX `billing_cost_aggregates_site_bucket_idx` ON `billing_cost_aggregates` (`observation_grain`,`site_id`,`bucket_start`);--> statement-breakpoint
CREATE INDEX `billing_cost_aggregates_account_bucket_idx` ON `billing_cost_aggregates` (`observation_grain`,`account_id`,`bucket_start`);--> statement-breakpoint
CREATE INDEX `billing_cost_aggregates_model_bucket_idx` ON `billing_cost_aggregates` (`observation_grain`,`model`,`bucket_start`);--> statement-breakpoint
CREATE INDEX `billing_cost_aggregates_downstream_key_bucket_idx` ON `billing_cost_aggregates` (`observation_grain`,`downstream_api_key_id`,`bucket_start`);--> statement-breakpoint
CREATE TABLE `checkin_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`status` text NOT NULL,
	`message` text,
	`reward` text,
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `checkin_logs_account_created_at_idx` ON `checkin_logs` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `checkin_logs_created_at_idx` ON `checkin_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `checkin_logs_status_idx` ON `checkin_logs` (`status`);--> statement-breakpoint
CREATE TABLE `compiled_runtime_active_artifact` (
	`id` integer PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `compiled_runtime_artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compiled_runtime_active_artifact_singleton_unique` ON `compiled_runtime_active_artifact` (`id`);--> statement-breakpoint
CREATE TABLE `compiled_runtime_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_json` text NOT NULL,
	`bundle_hash` text NOT NULL,
	`source_graph_version_id` integer,
	`source_graph_hash` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`source_graph_version_id`) REFERENCES `route_graph_versions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `compiled_runtime_artifacts_bundle_hash_idx` ON `compiled_runtime_artifacts` (`bundle_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `compiled_runtime_artifacts_source_graph_version_unique` ON `compiled_runtime_artifacts` (`source_graph_version_id`);--> statement-breakpoint
CREATE TABLE `credential_endpoint_bindings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`account_id` integer,
	`token_id` integer,
	`credential_key` text NOT NULL,
	`credential_kind` text NOT NULL,
	`api_endpoint_profile_id` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`support` text DEFAULT 'supported' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`priority` integer DEFAULT 0,
	`capability_override_json` text,
	`compatibility_policy_ref` text,
	`pricing_policy_ref` text,
	`measured_pricing_ref` text,
	`metadata_json` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`token_id`) REFERENCES `account_tokens`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`api_endpoint_profile_id`) REFERENCES `api_endpoint_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credential_endpoint_bindings_credential_profile_unique` ON `credential_endpoint_bindings` (`site_id`,`credential_key`,`api_endpoint_profile_id`);--> statement-breakpoint
CREATE INDEX `credential_endpoint_bindings_site_credential_idx` ON `credential_endpoint_bindings` (`site_id`,`credential_key`);--> statement-breakpoint
CREATE INDEX `credential_endpoint_bindings_account_idx` ON `credential_endpoint_bindings` (`account_id`);--> statement-breakpoint
CREATE INDEX `credential_endpoint_bindings_token_idx` ON `credential_endpoint_bindings` (`token_id`);--> statement-breakpoint
CREATE INDEX `credential_endpoint_bindings_profile_idx` ON `credential_endpoint_bindings` (`api_endpoint_profile_id`);--> statement-breakpoint
CREATE TABLE `downstream_api_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`key` text NOT NULL,
	`description` text,
	`group_name` text,
	`tags` text,
	`enabled` integer DEFAULT true,
	`expires_at` text,
	`max_cost` real,
	`used_cost` real DEFAULT 0,
	`max_requests` integer,
	`used_requests` integer DEFAULT 0,
	`supported_models` text,
	`allowed_plan_ids` text,
	`site_weight_multipliers` text,
	`excluded_site_ids` text,
	`excluded_credential_refs` text,
	`last_used_at` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `downstream_api_keys_key_unique` ON `downstream_api_keys` (`key`);--> statement-breakpoint
CREATE INDEX `downstream_api_keys_name_idx` ON `downstream_api_keys` (`name`);--> statement-breakpoint
CREATE INDEX `downstream_api_keys_enabled_idx` ON `downstream_api_keys` (`enabled`);--> statement-breakpoint
CREATE INDEX `downstream_api_keys_expires_at_idx` ON `downstream_api_keys` (`expires_at`);--> statement-breakpoint
CREATE TABLE `endpoint_model_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`credential_key` text NOT NULL,
	`api_endpoint_profile_id` integer NOT NULL,
	`model_name` text NOT NULL,
	`status` text NOT NULL,
	`failure_class` text,
	`source` text DEFAULT 'runtime' NOT NULL,
	`observed_at` text DEFAULT (datetime('now')),
	`expires_at` text,
	`metadata_json` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`api_endpoint_profile_id`) REFERENCES `api_endpoint_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `endpoint_model_observations_credential_profile_model_unique` ON `endpoint_model_observations` (`site_id`,`credential_key`,`api_endpoint_profile_id`,`model_name`);--> statement-breakpoint
CREATE INDEX `endpoint_model_observations_site_model_idx` ON `endpoint_model_observations` (`site_id`,`model_name`);--> statement-breakpoint
CREATE INDEX `endpoint_model_observations_profile_status_idx` ON `endpoint_model_observations` (`api_endpoint_profile_id`,`status`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`description` text,
	`message` text,
	`level` text DEFAULT 'info' NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`scope` text DEFAULT 'activity' NOT NULL,
	`category` text,
	`state` text DEFAULT 'open' NOT NULL,
	`read` integer DEFAULT false,
	`read_at` text,
	`acknowledged_at` text,
	`snoozed_until` text,
	`resolved_at` text,
	`subject_type` text,
	`subject_id` text,
	`subject_label` text,
	`details_json` text,
	`actions_json` text,
	`dedupe_key` text,
	`occurrence_count` integer DEFAULT 1 NOT NULL,
	`first_seen_at` text,
	`last_seen_at` text,
	`source` text,
	`related_id` integer,
	`related_type` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX `events_read_created_at_idx` ON `events` (`read`,`created_at`);--> statement-breakpoint
CREATE INDEX `events_type_created_at_idx` ON `events` (`type`,`created_at`);--> statement-breakpoint
CREATE INDEX `events_scope_state_created_at_idx` ON `events` (`scope`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `events_category_created_at_idx` ON `events` (`category`,`created_at`);--> statement-breakpoint
CREATE INDEX `events_subject_idx` ON `events` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `events_dedupe_key_idx` ON `events` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `events_created_at_idx` ON `events` (`created_at`);--> statement-breakpoint
CREATE TABLE `fx_rate_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_currency` text NOT NULL,
	`to_currency` text NOT NULL,
	`rate` real NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`captured_at` text DEFAULT (datetime('now')) NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX `fx_rate_snapshots_currency_captured_idx` ON `fx_rate_snapshots` (`from_currency`,`to_currency`,`captured_at`);--> statement-breakpoint
CREATE INDEX `fx_rate_snapshots_currency_source_idx` ON `fx_rate_snapshots` (`from_currency`,`to_currency`,`source`);--> statement-breakpoint
CREATE TABLE `model_availability` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`model_name` text NOT NULL,
	`available` integer,
	`is_manual` integer DEFAULT false,
	`latency_ms` integer,
	`checked_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_availability_account_model_unique` ON `model_availability` (`account_id`,`model_name`);--> statement-breakpoint
CREATE INDEX `model_availability_account_available_idx` ON `model_availability` (`account_id`,`available`);--> statement-breakpoint
CREATE INDEX `model_availability_model_name_idx` ON `model_availability` (`model_name`);--> statement-breakpoint
CREATE TABLE `model_catalog_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`source_key` text NOT NULL,
	`label` text NOT NULL,
	`discovery_method` text DEFAULT 'GET' NOT NULL,
	`discovery_url` text,
	`parser` text DEFAULT 'openai_models' NOT NULL,
	`credential_scope` text DEFAULT 'credential' NOT NULL,
	`refresh_policy_json` text,
	`enabled` integer DEFAULT true NOT NULL,
	`metadata_json` text,
	`last_refresh_at` text,
	`last_model_count` integer DEFAULT 0,
	`last_error` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_catalog_sources_site_source_key_unique` ON `model_catalog_sources` (`site_id`,`source_key`);--> statement-breakpoint
CREATE INDEX `model_catalog_sources_site_enabled_idx` ON `model_catalog_sources` (`site_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `model_day_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`local_day` text NOT NULL,
	`site_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`model` text NOT NULL,
	`total_calls` integer DEFAULT 0 NOT NULL,
	`success_calls` integer DEFAULT 0 NOT NULL,
	`failed_calls` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`total_latency_ms` integer DEFAULT 0 NOT NULL,
	`latency_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "model_day_usage_non_negative" CHECK("model_day_usage"."total_calls" >= 0 and "model_day_usage"."success_calls" >= 0 and "model_day_usage"."failed_calls" >= 0 and "model_day_usage"."total_tokens" >= 0 and "model_day_usage"."total_latency_ms" >= 0 and "model_day_usage"."latency_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_day_usage_day_site_account_model_unique` ON `model_day_usage` (`local_day`,`site_id`,`account_id`,`model`);--> statement-breakpoint
CREATE INDEX `model_day_usage_day_idx` ON `model_day_usage` (`local_day`);--> statement-breakpoint
CREATE INDEX `model_day_usage_site_id_idx` ON `model_day_usage` (`site_id`);--> statement-breakpoint
CREATE INDEX `model_day_usage_account_id_idx` ON `model_day_usage` (`account_id`);--> statement-breakpoint
CREATE INDEX `model_day_usage_model_idx` ON `model_day_usage` (`model`);--> statement-breakpoint
CREATE TABLE `oauth_route_unit_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`unit_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0,
	`success_count` integer DEFAULT 0,
	`fail_count` integer DEFAULT 0,
	`total_latency_ms` integer DEFAULT 0,
	`total_cost` real DEFAULT 0,
	`last_used_at` text,
	`last_selected_at` text,
	`last_fail_at` text,
	`consecutive_fail_count` integer DEFAULT 0 NOT NULL,
	`cooldown_level` integer DEFAULT 0 NOT NULL,
	`cooldown_until` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`unit_id`) REFERENCES `oauth_route_units`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_route_unit_members_unit_account_unique` ON `oauth_route_unit_members` (`unit_id`,`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_route_unit_members_account_unique` ON `oauth_route_unit_members` (`account_id`);--> statement-breakpoint
CREATE INDEX `oauth_route_unit_members_unit_sort_idx` ON `oauth_route_unit_members` (`unit_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `oauth_route_unit_members_unit_cooldown_idx` ON `oauth_route_unit_members` (`unit_id`,`cooldown_until`);--> statement-breakpoint
CREATE TABLE `oauth_route_units` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`provider` text NOT NULL,
	`name` text NOT NULL,
	`strategy` text DEFAULT 'round_robin' NOT NULL,
	`enabled` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_route_units_site_provider_idx` ON `oauth_route_units` (`site_id`,`provider`);--> statement-breakpoint
CREATE INDEX `oauth_route_units_enabled_idx` ON `oauth_route_units` (`enabled`);--> statement-breakpoint
CREATE TABLE `provider_pricing_catalog_caches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope_key` text NOT NULL,
	`site_id` integer NOT NULL,
	`account_id` integer,
	`platform` text NOT NULL,
	`credential_kind` text,
	`catalog_json` text,
	`model_count` integer DEFAULT 0 NOT NULL,
	`group_count` integer DEFAULT 0 NOT NULL,
	`catalog_fingerprint` text,
	`last_status` text DEFAULT 'success' NOT NULL,
	`last_error` text,
	`diagnostics_json` text,
	`fetched_at` text DEFAULT (datetime('now')) NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_pricing_catalog_caches_scope_key_unique` ON `provider_pricing_catalog_caches` (`scope_key`);--> statement-breakpoint
CREATE INDEX `provider_pricing_catalog_caches_site_account_idx` ON `provider_pricing_catalog_caches` (`site_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `provider_pricing_catalog_caches_expiry_idx` ON `provider_pricing_catalog_caches` (`expires_at`);--> statement-breakpoint
CREATE INDEX `provider_pricing_catalog_caches_status_idx` ON `provider_pricing_catalog_caches` (`last_status`);--> statement-breakpoint
CREATE TABLE `proxy_debug_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trace_id` integer NOT NULL,
	`attempt_index` integer NOT NULL,
	`endpoint` text NOT NULL,
	`request_path` text NOT NULL,
	`target_url` text NOT NULL,
	`runtime_executor` text,
	`request_headers_json` text,
	`request_body_json` text,
	`response_status` integer,
	`response_headers_json` text,
	`response_body_json` text,
	`raw_error_text` text,
	`recover_applied` integer DEFAULT false,
	`downgrade_decision` integer DEFAULT false,
	`downgrade_reason` text,
	`fallback_scope` text,
	`failure_class` text,
	`memory_write_json` text,
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`trace_id`) REFERENCES `proxy_debug_traces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proxy_debug_attempts_trace_attempt_unique` ON `proxy_debug_attempts` (`trace_id`,`attempt_index`);--> statement-breakpoint
CREATE INDEX `proxy_debug_attempts_trace_created_at_idx` ON `proxy_debug_attempts` (`trace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `proxy_debug_traces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`downstream_path` text NOT NULL,
	`client_kind` text,
	`session_id` text,
	`trace_hint` text,
	`requested_model` text,
	`downstream_api_key_id` integer,
	`request_headers_json` text,
	`request_body_json` text,
	`sticky_session_key` text,
	`sticky_hit_execution_attempt_id` text,
	`selected_execution_attempt_id` text,
	`route_entrypoint_id` text,
	`runtime_endpoint_id` text,
	`selected_account_id` integer,
	`selected_site_id` integer,
	`selected_site_platform` text,
	`runtime_trace_json` text,
	`final_status` text,
	`final_http_status` integer,
	`final_upstream_path` text,
	`final_response_headers_json` text,
	`final_response_body_json` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX `proxy_debug_traces_created_at_idx` ON `proxy_debug_traces` (`created_at`);--> statement-breakpoint
CREATE INDEX `proxy_debug_traces_session_created_at_idx` ON `proxy_debug_traces` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `proxy_debug_traces_model_created_at_idx` ON `proxy_debug_traces` (`requested_model`,`created_at`);--> statement-breakpoint
CREATE INDEX `proxy_debug_traces_final_status_created_at_idx` ON `proxy_debug_traces` (`final_status`,`created_at`);--> statement-breakpoint
CREATE TABLE `proxy_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`purpose` text,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`content_base64` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proxy_files_public_id_unique` ON `proxy_files` (`public_id`);--> statement-breakpoint
CREATE INDEX `proxy_files_owner_lookup_idx` ON `proxy_files` (`owner_type`,`owner_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `proxy_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` text,
	`execution_attempt_id` text,
	`account_id` integer,
	`downstream_api_key_id` integer,
	`model_requested` text,
	`model_actual` text,
	`route_entrypoint_id` text,
	`runtime_endpoint_id` text,
	`runtime_artifact_id` text,
	`execution_target_id` integer,
	`status` text,
	`http_status` integer,
	`is_stream` integer,
	`first_byte_latency_ms` integer,
	`first_token_latency_ms` integer,
	`latency_ms` integer,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`total_tokens` integer,
	`estimated_cost` real,
	`billing_details` text,
	`client_family` text,
	`client_app_id` text,
	`client_app_name` text,
	`client_confidence` text,
	`error_message` text,
	`retry_count` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`request_id`) REFERENCES `proxy_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `proxy_logs_request_created_at_idx` ON `proxy_logs` (`request_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `proxy_logs_created_at_idx` ON `proxy_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `proxy_logs_account_created_at_idx` ON `proxy_logs` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `proxy_logs_status_created_at_idx` ON `proxy_logs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `proxy_logs_model_actual_created_at_idx` ON `proxy_logs` (`model_actual`,`created_at`);--> statement-breakpoint
CREATE INDEX `proxy_logs_execution_attempt_created_at_idx` ON `proxy_logs` (`execution_attempt_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `proxy_logs_route_entrypoint_created_at_idx` ON `proxy_logs` (`route_entrypoint_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `proxy_logs_runtime_endpoint_created_at_idx` ON `proxy_logs` (`runtime_endpoint_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `proxy_logs_execution_target_created_at_idx` ON `proxy_logs` (`execution_target_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `proxy_logs_downstream_api_key_created_at_idx` ON `proxy_logs` (`downstream_api_key_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `proxy_logs_client_app_id_created_at_idx` ON `proxy_logs` (`client_app_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `proxy_logs_client_family_created_at_idx` ON `proxy_logs` (`client_family`,`created_at`);--> statement-breakpoint
CREATE TABLE `proxy_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`downstream_path` text NOT NULL,
	`requested_model` text,
	`actual_model` text,
	`final_site_id` integer,
	`final_account_id` integer,
	`downstream_api_key_id` integer,
	`route_entrypoint_id` text,
	`runtime_endpoint_id` text,
	`final_execution_attempt_id` text,
	`runtime_bundle_hash` text,
	`status` text DEFAULT 'started' NOT NULL,
	`http_status` integer,
	`is_stream` integer,
	`latency_ms` integer,
	`first_token_latency_ms` integer,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`total_tokens` integer,
	`estimated_cost` real,
	`billing_details` text,
	`decision_snapshot` text,
	`error_message` text,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`final_site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`final_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `proxy_requests_entry_completed_at_idx` ON `proxy_requests` (`route_entrypoint_id`,`completed_at`);--> statement-breakpoint
CREATE INDEX `proxy_requests_model_completed_at_idx` ON `proxy_requests` (`requested_model`,`completed_at`);--> statement-breakpoint
CREATE INDEX `proxy_requests_actual_model_completed_at_idx` ON `proxy_requests` (`actual_model`,`completed_at`);--> statement-breakpoint
CREATE INDEX `proxy_requests_site_completed_at_idx` ON `proxy_requests` (`final_site_id`,`completed_at`);--> statement-breakpoint
CREATE INDEX `proxy_requests_account_completed_at_idx` ON `proxy_requests` (`final_account_id`,`completed_at`);--> statement-breakpoint
CREATE INDEX `proxy_requests_downstream_key_completed_at_idx` ON `proxy_requests` (`downstream_api_key_id`,`completed_at`);--> statement-breakpoint
CREATE INDEX `proxy_requests_status_completed_at_idx` ON `proxy_requests` (`status`,`completed_at`);--> statement-breakpoint
CREATE TABLE `proxy_video_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`upstream_video_id` text NOT NULL,
	`site_url` text NOT NULL,
	`token_value` text NOT NULL,
	`requested_model` text,
	`actual_model` text,
	`execution_target_id` integer,
	`account_id` integer,
	`status_snapshot` text,
	`upstream_response_meta` text,
	`last_upstream_status` integer,
	`last_polled_at` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proxy_video_tasks_public_id_unique` ON `proxy_video_tasks` (`public_id`);--> statement-breakpoint
CREATE INDEX `proxy_video_tasks_upstream_video_id_idx` ON `proxy_video_tasks` (`upstream_video_id`);--> statement-breakpoint
CREATE INDEX `proxy_video_tasks_created_at_idx` ON `proxy_video_tasks` (`created_at`);--> statement-breakpoint
CREATE TABLE `route_graph_active_version` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version_id` integer NOT NULL,
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`version_id`) REFERENCES `route_graph_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `route_graph_active_version_singleton_unique` ON `route_graph_active_version` (`id`);--> statement-breakpoint
CREATE TABLE `route_graph_drafts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`base_version` integer,
	`revision` integer DEFAULT 0 NOT NULL,
	`working_graph_json` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`diagnostics_json` text,
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`base_version`) REFERENCES `route_graph_versions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `route_graph_drafts_status_idx` ON `route_graph_drafts` (`status`);--> statement-breakpoint
CREATE TABLE `route_graph_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` integer NOT NULL,
	`source_graph_json` text NOT NULL,
	`status` text DEFAULT 'archived' NOT NULL,
	`created_by` text DEFAULT 'system',
	`created_at` text DEFAULT (datetime('now')),
	`activated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `route_graph_versions_version_unique` ON `route_graph_versions` (`version`);--> statement-breakpoint
CREATE INDEX `route_graph_versions_status_idx` ON `route_graph_versions` (`status`);--> statement-breakpoint
CREATE TABLE `route_graph_workspace_operation_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`draft_id` integer NOT NULL,
	`source_revision` integer NOT NULL,
	`result_revision` integer NOT NULL,
	`forward_operations_json` text NOT NULL,
	`inverse_operations_json` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `route_graph_drafts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `route_graph_workspace_operation_batches_draft_revision_idx` ON `route_graph_workspace_operation_batches` (`draft_id`,`result_revision`);--> statement-breakpoint
CREATE TABLE `route_runtime_day_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`local_day` text NOT NULL,
	`runtime_identity_key` text NOT NULL,
	`route_entrypoint_id` text,
	`runtime_endpoint_id` text,
	`execution_target_id` integer,
	`execution_attempt_id` text,
	`site_id` integer,
	`account_id` integer,
	`model` text NOT NULL,
	`total_calls` integer DEFAULT 0 NOT NULL,
	`success_calls` integer DEFAULT 0 NOT NULL,
	`failed_calls` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`total_latency_ms` integer DEFAULT 0 NOT NULL,
	`latency_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "route_runtime_day_usage_non_negative" CHECK("route_runtime_day_usage"."total_calls" >= 0 and "route_runtime_day_usage"."success_calls" >= 0 and "route_runtime_day_usage"."failed_calls" >= 0 and "route_runtime_day_usage"."total_tokens" >= 0 and "route_runtime_day_usage"."total_latency_ms" >= 0 and "route_runtime_day_usage"."latency_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `route_runtime_day_usage_day_identity_unique` ON `route_runtime_day_usage` (`local_day`,`runtime_identity_key`);--> statement-breakpoint
CREATE INDEX `route_runtime_day_usage_day_idx` ON `route_runtime_day_usage` (`local_day`);--> statement-breakpoint
CREATE INDEX `route_runtime_day_usage_entrypoint_day_idx` ON `route_runtime_day_usage` (`route_entrypoint_id`,`local_day`);--> statement-breakpoint
CREATE INDEX `route_runtime_day_usage_runtime_endpoint_day_idx` ON `route_runtime_day_usage` (`runtime_endpoint_id`,`local_day`);--> statement-breakpoint
CREATE INDEX `route_runtime_day_usage_execution_target_day_idx` ON `route_runtime_day_usage` (`execution_target_id`,`local_day`);--> statement-breakpoint
CREATE INDEX `route_runtime_day_usage_execution_attempt_day_idx` ON `route_runtime_day_usage` (`execution_attempt_id`,`local_day`);--> statement-breakpoint
CREATE INDEX `route_runtime_day_usage_site_day_idx` ON `route_runtime_day_usage` (`site_id`,`local_day`);--> statement-breakpoint
CREATE INDEX `route_runtime_day_usage_account_day_idx` ON `route_runtime_day_usage` (`account_id`,`local_day`);--> statement-breakpoint
CREATE INDEX `route_runtime_day_usage_model_day_idx` ON `route_runtime_day_usage` (`model`,`local_day`);--> statement-breakpoint
CREATE TABLE `runtime_execution_target_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`execution_target_id` integer NOT NULL,
	`success_count` integer DEFAULT 0 NOT NULL,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`total_latency_ms` integer DEFAULT 0 NOT NULL,
	`latency_sample_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` text,
	`last_selected_at` text,
	`last_fail_at` text,
	`consecutive_fail_count` integer DEFAULT 0 NOT NULL,
	`cooldown_level` integer DEFAULT 0 NOT NULL,
	`cooldown_until` text,
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`execution_target_id`) REFERENCES `runtime_execution_targets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runtime_execution_target_state_execution_target_unique` ON `runtime_execution_target_state` (`execution_target_id`);--> statement-breakpoint
CREATE INDEX `runtime_execution_target_state_cooldown_idx` ON `runtime_execution_target_state` (`cooldown_until`);--> statement-breakpoint
CREATE TABLE `runtime_execution_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_ref` text NOT NULL,
	`execution_key` text NOT NULL,
	`site_id` integer NOT NULL,
	`account_id` integer,
	`token_id` integer,
	`oauth_route_unit_id` integer,
	`credential_binding_id` integer,
	`endpoint_profile_id` integer,
	`upstream_model_name` text NOT NULL,
	`normalized_model_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`discovered` integer DEFAULT true NOT NULL,
	`source` text DEFAULT 'availability_rebuild' NOT NULL,
	`metadata_json` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`token_id`) REFERENCES `account_tokens`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`oauth_route_unit_id`) REFERENCES `oauth_route_units`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`credential_binding_id`) REFERENCES `credential_endpoint_bindings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`endpoint_profile_id`) REFERENCES `api_endpoint_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runtime_execution_targets_source_ref_unique` ON `runtime_execution_targets` (`source_ref`);--> statement-breakpoint
CREATE UNIQUE INDEX `runtime_execution_targets_execution_key_unique` ON `runtime_execution_targets` (`execution_key`);--> statement-breakpoint
CREATE INDEX `runtime_execution_targets_site_model_idx` ON `runtime_execution_targets` (`site_id`,`normalized_model_name`,`enabled`);--> statement-breakpoint
CREATE INDEX `runtime_execution_targets_account_idx` ON `runtime_execution_targets` (`account_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `runtime_execution_targets_token_idx` ON `runtime_execution_targets` (`token_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `runtime_execution_targets_route_unit_idx` ON `runtime_execution_targets` (`oauth_route_unit_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `site_announcements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`platform` text NOT NULL,
	`source_key` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`source_url` text,
	`starts_at` text,
	`ends_at` text,
	`upstream_created_at` text,
	`upstream_updated_at` text,
	`first_seen_at` text DEFAULT (datetime('now')),
	`last_seen_at` text DEFAULT (datetime('now')),
	`read_at` text,
	`dismissed_at` text,
	`raw_payload` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_announcements_site_source_key_unique` ON `site_announcements` (`site_id`,`source_key`);--> statement-breakpoint
CREATE INDEX `site_announcements_site_id_first_seen_at_idx` ON `site_announcements` (`site_id`,`first_seen_at`);--> statement-breakpoint
CREATE INDEX `site_announcements_read_at_idx` ON `site_announcements` (`read_at`);--> statement-breakpoint
CREATE TABLE `site_api_endpoints` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`url` text NOT NULL,
	`enabled` integer DEFAULT true,
	`sort_order` integer DEFAULT 0,
	`cooldown_until` text,
	`last_selected_at` text,
	`last_failed_at` text,
	`last_failure_reason` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_api_endpoints_site_url_unique` ON `site_api_endpoints` (`site_id`,`url`);--> statement-breakpoint
CREATE INDEX `site_api_endpoints_site_enabled_sort_idx` ON `site_api_endpoints` (`site_id`,`enabled`,`sort_order`);--> statement-breakpoint
CREATE INDEX `site_api_endpoints_site_cooldown_idx` ON `site_api_endpoints` (`site_id`,`cooldown_until`);--> statement-breakpoint
CREATE TABLE `site_day_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`local_day` text NOT NULL,
	`site_id` integer NOT NULL,
	`total_calls` integer DEFAULT 0 NOT NULL,
	`success_calls` integer DEFAULT 0 NOT NULL,
	`failed_calls` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`total_latency_ms` integer DEFAULT 0 NOT NULL,
	`latency_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "site_day_usage_non_negative" CHECK("site_day_usage"."total_calls" >= 0 and "site_day_usage"."success_calls" >= 0 and "site_day_usage"."failed_calls" >= 0 and "site_day_usage"."total_tokens" >= 0 and "site_day_usage"."total_latency_ms" >= 0 and "site_day_usage"."latency_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_day_usage_day_site_unique` ON `site_day_usage` (`local_day`,`site_id`);--> statement-breakpoint
CREATE INDEX `site_day_usage_day_idx` ON `site_day_usage` (`local_day`);--> statement-breakpoint
CREATE INDEX `site_day_usage_site_id_idx` ON `site_day_usage` (`site_id`);--> statement-breakpoint
CREATE TABLE `site_disabled_models` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`model_name` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_disabled_models_site_model_unique` ON `site_disabled_models` (`site_id`,`model_name`);--> statement-breakpoint
CREATE INDEX `site_disabled_models_site_id_idx` ON `site_disabled_models` (`site_id`);--> statement-breakpoint
CREATE TABLE `site_hour_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bucket_start_utc` text NOT NULL,
	`site_id` integer NOT NULL,
	`total_calls` integer DEFAULT 0 NOT NULL,
	`success_calls` integer DEFAULT 0 NOT NULL,
	`failed_calls` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`total_latency_ms` integer DEFAULT 0 NOT NULL,
	`latency_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "site_hour_usage_non_negative" CHECK("site_hour_usage"."total_calls" >= 0 and "site_hour_usage"."success_calls" >= 0 and "site_hour_usage"."failed_calls" >= 0 and "site_hour_usage"."total_tokens" >= 0 and "site_hour_usage"."total_latency_ms" >= 0 and "site_hour_usage"."latency_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_hour_usage_hour_site_unique` ON `site_hour_usage` (`bucket_start_utc`,`site_id`);--> statement-breakpoint
CREATE INDEX `site_hour_usage_hour_idx` ON `site_hour_usage` (`bucket_start_utc`);--> statement-breakpoint
CREATE INDEX `site_hour_usage_site_id_idx` ON `site_hour_usage` (`site_id`);--> statement-breakpoint
CREATE TABLE `sites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`external_checkin_url` text,
	`platform` text NOT NULL,
	`proxy_url` text,
	`use_system_proxy` integer DEFAULT false,
	`custom_headers` text,
	`compatibility_policy` text,
	`status` text DEFAULT 'active' NOT NULL,
	`is_pinned` integer DEFAULT false,
	`sort_order` integer DEFAULT 0,
	`global_weight` real DEFAULT 1,
	`api_key` text,
	`post_refresh_probe_enabled` integer DEFAULT false,
	`post_refresh_probe_model` text DEFAULT '',
	`post_refresh_probe_scope` text DEFAULT 'single',
	`post_refresh_probe_latency_threshold_ms` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX `sites_status_idx` ON `sites` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `sites_platform_url_unique` ON `sites` (`platform`,`url`);--> statement-breakpoint
CREATE TABLE `token_model_availability` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_id` integer NOT NULL,
	`model_name` text NOT NULL,
	`available` integer,
	`latency_ms` integer,
	`checked_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`token_id`) REFERENCES `account_tokens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `token_model_availability_token_model_unique` ON `token_model_availability` (`token_id`,`model_name`);--> statement-breakpoint
CREATE INDEX `token_model_availability_token_available_idx` ON `token_model_availability` (`token_id`,`available`);--> statement-breakpoint
CREATE INDEX `token_model_availability_model_name_idx` ON `token_model_availability` (`model_name`);--> statement-breakpoint
CREATE INDEX `token_model_availability_available_idx` ON `token_model_availability` (`available`);--> statement-breakpoint
CREATE TABLE `upstream_model_cost_pricings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope` text NOT NULL,
	`scope_key` text NOT NULL,
	`site_id` integer NOT NULL,
	`account_id` integer,
	`token_id` integer,
	`token_group` text,
	`model_name` text NOT NULL,
	`normalized_model_name` text NOT NULL,
	`display_name` text,
	`enabled` integer DEFAULT true NOT NULL,
	`plan_json` text NOT NULL,
	`plan_fingerprint` text NOT NULL,
	`source_type` text DEFAULT 'user' NOT NULL,
	`metadata_json` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`token_id`) REFERENCES `account_tokens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `upstream_model_cost_pricings_site_model_idx` ON `upstream_model_cost_pricings` (`site_id`,`normalized_model_name`,`enabled`);--> statement-breakpoint
CREATE INDEX `upstream_model_cost_pricings_account_model_idx` ON `upstream_model_cost_pricings` (`account_id`,`normalized_model_name`,`enabled`);--> statement-breakpoint
CREATE INDEX `upstream_model_cost_pricings_token_model_idx` ON `upstream_model_cost_pricings` (`token_id`,`normalized_model_name`,`enabled`);--> statement-breakpoint
CREATE INDEX `upstream_model_cost_pricings_token_group_model_idx` ON `upstream_model_cost_pricings` (`token_id`,`token_group`,`normalized_model_name`,`enabled`);--> statement-breakpoint
CREATE UNIQUE INDEX `upstream_model_cost_pricings_scope_key_unique` ON `upstream_model_cost_pricings` (`scope_key`);--> statement-breakpoint
CREATE TABLE `wallet_acquisition_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope` text NOT NULL,
	`scope_key` text NOT NULL,
	`site_id` integer NOT NULL,
	`account_id` integer,
	`token_id` integer,
	`inheritance` text DEFAULT 'inherit' NOT NULL,
	`wallet_unit` text DEFAULT 'USD' NOT NULL,
	`face_value_price` real,
	`recharge_discount` real DEFAULT 1 NOT NULL,
	`daily_earned_balance` real,
	`daily_earned_balance_source` text DEFAULT 'observed_checkin' NOT NULL,
	`observed_window_days` integer,
	`confidence` text DEFAULT 'incomplete' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`token_id`) REFERENCES `account_tokens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_acquisition_profiles_scope_key_unique` ON `wallet_acquisition_profiles` (`scope_key`);--> statement-breakpoint
CREATE INDEX `wallet_acquisition_profiles_site_scope_idx` ON `wallet_acquisition_profiles` (`site_id`,`scope`,`enabled`);--> statement-breakpoint
CREATE INDEX `wallet_acquisition_profiles_account_idx` ON `wallet_acquisition_profiles` (`account_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `wallet_acquisition_profiles_token_idx` ON `wallet_acquisition_profiles` (`token_id`,`enabled`);