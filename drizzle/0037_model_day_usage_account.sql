DROP INDEX IF EXISTS `model_day_usage_day_site_model_unique`;
--> statement-breakpoint
DROP INDEX IF EXISTS `model_day_usage_day_site_account_model_unique`;
--> statement-breakpoint
DROP INDEX IF EXISTS `model_day_usage_account_id_idx`;
--> statement-breakpoint
CREATE TABLE `__new_model_day_usage` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `local_day` text NOT NULL,
  `site_id` integer NOT NULL,
  `account_id` integer NOT NULL,
  `model` text NOT NULL,
  `total_calls` integer DEFAULT 0 NOT NULL,
  `success_calls` integer DEFAULT 0 NOT NULL,
  `failed_calls` integer DEFAULT 0 NOT NULL,
  `total_tokens` integer DEFAULT 0 NOT NULL,
  `total_spend` real DEFAULT 0 NOT NULL,
  `total_latency_ms` integer DEFAULT 0 NOT NULL,
  `latency_count` integer DEFAULT 0 NOT NULL,
  `created_at` text DEFAULT (datetime('now')),
  `updated_at` text DEFAULT (datetime('now')),
  FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP TABLE `model_day_usage`;
--> statement-breakpoint
ALTER TABLE `__new_model_day_usage` RENAME TO `model_day_usage`;
--> statement-breakpoint
CREATE UNIQUE INDEX `model_day_usage_day_site_account_model_unique` ON `model_day_usage` (`local_day`,`site_id`,`account_id`,`model`);
--> statement-breakpoint
CREATE INDEX `model_day_usage_day_idx` ON `model_day_usage` (`local_day`);
--> statement-breakpoint
CREATE INDEX `model_day_usage_site_id_idx` ON `model_day_usage` (`site_id`);
--> statement-breakpoint
CREATE INDEX `model_day_usage_account_id_idx` ON `model_day_usage` (`account_id`);
--> statement-breakpoint
CREATE INDEX `model_day_usage_model_idx` ON `model_day_usage` (`model`);
--> statement-breakpoint
DELETE FROM `site_day_usage`;
--> statement-breakpoint
DELETE FROM `site_hour_usage`;
--> statement-breakpoint
DELETE FROM `model_day_usage`;
--> statement-breakpoint
DELETE FROM `analytics_projection_checkpoints` WHERE `projector_key` = 'usage-aggregates-v1';
