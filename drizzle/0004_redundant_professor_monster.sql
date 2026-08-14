UPDATE `account_tokens`
SET `is_default` = 0
WHERE `account_id` IN (
  SELECT `id` FROM `accounts`
  WHERE `api_token` IS NOT NULL AND trim(`api_token`) <> ''
);
--> statement-breakpoint
INSERT INTO `account_tokens` (`account_id`, `name`, `token`, `token_group`, `value_status`, `source`, `enabled`, `is_default`)
SELECT `id`, 'default', `api_token`, 'default', 'ready', 'legacy_account_api_token', 1, 1
FROM `accounts`
WHERE `api_token` IS NOT NULL
  AND trim(`api_token`) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM `account_tokens`
    WHERE `account_tokens`.`account_id` = `accounts`.`id`
      AND `account_tokens`.`token` = `accounts`.`api_token`
  );
--> statement-breakpoint
UPDATE `account_tokens`
SET `is_default` = 1,
    `enabled` = 1,
    `value_status` = 'ready'
WHERE EXISTS (
  SELECT 1 FROM `accounts`
  WHERE `accounts`.`id` = `account_tokens`.`account_id`
    AND `accounts`.`api_token` = `account_tokens`.`token`
    AND trim(`accounts`.`api_token`) <> ''
);
--> statement-breakpoint
ALTER TABLE `accounts` DROP COLUMN `api_token`;
