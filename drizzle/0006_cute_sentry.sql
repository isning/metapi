CREATE TABLE `account_token_health` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_id` integer NOT NULL,
	`state` text DEFAULT 'unknown' NOT NULL,
	`reason` text,
	`source` text DEFAULT 'proxy-observation' NOT NULL,
	`checked_at` text,
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`token_id`) REFERENCES `account_tokens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_token_health_token_unique` ON `account_token_health` (`token_id`);--> statement-breakpoint
CREATE INDEX `account_token_health_state_idx` ON `account_token_health` (`state`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`username` text,
	`credential_mode` text DEFAULT 'session' NOT NULL,
	`credential` text DEFAULT '' NOT NULL,
	`credential_kind` text DEFAULT 'access_token' NOT NULL,
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
INSERT INTO `__new_accounts`("id", "site_id", "username", "credential_mode", "credential", "credential_kind", "balance", "balance_used", "quota", "unit_cost", "value_score", "status", "is_pinned", "sort_order", "checkin_enabled", "last_checkin_at", "last_balance_refresh", "oauth_provider", "oauth_account_key", "oauth_project_id", "extra_config", "created_at", "updated_at") SELECT "id", "site_id", "username", "credential_mode", "credential", "credential_kind", "balance", "balance_used", "quota", "unit_cost", "value_score", "status", "is_pinned", "sort_order", "checkin_enabled", "last_checkin_at", "last_balance_refresh", "oauth_provider", "oauth_account_key", "oauth_project_id", "extra_config", "created_at", "updated_at" FROM `accounts`;--> statement-breakpoint
DROP TABLE `accounts`;--> statement-breakpoint
ALTER TABLE `__new_accounts` RENAME TO `accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `accounts_site_id_idx` ON `accounts` (`site_id`);--> statement-breakpoint
CREATE INDEX `accounts_status_idx` ON `accounts` (`status`);--> statement-breakpoint
CREATE INDEX `accounts_site_status_idx` ON `accounts` (`site_id`,`status`);--> statement-breakpoint
CREATE INDEX `accounts_oauth_provider_idx` ON `accounts` (`oauth_provider`);--> statement-breakpoint
CREATE INDEX `accounts_oauth_identity_idx` ON `accounts` (`oauth_provider`,`oauth_account_key`,`oauth_project_id`);--> statement-breakpoint
ALTER TABLE `sites` DROP COLUMN `post_refresh_probe_enabled`;--> statement-breakpoint
ALTER TABLE `sites` DROP COLUMN `post_refresh_probe_model`;--> statement-breakpoint
ALTER TABLE `sites` DROP COLUMN `post_refresh_probe_scope`;--> statement-breakpoint
ALTER TABLE `sites` DROP COLUMN `post_refresh_probe_latency_threshold_ms`;