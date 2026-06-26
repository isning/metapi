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
CREATE TABLE `wallet_acquisition_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope` text NOT NULL,
	`scope_key` text NOT NULL,
	`site_id` integer NOT NULL,
	`account_id` integer,
	`token_id` integer,
	`inheritance` text DEFAULT 'inherit' NOT NULL,
	`wallet_currency` text DEFAULT 'USD' NOT NULL,
	`base_currency` text DEFAULT 'USD' NOT NULL,
	`face_value_price` real,
	`face_value_currency` text,
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