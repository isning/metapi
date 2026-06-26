ALTER TABLE `proxy_logs` ADD `target_id` integer;
--> statement-breakpoint
UPDATE `proxy_logs`
SET `target_id` = `channel_id`
WHERE `target_id` IS NULL
  AND `channel_id` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `proxy_debug_traces` ADD `sticky_hit_target_id` integer;
--> statement-breakpoint
UPDATE `proxy_debug_traces`
SET `sticky_hit_target_id` = `sticky_hit_channel_id`
WHERE `sticky_hit_target_id` IS NULL
  AND `sticky_hit_channel_id` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `proxy_debug_traces` ADD `selected_target_id` integer;
--> statement-breakpoint
UPDATE `proxy_debug_traces`
SET `selected_target_id` = `selected_channel_id`
WHERE `selected_target_id` IS NULL
  AND `selected_channel_id` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `proxy_video_tasks` ADD `target_id` integer;
--> statement-breakpoint
UPDATE `proxy_video_tasks`
SET `target_id` = `channel_id`
WHERE `target_id` IS NULL
  AND `channel_id` IS NOT NULL;
