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
CREATE INDEX `upstream_model_cost_pricings_site_model_idx` ON `upstream_model_cost_pricings` (`site_id`,`normalized_model_name`,`enabled`);
--> statement-breakpoint
CREATE INDEX `upstream_model_cost_pricings_account_model_idx` ON `upstream_model_cost_pricings` (`account_id`,`normalized_model_name`,`enabled`);
--> statement-breakpoint
CREATE INDEX `upstream_model_cost_pricings_token_model_idx` ON `upstream_model_cost_pricings` (`token_id`,`normalized_model_name`,`enabled`);
--> statement-breakpoint
CREATE INDEX `upstream_model_cost_pricings_token_group_model_idx` ON `upstream_model_cost_pricings` (`token_id`,`token_group`,`normalized_model_name`,`enabled`);
--> statement-breakpoint
CREATE UNIQUE INDEX `upstream_model_cost_pricings_scope_key_unique` ON `upstream_model_cost_pricings` (`scope_key`);
