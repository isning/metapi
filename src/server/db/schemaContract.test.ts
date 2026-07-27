import { describe, expect, it } from 'vitest';
import { buildSchemaContractFromSqliteMigrations } from './schemaContract.js';

describe('schema contract generation', () => {
  it('captures the current schema shape from sqlite migrations', () => {
    const contract = buildSchemaContractFromSqliteMigrations();

    expect(contract.tables.sites.columns.status).toMatchObject({
      logicalType: 'text',
      notNull: true,
      primaryKey: false,
    });
    expect(contract.tables.account_tokens.columns.token_group).toBeDefined();
    expect(contract.tables.account_tokens.columns.value_status).toMatchObject({
      logicalType: 'text',
      notNull: true,
      defaultValue: "'ready'",
    });
    expect(contract.tables.site_disabled_models).toBeDefined();
    expect(contract.tables.downstream_api_keys).toBeDefined();
    expect(contract.tables.proxy_files).toBeDefined();
    expect(contract.tables.admin_snapshots.columns.snapshot_key).toMatchObject({
      logicalType: 'text',
      notNull: true,
      primaryKey: false,
    });
    expect(contract.tables.proxy_video_tasks).toBeDefined();
    expect(contract.tables.route_endpoint_targets).toBeUndefined();
    expect(contract.tables.runtime_execution_targets.columns.upstream_model_name).toMatchObject({
      logicalType: 'text',
      notNull: true,
    });
    expect(contract.tables.route_groups).toBeUndefined();
    expect(contract.tables.route_group_candidates).toBeUndefined();
    expect(contract.tables.route_group_fallback_stages).toBeUndefined();
    expect(contract.tables.runtime_execution_target_state.columns.consecutive_fail_count).toMatchObject({
      logicalType: 'integer',
      notNull: true,
      defaultValue: '0',
    });
    expect(contract.tables.sites.columns.use_system_proxy).toMatchObject({
      logicalType: 'boolean',
      defaultValue: 'false',
    });
    expect(contract.tables.route_graph_versions.columns.compiled_graph_json).toBeUndefined();
    expect(contract.tables.compiled_runtime_artifacts.columns.artifact_json).toMatchObject({
      logicalType: 'json',
      notNull: true,
    });
    expect(contract.tables.compiled_runtime_active_artifact.columns.artifact_id).toMatchObject({
      logicalType: 'text',
      notNull: true,
    });
    expect(contract.indexes).toContainEqual(
      expect.objectContaining({ name: 'sites_status_idx', table: 'sites', unique: false }),
    );
    expect(contract.uniques).toContainEqual(
      expect.objectContaining({
        name: 'site_disabled_models_site_model_unique',
        table: 'site_disabled_models',
        columns: ['site_id', 'model_name'],
      }),
    );
    expect(contract.uniques).toContainEqual(
      expect.objectContaining({
        name: 'model_availability_account_model_unique',
        table: 'model_availability',
        columns: ['account_id', 'model_name'],
      }),
    );
    expect(contract.foreignKeys).toContainEqual(
      expect.objectContaining({
        table: 'site_disabled_models',
        columns: ['site_id'],
        referencedTable: 'sites',
        referencedColumns: ['id'],
      }),
    );
    expect(contract.foreignKeys).not.toContainEqual(
      expect.objectContaining({ table: 'route_endpoint_targets' }),
    );
    expect(contract.foreignKeys).toContainEqual(
      expect.objectContaining({
        table: 'runtime_execution_target_state',
        columns: ['execution_target_id'],
        referencedTable: 'runtime_execution_targets',
        referencedColumns: ['id'],
      }),
    );
  });
});
