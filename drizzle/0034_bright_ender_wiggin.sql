CREATE TABLE `route_group_buckets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`bucket_key` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`label` text,
	`strategy` text DEFAULT 'weighted' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`group_id`) REFERENCES `route_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `route_group_buckets_group_bucket_unique` ON `route_group_buckets` (`group_id`,`bucket_key`);--> statement-breakpoint
CREATE INDEX `route_group_buckets_group_priority_idx` ON `route_group_buckets` (`group_id`,`priority`);--> statement-breakpoint
CREATE TABLE `route_group_candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`bucket_id` integer NOT NULL,
	`candidate_key` text NOT NULL,
	`candidate_kind` text NOT NULL,
	`supply_endpoint_id` integer,
	`child_group_id` integer,
	`weight` integer DEFAULT 10 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`source` text DEFAULT 'availability_rebuild' NOT NULL,
	`manual_override` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`group_id`) REFERENCES `route_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bucket_id`) REFERENCES `route_group_buckets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supply_endpoint_id`) REFERENCES `route_supply_endpoints`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_group_id`) REFERENCES `route_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `route_group_candidates_group_candidate_unique` ON `route_group_candidates` (`group_id`,`bucket_id`,`candidate_key`);--> statement-breakpoint
CREATE INDEX `route_group_candidates_group_sort_idx` ON `route_group_candidates` (`group_id`,`bucket_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `route_group_candidates_supply_endpoint_idx` ON `route_group_candidates` (`supply_endpoint_id`);--> statement-breakpoint
CREATE INDEX `route_group_candidates_child_group_idx` ON `route_group_candidates` (`child_group_id`);--> statement-breakpoint
CREATE TABLE `route_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`group_key` text NOT NULL,
	`upstream_model_name` text,
	`normalized_model_name` text,
	`public_model_name` text,
	`display_name` text,
	`display_icon` text,
	`visibility` text DEFAULT 'public' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`routing_strategy` text DEFAULT 'weighted' NOT NULL,
	`source_mode` text DEFAULT 'auto' NOT NULL,
	`legacy_route_id` integer,
	`config_json` text,
	`user_override_json` text,
	`sync_status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`legacy_route_id`) REFERENCES `token_routes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `route_groups_kind_group_key_unique` ON `route_groups` (`kind`,`group_key`);--> statement-breakpoint
CREATE INDEX `route_groups_kind_status_idx` ON `route_groups` (`kind`,`sync_status`);--> statement-breakpoint
CREATE INDEX `route_groups_normalized_model_idx` ON `route_groups` (`normalized_model_name`);--> statement-breakpoint
CREATE INDEX `route_groups_legacy_route_idx` ON `route_groups` (`legacy_route_id`);--> statement-breakpoint
CREATE TABLE `route_supply_endpoint_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`supply_endpoint_id` integer NOT NULL,
	`success_count` integer DEFAULT 0 NOT NULL,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`total_latency_ms` integer DEFAULT 0 NOT NULL,
	`total_cost` real DEFAULT 0 NOT NULL,
	`last_used_at` text,
	`last_selected_at` text,
	`last_fail_at` text,
	`consecutive_fail_count` integer DEFAULT 0 NOT NULL,
	`cooldown_level` integer DEFAULT 0 NOT NULL,
	`cooldown_until` text,
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`supply_endpoint_id`) REFERENCES `route_supply_endpoints`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `route_supply_endpoint_state_supply_endpoint_unique` ON `route_supply_endpoint_state` (`supply_endpoint_id`);--> statement-breakpoint
CREATE INDEX `route_supply_endpoint_state_cooldown_idx` ON `route_supply_endpoint_state` (`cooldown_until`);--> statement-breakpoint
CREATE TABLE `route_supply_endpoints` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`supply_key` text NOT NULL,
	`site_id` integer NOT NULL,
	`account_id` integer,
	`token_id` integer,
	`oauth_route_unit_id` integer,
	`credential_binding_id` integer,
	`endpoint_profile_id` integer,
	`legacy_target_id` integer,
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
	FOREIGN KEY (`endpoint_profile_id`) REFERENCES `api_endpoint_profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`legacy_target_id`) REFERENCES `route_endpoint_targets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `route_supply_endpoints_supply_key_unique` ON `route_supply_endpoints` (`supply_key`);--> statement-breakpoint
CREATE INDEX `route_supply_endpoints_site_model_idx` ON `route_supply_endpoints` (`site_id`,`normalized_model_name`,`enabled`);--> statement-breakpoint
CREATE INDEX `route_supply_endpoints_account_idx` ON `route_supply_endpoints` (`account_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `route_supply_endpoints_token_idx` ON `route_supply_endpoints` (`token_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `route_supply_endpoints_route_unit_idx` ON `route_supply_endpoints` (`oauth_route_unit_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `route_supply_endpoints_legacy_target_idx` ON `route_supply_endpoints` (`legacy_target_id`);