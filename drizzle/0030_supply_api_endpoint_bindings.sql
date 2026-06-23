CREATE TABLE `api_endpoint_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`profile_key` text NOT NULL,
	`api_type` text NOT NULL,
	`label` text NOT NULL,
	`base_url` text,
	`path_template` text,
	`auth_mode` text DEFAULT 'bearer' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 0,
	`capability_defaults_json` text,
	`compatibility_policy_ref` text,
	`metadata_json` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_endpoint_profiles_site_profile_key_unique` ON `api_endpoint_profiles` (`site_id`,`profile_key`);--> statement-breakpoint
CREATE INDEX `api_endpoint_profiles_site_api_type_idx` ON `api_endpoint_profiles` (`site_id`,`api_type`,`enabled`);--> statement-breakpoint
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
CREATE INDEX `credential_endpoint_bindings_profile_idx` ON `credential_endpoint_bindings` (`api_endpoint_profile_id`);
