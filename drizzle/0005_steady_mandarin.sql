UPDATE `account_tokens`
SET `is_default` = 0,
	`enabled` = 0
WHERE `account_id` IN (
	SELECT `id` FROM `accounts`
	WHERE trim(COALESCE(`access_token`, '')) <> ''
		AND json_valid(COALESCE(`extra_config`, ''))
		AND (
			json_extract(`extra_config`, '$.credentialMode') = 'apikey'
			OR json_extract(`extra_config`, '$.authType') = 'api_key'
		)
);--> statement-breakpoint
INSERT INTO `account_tokens` (`account_id`, `name`, `token`, `token_group`, `value_status`, `source`, `enabled`, `is_default`)
SELECT `id`, 'default', `access_token`, 'default', 'ready', 'legacy_account_api_key_credential', 1, 1
FROM `accounts`
WHERE trim(COALESCE(`access_token`, '')) <> ''
	AND json_valid(COALESCE(`extra_config`, ''))
	AND (
		json_extract(`extra_config`, '$.credentialMode') = 'apikey'
		OR json_extract(`extra_config`, '$.authType') = 'api_key'
	)
	AND NOT EXISTS (
		SELECT 1 FROM `account_tokens`
		WHERE `account_tokens`.`account_id` = `accounts`.`id`
			AND `account_tokens`.`token` = `accounts`.`access_token`
	);--> statement-breakpoint
UPDATE `account_tokens`
SET `is_default` = 1,
	`enabled` = 1,
	`value_status` = 'ready'
WHERE EXISTS (
	SELECT 1 FROM `accounts`
	WHERE `accounts`.`id` = `account_tokens`.`account_id`
		AND `accounts`.`access_token` = `account_tokens`.`token`
		AND json_valid(COALESCE(`accounts`.`extra_config`, ''))
		AND (
			json_extract(`accounts`.`extra_config`, '$.credentialMode') = 'apikey'
			OR json_extract(`accounts`.`extra_config`, '$.authType') = 'api_key'
		)
);--> statement-breakpoint
ALTER TABLE `accounts` ADD `credential_mode` text DEFAULT 'session' NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `credential` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `credential_kind` text DEFAULT 'adapter_default' NOT NULL;--> statement-breakpoint
UPDATE `accounts`
SET
	`oauth_provider` = COALESCE(
		NULLIF(trim(COALESCE(`oauth_provider`, '')), ''),
		CASE WHEN json_valid(COALESCE(`extra_config`, ''))
			THEN NULLIF(trim(COALESCE(json_extract(`extra_config`, '$.oauth.provider'), '')), '')
		END
	),
	`oauth_account_key` = COALESCE(
		NULLIF(trim(COALESCE(`oauth_account_key`, '')), ''),
		CASE WHEN json_valid(COALESCE(`extra_config`, ''))
			THEN NULLIF(trim(COALESCE(
				json_extract(`extra_config`, '$.oauth.accountKey'),
				json_extract(`extra_config`, '$.oauth.accountId'),
				''
			)), '')
		END
	),
	`oauth_project_id` = COALESCE(
		NULLIF(trim(COALESCE(`oauth_project_id`, '')), ''),
		CASE WHEN json_valid(COALESCE(`extra_config`, ''))
			THEN NULLIF(trim(COALESCE(json_extract(`extra_config`, '$.oauth.projectId'), '')), '')
		END
	),
	`credential_mode` = CASE
		WHEN trim(COALESCE(
			NULLIF(trim(COALESCE(`oauth_provider`, '')), ''),
			CASE WHEN json_valid(COALESCE(`extra_config`, '')) THEN json_extract(`extra_config`, '$.oauth.provider') END,
			''
		)) <> '' THEN 'oauth'
		WHEN json_valid(COALESCE("extra_config", '')) AND json_extract("extra_config", '$.credentialMode') = 'apikey' THEN 'apikey'
		WHEN json_valid(COALESCE("extra_config", '')) AND json_extract("extra_config", '$.authType') = 'api_key' THEN 'apikey'
		WHEN json_valid(COALESCE("extra_config", '')) AND json_extract("extra_config", '$.credentialMode') = 'session' THEN 'session'
		WHEN trim(COALESCE("access_token", '')) = '' THEN 'apikey'
		ELSE 'session'
	END,
	`credential` = CASE
		WHEN (json_valid(COALESCE("extra_config", '')) AND json_extract("extra_config", '$.credentialMode') = 'apikey')
			OR (json_valid(COALESCE("extra_config", '')) AND json_extract("extra_config", '$.authType') = 'api_key')
			OR (trim(COALESCE("oauth_provider", '')) = '' AND trim(COALESCE("access_token", '')) = '') THEN ''
		ELSE "access_token"
	END,
	`credential_kind` = CASE
		WHEN trim(COALESCE(
			NULLIF(trim(COALESCE(`oauth_provider`, '')), ''),
			CASE WHEN json_valid(COALESCE(`extra_config`, '')) THEN json_extract(`extra_config`, '$.oauth.provider') END,
			''
		)) <> '' THEN 'oauth_access_token'
		WHEN (json_valid(COALESCE("extra_config", '')) AND json_extract("extra_config", '$.credentialMode') = 'apikey')
			OR (json_valid(COALESCE("extra_config", '')) AND json_extract("extra_config", '$.authType') = 'api_key')
			OR trim(COALESCE("access_token", '')) = '' THEN 'none'
		ELSE 'adapter_default'
	END,
	`extra_config` = CASE
		WHEN json_valid(COALESCE("extra_config", '')) THEN json_remove(
			"extra_config",
			'$.credentialMode',
			'$.authType',
			'$.oauth.provider',
			'$.oauth.accountId',
			'$.oauth.accountKey',
			'$.oauth.projectId'
		)
		ELSE "extra_config"
	END;--> statement-breakpoint
ALTER TABLE `accounts` DROP COLUMN `access_token`;
