export type AccountTokenSchemaDialect = 'sqlite' | 'mysql' | 'postgres';

export interface AccountTokenSchemaInspector {
  dialect: AccountTokenSchemaDialect;
  tableExists(table: string): Promise<boolean>;
  columnExists(table: string, column: string): Promise<boolean>;
  execute(sqlText: string): Promise<void>;
}

export type AccountTokenColumnCompatibilitySpec = {
  table: 'account_tokens';
  column: string;
  addSql: Record<AccountTokenSchemaDialect, string>;
};

export type AccountTokenDataCompatibilitySpec = {
  requiredTables: ['accounts', 'account_tokens'];
  sql: Record<AccountTokenSchemaDialect, string>;
};

export const ACCOUNT_TOKEN_COLUMN_COMPATIBILITY_SPECS: AccountTokenColumnCompatibilitySpec[] = [
  {
    table: 'account_tokens',
    column: 'token_group',
    addSql: {
      sqlite: 'ALTER TABLE account_tokens ADD COLUMN token_group text;',
      mysql: 'ALTER TABLE `account_tokens` ADD COLUMN `token_group` TEXT NULL',
      postgres: 'ALTER TABLE "account_tokens" ADD COLUMN "token_group" TEXT',
    },
  },
  {
    table: 'account_tokens',
    column: 'value_status',
    addSql: {
      sqlite: "ALTER TABLE account_tokens ADD COLUMN value_status text NOT NULL DEFAULT 'ready';",
      mysql: "ALTER TABLE `account_tokens` ADD COLUMN `value_status` VARCHAR(191) NOT NULL DEFAULT 'ready'",
      postgres: "ALTER TABLE \"account_tokens\" ADD COLUMN \"value_status\" TEXT NOT NULL DEFAULT 'ready'",
    },
  },
  {
    table: 'account_tokens',
    column: 'compatibility_policy',
    addSql: {
      sqlite: 'ALTER TABLE account_tokens ADD COLUMN compatibility_policy text;',
      mysql: 'ALTER TABLE `account_tokens` ADD COLUMN `compatibility_policy` TEXT NULL',
      postgres: 'ALTER TABLE "account_tokens" ADD COLUMN "compatibility_policy" TEXT',
    },
  },
];

export const ACCOUNT_TOKEN_DATA_COMPATIBILITY_SPECS: AccountTokenDataCompatibilitySpec[] = [
  {
    requiredTables: ['accounts', 'account_tokens'],
    sql: {
      sqlite: `
        INSERT INTO account_tokens (account_id, name, token, source, enabled, is_default, created_at, updated_at)
        SELECT
          a.id,
          'default',
          a.api_token,
          'migration',
          true,
          true,
          datetime('now'),
          datetime('now')
        FROM accounts AS a
        WHERE
          a.api_token IS NOT NULL
          AND trim(a.api_token) <> ''
          AND a.access_token IS NOT NULL
          AND trim(a.access_token) <> ''
          AND NOT EXISTS (
            SELECT 1 FROM account_tokens AS t
            WHERE t.account_id = a.id
            AND t.token = a.api_token
          );
      `,
      mysql: `
        INSERT INTO \`account_tokens\` (\`account_id\`, \`name\`, \`token\`, \`source\`, \`enabled\`, \`is_default\`, \`created_at\`, \`updated_at\`)
        SELECT
          a.\`id\`,
          'default',
          a.\`api_token\`,
          'migration',
          true,
          true,
          DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s'),
          DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s')
        FROM \`accounts\` AS a
        WHERE
          a.\`api_token\` IS NOT NULL
          AND TRIM(a.\`api_token\`) <> ''
          AND a.\`access_token\` IS NOT NULL
          AND TRIM(a.\`access_token\`) <> ''
          AND NOT EXISTS (
            SELECT 1 FROM \`account_tokens\` AS t
            WHERE t.\`account_id\` = a.\`id\`
            AND t.\`token\` = a.\`api_token\`
          )
      `,
      postgres: `
        INSERT INTO "account_tokens" ("account_id", "name", "token", "source", "enabled", "is_default", "created_at", "updated_at")
        SELECT
          a."id",
          'default',
          a."api_token",
          'migration',
          true,
          true,
          to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS'),
          to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS')
        FROM "accounts" AS a
        WHERE
          a."api_token" IS NOT NULL
          AND TRIM(a."api_token") <> ''
          AND a."access_token" IS NOT NULL
          AND TRIM(a."access_token") <> ''
          AND NOT EXISTS (
            SELECT 1 FROM "account_tokens" AS t
            WHERE t."account_id" = a."id"
            AND t."token" = a."api_token"
          )
      `,
    },
  },
];

function normalizeSchemaErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message || '');
  }
  return String(error || '');
}

function isDuplicateColumnError(error: unknown): boolean {
  const lowered = normalizeSchemaErrorMessage(error).toLowerCase();
  return lowered.includes('duplicate column')
    || lowered.includes('already exists')
    || lowered.includes('duplicate column name');
}

async function executeAddColumn(inspector: AccountTokenSchemaInspector, sqlText: string): Promise<void> {
  try {
    await inspector.execute(sqlText);
  } catch (error) {
    if (!isDuplicateColumnError(error)) {
      throw error;
    }
  }
}

export async function ensureAccountTokenSchemaCompatibility(inspector: AccountTokenSchemaInspector): Promise<void> {
  for (const spec of ACCOUNT_TOKEN_COLUMN_COMPATIBILITY_SPECS) {
    const hasTable = await inspector.tableExists(spec.table);
    if (!hasTable) {
      continue;
    }

    const hasColumn = await inspector.columnExists(spec.table, spec.column);
    if (!hasColumn) {
      await executeAddColumn(inspector, spec.addSql[inspector.dialect]);
    }
  }

  for (const spec of ACCOUNT_TOKEN_DATA_COMPATIBILITY_SPECS) {
    const hasRequiredTables = await Promise.all(
      spec.requiredTables.map((table) => inspector.tableExists(table)),
    );
    if (hasRequiredTables.every(Boolean)) {
      await inspector.execute(spec.sql[inspector.dialect]);
    }
  }
}
