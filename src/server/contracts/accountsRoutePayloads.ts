import { z } from 'zod';

const accountCredentialKindSchema = z.enum([
  'session_cookie',
  'access_token',
]);

const LEGACY_ACCOUNT_CREDENTIAL_FIELDS = new Set([
  'accessToken',
  'apiToken',
  'cred',
  'modelApiKey',
  'managementApiToken',
  'refreshToken',
  'tokenExpiresAt',
]);

const accountCreatePayloadSchema = z.object({
  siteId: z.number().int().positive(),
  username: z.string().optional(),
  credential: z.string().optional(),
  credentialKind: accountCredentialKindSchema.optional(),
  apiKey: z.string().optional(),
  platformUserId: z.number().int().positive().optional(),
  checkinEnabled: z.boolean().optional(),
  connectionValues: z.record(z.string(), z.unknown()).optional(),
  skipModelFetch: z.boolean().optional(),
}).passthrough();

const accountUpdatePayloadSchema = z.object({
  username: z.string().optional(),
  credential: z.string().optional(),
  credentialKind: accountCredentialKindSchema.optional(),
  status: z.string().optional(),
  checkinEnabled: z.boolean().optional(),
  unitCost: z.union([z.number(), z.null()]).optional(),
  extraConfig: z.union([z.string(), z.record(z.string(), z.unknown()), z.null()]).optional(),
  isPinned: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  proxyUrl: z.union([z.string(), z.null()]).optional(),
  connectionValues: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const accountBatchPayloadSchema = z.object({
  ids: z.array(z.number().int().positive()).optional(),
  action: z.string().optional(),
}).passthrough();

const accountRebindSessionPayloadSchema = z.object({
  credential: z.string().optional(),
  credentialKind: accountCredentialKindSchema.optional(),
  platformUserId: z.number().int().positive().optional(),
  connectionValues: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const accountHealthRefreshPayloadSchema = z.object({
  accountId: z.number().int().positive().optional(),
  wait: z.boolean().optional(),
}).passthrough();

const accountLoginPayloadSchema = z.object({
  siteId: z.number().int().positive(),
  username: z.string(),
  password: z.string(),
}).passthrough();

const accountVerifyTokenPayloadSchema = z.object({
  siteId: z.number().int().positive(),
  credential: z.string().optional(),
  credentialKind: accountCredentialKindSchema.optional(),
  platformUserId: z.number().int().positive().optional(),
  connectionValues: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const accountManualModelsPayloadSchema = z.object({
  models: z.array(z.string()).optional(),
}).passthrough();

export type AccountBatchPayload = z.output<typeof accountBatchPayloadSchema>;
export type AccountCreatePayload = z.output<typeof accountCreatePayloadSchema>;
export type AccountHealthRefreshPayload = z.output<typeof accountHealthRefreshPayloadSchema>;
export type AccountLoginPayload = z.output<typeof accountLoginPayloadSchema>;
export type AccountManualModelsPayload = z.output<typeof accountManualModelsPayloadSchema>;
export type AccountRebindSessionPayload = z.output<typeof accountRebindSessionPayloadSchema>;
export type AccountUpdatePayload = z.output<typeof accountUpdatePayloadSchema>;
export type AccountVerifyTokenPayload = z.output<typeof accountVerifyTokenPayloadSchema>;

function normalizeAccountsPayloadInput(input: unknown): unknown {
  return input === undefined ? {} : input;
}

function formatAccountsPayloadError(error: z.ZodError): string {
  const firstIssue = error.issues[0];
  const firstPath = firstIssue?.path[0];
  if (firstPath === 'siteId') {
    return 'Invalid siteId. Expected positive number.';
  }
  if (firstPath === 'credential') {
    return 'Invalid credential. Expected string.';
  }
  if (firstPath === 'username') {
    return 'Invalid username. Expected string.';
  }
  if (firstPath === 'password') {
    return 'Invalid password. Expected string.';
  }
  if (firstPath === 'apiKey') {
    return 'Invalid apiKey. Expected string.';
  }
  if (firstPath === 'checkinEnabled') {
    return 'Invalid checkinEnabled. Expected boolean.';
  }
  if (firstPath === 'unitCost') {
    return 'Invalid unitCost. Expected number or null.';
  }
  if (firstPath === 'credentialKind') {
    return 'Invalid credentialKind.';
  }
  if (firstPath === 'skipModelFetch') {
    return 'Invalid skipModelFetch. Expected boolean.';
  }
  if (firstPath === 'isPinned') {
    return 'Invalid isPinned. Expected boolean.';
  }
  if (firstPath === 'sortOrder') {
    return 'Invalid sortOrder. Expected non-negative integer.';
  }
  if (firstPath === 'proxyUrl') {
    return 'Invalid proxyUrl. Expected string or null.';
  }
  if (firstPath === 'ids') {
    return 'Invalid ids. Expected number[].';
  }
  if (firstPath === 'action') {
    return 'Invalid action. Expected string.';
  }
  if (firstPath === 'platformUserId') {
    return 'Invalid platformUserId. Expected positive number.';
  }
  if (firstPath === 'accountId') {
    return '账号 ID 无效';
  }
  if (firstPath === 'wait') {
    return 'Invalid wait. Expected boolean.';
  }
  if (firstPath === 'models') {
    return 'Invalid models. Expected string[].';
  }
  return 'Invalid account payload.';
}

function parseAccountsPayload<T>(schema: z.ZodType<T>, input: unknown):
{ success: true; data: T } | { success: false; error: string } {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const legacyField = Object.keys(input).find((key) => LEGACY_ACCOUNT_CREDENTIAL_FIELDS.has(key));
    if (legacyField) {
      return {
        success: false,
        error: `Unsupported legacy account field "${legacyField}". Use "credential" for connection credentials, "apiKey" for model keys, or "connectionValues" for adapter connection fields.`,
      };
    }
  }
  const result = schema.safeParse(normalizeAccountsPayloadInput(input));
  if (!result.success) {
    return {
      success: false,
      error: formatAccountsPayloadError(result.error),
    };
  }
  return {
    success: true,
    data: result.data,
  };
}

export function parseAccountCreatePayload(input: unknown):
{ success: true; data: AccountCreatePayload } | { success: false; error: string } {
  if (input && typeof input === 'object' && !Array.isArray(input) && 'credentialMode' in input) {
    return {
      success: false,
      error: 'Account creation derives its credential type from credential or apiKey.',
    };
  }
  const parsed = parseAccountsPayload(accountCreatePayloadSchema, input);
  if (!parsed.success) return parsed;
  if (parsed.data.credential?.trim() && parsed.data.apiKey?.trim()) {
    return {
      success: false,
      error: '请只填写连接凭据或模型调用 Key 其中一种。',
    };
  }
  return parsed;
}

export function parseAccountUpdatePayload(input: unknown):
{ success: true; data: AccountUpdatePayload } | { success: false; error: string } {
  return parseAccountsPayload(accountUpdatePayloadSchema, input);
}

export function parseAccountBatchPayload(input: unknown):
{ success: true; data: AccountBatchPayload } | { success: false; error: string } {
  return parseAccountsPayload(accountBatchPayloadSchema, input);
}

export function parseAccountRebindSessionPayload(input: unknown):
{ success: true; data: AccountRebindSessionPayload } | { success: false; error: string } {
  return parseAccountsPayload(accountRebindSessionPayloadSchema, input);
}

export function parseAccountHealthRefreshPayload(input: unknown):
{ success: true; data: AccountHealthRefreshPayload } | { success: false; error: string } {
  return parseAccountsPayload(accountHealthRefreshPayloadSchema, input);
}

export function parseAccountLoginPayload(input: unknown):
{ success: true; data: AccountLoginPayload } | { success: false; error: string } {
  return parseAccountsPayload(accountLoginPayloadSchema, input);
}

export function parseAccountVerifyTokenPayload(input: unknown):
{ success: true; data: AccountVerifyTokenPayload } | { success: false; error: string } {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    if ('apiKey' in record || 'credentialMode' in record) {
      return {
        success: false,
        error: 'Connection credential verification only accepts credential and credentialKind.',
      };
    }
  }
  return parseAccountsPayload(accountVerifyTokenPayloadSchema, input);
}

export function parseAccountManualModelsPayload(input: unknown):
{ success: true; data: AccountManualModelsPayload } | { success: false; error: string } {
  return parseAccountsPayload(accountManualModelsPayloadSchema, input);
}
