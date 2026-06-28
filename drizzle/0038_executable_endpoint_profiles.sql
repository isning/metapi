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
CREATE UNIQUE INDEX `model_catalog_sources_site_source_key_unique` ON `model_catalog_sources` (`site_id`,`source_key`);
--> statement-breakpoint
CREATE INDEX `model_catalog_sources_site_enabled_idx` ON `model_catalog_sources` (`site_id`,`enabled`);
--> statement-breakpoint
ALTER TABLE `api_endpoint_profiles` ADD COLUMN `request_method` text DEFAULT 'POST' NOT NULL;
--> statement-breakpoint
ALTER TABLE `api_endpoint_profiles` ADD COLUMN `request_url` text;
--> statement-breakpoint
ALTER TABLE `api_endpoint_profiles` ADD COLUMN `default_headers_json` text;
--> statement-breakpoint
ALTER TABLE `api_endpoint_profiles` ADD COLUMN `model_catalog_source_id` integer REFERENCES `model_catalog_sources`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `api_endpoint_profiles` DROP COLUMN `base_url`;
--> statement-breakpoint
ALTER TABLE `api_endpoint_profiles` DROP COLUMN `path_template`;
--> statement-breakpoint
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
CREATE UNIQUE INDEX `endpoint_model_observations_credential_profile_model_unique` ON `endpoint_model_observations` (`site_id`,`credential_key`,`api_endpoint_profile_id`,`model_name`);
--> statement-breakpoint
CREATE INDEX `endpoint_model_observations_site_model_idx` ON `endpoint_model_observations` (`site_id`,`model_name`);
--> statement-breakpoint
CREATE INDEX `endpoint_model_observations_profile_status_idx` ON `endpoint_model_observations` (`api_endpoint_profile_id`,`status`);
