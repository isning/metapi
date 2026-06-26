ALTER TABLE `events` ADD COLUMN `summary` text;
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `description` text;
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `severity` text NOT NULL DEFAULT 'info';
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `scope` text NOT NULL DEFAULT 'activity';
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `category` text;
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `state` text NOT NULL DEFAULT 'open';
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `read_at` text;
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `acknowledged_at` text;
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `snoozed_until` text;
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `resolved_at` text;
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `subject_type` text;
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `subject_id` text;
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `subject_label` text;
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `details_json` text;
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `actions_json` text;
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `dedupe_key` text;
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `occurrence_count` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `first_seen_at` text;
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `last_seen_at` text;
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `source` text;
--> statement-breakpoint
ALTER TABLE `events` ADD COLUMN `updated_at` text;
--> statement-breakpoint
UPDATE `events`
SET
  `summary` = COALESCE(NULLIF(`summary`, ''), NULLIF(`message`, ''), `title`),
  `description` = COALESCE(NULLIF(`description`, ''), NULLIF(`message`, '')),
  `severity` = CASE
    WHEN lower(COALESCE(`level`, 'info')) IN ('error', 'critical') THEN 'critical'
    WHEN lower(COALESCE(`level`, 'info')) = 'warning' THEN 'warning'
    WHEN lower(COALESCE(`level`, 'info')) = 'success' THEN 'success'
    ELSE 'info'
  END,
  `scope` = CASE
    WHEN lower(COALESCE(`type`, '')) = 'site_notice' THEN 'announcement'
    ELSE 'activity'
  END,
  `category` = CASE
    WHEN lower(COALESCE(`type`, '')) = 'balance' THEN 'balance'
    WHEN lower(COALESCE(`type`, '')) IN ('proxy', 'status') THEN 'health'
    WHEN lower(COALESCE(`type`, '')) = 'token' THEN 'auth'
    WHEN lower(COALESCE(`type`, '')) = 'site_notice' THEN 'site'
    WHEN lower(COALESCE(`related_type`, '')) = 'route' THEN 'routing'
    ELSE 'system'
  END,
  `state` = CASE WHEN `read` = 1 THEN 'read' ELSE 'open' END,
  `read_at` = CASE WHEN `read` = 1 THEN COALESCE(`read_at`, `created_at`) ELSE `read_at` END,
  `subject_type` = COALESCE(NULLIF(`subject_type`, ''), NULLIF(`related_type`, '')),
  `subject_id` = COALESCE(NULLIF(`subject_id`, ''), CASE WHEN `related_id` IS NULL THEN NULL ELSE CAST(`related_id` AS text) END),
  `first_seen_at` = COALESCE(`first_seen_at`, `created_at`),
  `last_seen_at` = COALESCE(`last_seen_at`, `created_at`),
  `updated_at` = COALESCE(`updated_at`, `created_at`, datetime('now'))
WHERE
  `summary` IS NULL
  OR `description` IS NULL
  OR `category` IS NULL
  OR `first_seen_at` IS NULL
  OR `last_seen_at` IS NULL
  OR `updated_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `events_scope_state_created_at_idx` ON `events` (`scope`,`state`,`created_at`);
--> statement-breakpoint
CREATE INDEX `events_category_created_at_idx` ON `events` (`category`,`created_at`);
--> statement-breakpoint
CREATE INDEX `events_subject_idx` ON `events` (`subject_type`,`subject_id`);
--> statement-breakpoint
CREATE INDEX `events_dedupe_key_idx` ON `events` (`dedupe_key`);
