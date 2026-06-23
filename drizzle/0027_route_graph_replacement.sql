CREATE TABLE `route_graph_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` integer NOT NULL,
	`source_graph_json` text NOT NULL,
	`compiled_graph_json` text NOT NULL,
	`status` text DEFAULT 'archived' NOT NULL,
	`created_by` text DEFAULT 'system',
	`created_at` text DEFAULT (datetime('now')),
	`activated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `route_graph_versions_version_unique` ON `route_graph_versions` (`version`);
--> statement-breakpoint
CREATE INDEX `route_graph_versions_status_idx` ON `route_graph_versions` (`status`);
--> statement-breakpoint
CREATE TABLE `route_graph_drafts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`base_version` integer,
	`working_graph_json` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`diagnostics_json` text,
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`base_version`) REFERENCES `route_graph_versions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `route_graph_drafts_status_idx` ON `route_graph_drafts` (`status`);
--> statement-breakpoint
CREATE TABLE `route_graph_active_version` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version_id` integer NOT NULL,
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`version_id`) REFERENCES `route_graph_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `route_graph_active_version_singleton_unique` ON `route_graph_active_version` (`id`);
--> statement-breakpoint
ALTER TABLE `route_endpoint_targets` ADD `route_endpoint_id` text;
--> statement-breakpoint
UPDATE `route_endpoint_targets` SET `route_endpoint_id` = 'entry:legacy:' || `route_id` WHERE `route_endpoint_id` IS NULL OR trim(`route_endpoint_id`) = '';
--> statement-breakpoint
CREATE INDEX `route_endpoint_targets_route_endpoint_id_idx` ON `route_endpoint_targets` (`route_endpoint_id`);
--> statement-breakpoint
INSERT INTO `route_graph_versions` (
	`version`,
	`source_graph_json`,
	`compiled_graph_json`,
	`status`,
	`created_by`,
	`created_at`,
	`activated_at`
)
SELECT
	1,
	json_object(
		'version', 1,
		'nodes', coalesce(json((
			SELECT json_group_array(json(`node_json`))
			FROM (
				SELECT json_object(
					'id', 'entry:legacy:' || `token_routes`.`id`,
					'type', 'entry',
					'name', coalesce(nullif(trim(`token_routes`.`display_name`), ''), `token_routes`.`model_pattern`),
					'enabled', CASE WHEN coalesce(`token_routes`.`enabled`, 1) THEN json('true') ELSE json('false') END,
					'visibility', 'public',
					'ownership', 'manual',
					'match', json_object(
						'kind', 'model',
						'requestedModelPattern', CASE WHEN coalesce(`token_routes`.`route_mode`, 'pattern') = 'explicit_group' THEN '' ELSE coalesce(`token_routes`.`model_pattern`, '') END,
						'currentModelPattern', '',
						'displayName', CASE
							WHEN nullif(trim(coalesce(`token_routes`.`display_name`, '')), '') IS NOT NULL THEN trim(`token_routes`.`display_name`)
							WHEN coalesce(`token_routes`.`route_mode`, 'pattern') = 'explicit_group' THEN coalesce(`token_routes`.`model_pattern`, '')
							ELSE NULL
						END
					),
					'selectionStrategy', coalesce(`token_routes`.`routing_strategy`, 'weighted'),
					'provenance', json_object('source', 'legacy', 'routeId', `token_routes`.`id`)
				) AS `node_json`
				FROM `token_routes`
				UNION ALL
				SELECT json_object(
					'id', 'route-endpoint:legacy:' || `token_routes`.`id`,
					'type', 'route_endpoint',
					'name', coalesce(nullif(trim(`token_routes`.`display_name`), ''), `token_routes`.`model_pattern`) || ' pool',
					'enabled', CASE WHEN coalesce(`token_routes`.`enabled`, 1) THEN json('true') ELSE json('false') END,
					'visibility', 'internal',
					'ownership', 'manual',
					'routeEndpointId', 'entry:legacy:' || `token_routes`.`id`,
					'legacyRouteId', `token_routes`.`id`,
					'routingStrategy', coalesce(`token_routes`.`routing_strategy`, 'weighted'),
					'provenance', json_object('source', 'legacy', 'routeId', `token_routes`.`id`)
				) AS `node_json`
				FROM `token_routes`
				WHERE coalesce(`token_routes`.`route_mode`, 'pattern') <> 'explicit_group'
			)
		)), json('[]')),
		'edges', coalesce(json((
			SELECT json_group_array(json(`edge_json`))
			FROM (
				SELECT json_object(
					'id', 'edge:entry:legacy:' || `token_routes`.`id` || ':route-endpoint:legacy:' || `token_routes`.`id`,
					'sourceNodeId', 'entry:legacy:' || `token_routes`.`id`,
					'targetNodeId', 'route-endpoint:legacy:' || `token_routes`.`id`,
					'ownership', 'manual'
				) AS `edge_json`
				FROM `token_routes`
				WHERE coalesce(`token_routes`.`route_mode`, 'pattern') <> 'explicit_group'
				UNION ALL
				SELECT json_object(
					'id', 'edge:entry:legacy:' || `route_group_sources`.`group_route_id` || ':entry:legacy:' || `route_group_sources`.`source_route_id`,
					'sourceNodeId', 'entry:legacy:' || `route_group_sources`.`group_route_id`,
					'targetNodeId', 'entry:legacy:' || `route_group_sources`.`source_route_id`,
					'ownership', 'manual'
				) AS `edge_json`
				FROM `route_group_sources`
			)
		)), json('[]')),
		'metadata', json_object('migratedFrom', 'token_routes')
	),
	json_object(
		'version', 1,
		'hash', '',
		'entries', json('[]'),
		'nodesById', json_object(),
		'edgesBySource', json_object(),
		'terminals', json('[]'),
		'publicModels', json('[]')
	),
	'active',
	'legacy-migration',
	datetime('now'),
	datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM `route_graph_versions`);
--> statement-breakpoint
INSERT INTO `route_graph_active_version` (`id`, `version_id`, `updated_at`)
SELECT 1, `route_graph_versions`.`id`, datetime('now')
FROM `route_graph_versions`
WHERE `route_graph_versions`.`version` = 1
	AND NOT EXISTS (SELECT 1 FROM `route_graph_active_version` WHERE `id` = 1);
--> statement-breakpoint
CREATE TABLE `__new_token_routes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`display_name` text,
	`display_icon` text,
	`model_mapping` text,
	`decision_snapshot` text,
	`decision_refreshed_at` text,
	`routing_strategy` text DEFAULT 'weighted',
	`enabled` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
INSERT INTO `__new_token_routes` (
	`id`,
	`display_name`,
	`display_icon`,
	`model_mapping`,
	`decision_snapshot`,
	`decision_refreshed_at`,
	`routing_strategy`,
	`enabled`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`display_name`,
	`display_icon`,
	`model_mapping`,
	`decision_snapshot`,
	`decision_refreshed_at`,
	`routing_strategy`,
	`enabled`,
	`created_at`,
	`updated_at`
FROM `token_routes`;
--> statement-breakpoint
DROP TABLE `token_routes`;
--> statement-breakpoint
ALTER TABLE `__new_token_routes` RENAME TO `token_routes`;
--> statement-breakpoint
CREATE INDEX `token_routes_enabled_idx` ON `token_routes` (`enabled`);
