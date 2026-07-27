import { describe, expect, it } from 'vitest';
import { ACCOUNT_TOKEN_DATA_COMPATIBILITY_SPECS } from './accountTokenSchemaCompatibility.js';
import { classifySchemaBootstrapMutation } from './schemaBootstrapCompatibility.js';

describe('schema bootstrap compatibility boundary', () => {
  it('allows only explicitly registered bootstrap compatibility statements', () => {
    expect(classifySchemaBootstrapMutation('ALTER TABLE proxy_logs ADD COLUMN billing_details text;')).toBe('forbidden');
    expect(classifySchemaBootstrapMutation('ALTER TABLE proxy_logs ADD COLUMN is_stream integer;')).toBe('forbidden');
    expect(classifySchemaBootstrapMutation('ALTER TABLE proxy_logs ADD COLUMN first_byte_latency_ms integer;')).toBe('forbidden');
    expect(classifySchemaBootstrapMutation('ALTER TABLE proxy_logs ADD COLUMN first_token_latency_ms integer;')).toBe('forbidden');
    expect(classifySchemaBootstrapMutation('ALTER TABLE proxy_logs ADD COLUMN client_app_id text;')).toBe('forbidden');
    expect(classifySchemaBootstrapMutation('CREATE INDEX proxy_logs_client_app_id_created_at_idx ON proxy_logs(client_app_id, created_at);')).toBe('forbidden');
    expect(classifySchemaBootstrapMutation('UPDATE "sites" SET "use_system_proxy" = FALSE WHERE "use_system_proxy" IS NULL')).toBe('registered');
    expect(classifySchemaBootstrapMutation(ACCOUNT_TOKEN_DATA_COMPATIBILITY_SPECS[0]!.sql.sqlite)).toBe('registered');
    expect(classifySchemaBootstrapMutation('ALTER TABLE proxy_logs ADD COLUMN target_id integer;')).toBe('forbidden');
    expect(classifySchemaBootstrapMutation('UPDATE proxy_logs SET target_id = channel_id WHERE target_id IS NULL AND channel_id IS NOT NULL;')).toBe('forbidden');
    expect(classifySchemaBootstrapMutation('ALTER TABLE sites ADD COLUMN brand_new_column text;')).toBe('forbidden');
    expect(classifySchemaBootstrapMutation('UPDATE "sites" SET "brand_new_column" = 1')).toBe('forbidden');
  });
});
