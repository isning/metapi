CREATE TABLE `route_binding_projections` (
	`route_id` integer PRIMARY KEY NOT NULL,
	`match_json` text NOT NULL,
	`backend_json` text NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`model_pattern` text DEFAULT '' NOT NULL,
	`route_mode` text DEFAULT 'pattern' NOT NULL,
	`source_route_ids_json` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`route_id`) REFERENCES `token_routes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `route_binding_projections_visibility_idx` ON `route_binding_projections` (`visibility`);
--> statement-breakpoint
CREATE INDEX `route_binding_projections_route_mode_idx` ON `route_binding_projections` (`route_mode`);
--> statement-breakpoint
CREATE INDEX `route_binding_projections_model_pattern_idx` ON `route_binding_projections` (`model_pattern`);
