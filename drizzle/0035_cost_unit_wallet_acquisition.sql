CREATE TABLE `wallet_acquisition_profiles_next` (
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
INSERT INTO `wallet_acquisition_profiles_next` (
	`id`,
	`scope`,
	`scope_key`,
	`site_id`,
	`account_id`,
	`token_id`,
	`inheritance`,
	`wallet_unit`,
	`face_value_price`,
	`recharge_discount`,
	`daily_earned_balance`,
	`daily_earned_balance_source`,
	`observed_window_days`,
	`confidence`,
	`enabled`,
	`notes`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`scope`,
	`scope_key`,
	`site_id`,
	`account_id`,
	`token_id`,
	`inheritance`,
	COALESCE(NULLIF(`wallet_currency`, ''), 'USD'),
	`face_value_price`,
	`recharge_discount`,
	`daily_earned_balance`,
	`daily_earned_balance_source`,
	`observed_window_days`,
	`confidence`,
	`enabled`,
	`notes`,
	`created_at`,
	`updated_at`
FROM `wallet_acquisition_profiles`;
--> statement-breakpoint
DROP TABLE `wallet_acquisition_profiles`;
--> statement-breakpoint
ALTER TABLE `wallet_acquisition_profiles_next` RENAME TO `wallet_acquisition_profiles`;
--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_acquisition_profiles_scope_key_unique` ON `wallet_acquisition_profiles` (`scope_key`);
--> statement-breakpoint
CREATE INDEX `wallet_acquisition_profiles_site_scope_idx` ON `wallet_acquisition_profiles` (`site_id`,`scope`,`enabled`);
--> statement-breakpoint
CREATE INDEX `wallet_acquisition_profiles_account_idx` ON `wallet_acquisition_profiles` (`account_id`,`enabled`);
--> statement-breakpoint
CREATE INDEX `wallet_acquisition_profiles_token_idx` ON `wallet_acquisition_profiles` (`token_id`,`enabled`);
