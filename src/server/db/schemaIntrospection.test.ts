import { describe, expect, it } from 'vitest';
import {
  isMySqlImplicitForeignKeyIndex,
  normalizeDefaultValue,
  normalizeMySqlIndexes,
  normalizeSqlType,
  readMySqlField,
} from './schemaIntrospection.js';

describe('schema introspection normalization', () => {
  it('normalizes booleans consistently across dialects', () => {
    expect(normalizeSqlType('sqlite', 'INTEGER', 'use_system_proxy')).toBe('boolean');
    expect(normalizeSqlType('mysql', 'tinyint', 'use_system_proxy')).toBe('boolean');
    expect(normalizeSqlType('postgres', 'boolean', 'use_system_proxy')).toBe('boolean');
  });

  it('normalizes common default values', () => {
    expect(normalizeDefaultValue("DEFAULT 'active'")).toBe("'active'");
    expect(normalizeDefaultValue('DEFAULT FALSE')).toBe('false');
    expect(normalizeDefaultValue("datetime('now')")).toBe("datetime('now')");
  });

  it('reads mysql information_schema fields regardless of casing', () => {
    expect(readMySqlField({ COLUMN_TYPE: 'varchar(191)' }, 'column_type')).toBe('varchar(191)');
    expect(readMySqlField({ column_type: 'text' }, 'column_type')).toBe('text');
    expect(readMySqlField({ Table_Name: 'settings' }, 'table_name')).toBe('settings');
  });

  it('filters mysql implicit foreign-key indexes from live schema comparisons', () => {
    const foreignKeys = [
      {
        table: 'route_supply_endpoints',
        columns: ['endpoint_profile_id'],
        referencedTable: 'api_endpoint_profiles',
        referencedColumns: ['id'],
        onDelete: 'set null',
      },
      {
        table: 'route_group_candidates',
        columns: ['bucket_id'],
        referencedTable: 'route_group_buckets',
        referencedColumns: ['id'],
        onDelete: 'cascade',
      },
    ];

    expect(isMySqlImplicitForeignKeyIndex({
      name: 'endpoint_profile_id',
      table: 'route_supply_endpoints',
      columns: ['endpoint_profile_id'],
      unique: false,
    }, foreignKeys)).toBe(true);

    expect(normalizeMySqlIndexes([
      {
        name: 'endpoint_profile_id',
        table: 'route_supply_endpoints',
        columns: ['endpoint_profile_id'],
        unique: false,
      },
      {
        name: 'route_supply_endpoints_account_idx',
        table: 'route_supply_endpoints',
        columns: ['account_id', 'enabled'],
        unique: false,
      },
      {
        name: 'route_group_candidates_group_sort_idx',
        table: 'route_group_candidates',
        columns: ['group_id', 'bucket_id', 'sort_order'],
        unique: false,
      },
      {
        name: 'route_supply_endpoints_supply_key_unique',
        table: 'route_supply_endpoints',
        columns: ['supply_key'],
        unique: true,
      },
    ], foreignKeys)).toEqual([
      {
        name: 'route_group_candidates_group_sort_idx',
        table: 'route_group_candidates',
        columns: ['group_id', 'bucket_id', 'sort_order'],
        unique: false,
      },
      {
        name: 'route_supply_endpoints_account_idx',
        table: 'route_supply_endpoints',
        columns: ['account_id', 'enabled'],
        unique: false,
      },
      {
        name: 'route_supply_endpoints_supply_key_unique',
        table: 'route_supply_endpoints',
        columns: ['supply_key'],
        unique: true,
      },
    ]);
  });
});
