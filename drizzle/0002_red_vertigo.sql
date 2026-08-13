CREATE TABLE `token_disabled_models` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_id` integer NOT NULL,
	`model_name` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`token_id`) REFERENCES `account_tokens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `token_disabled_models_token_model_unique` ON `token_disabled_models` (`token_id`,`model_name`);--> statement-breakpoint
CREATE INDEX `token_disabled_models_token_id_idx` ON `token_disabled_models` (`token_id`);--> statement-breakpoint
ALTER TABLE `token_model_availability` ADD `is_manual` integer DEFAULT false;
