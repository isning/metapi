import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

type DbModule = typeof import('../db/index.js');
type ConfigMigrationModule = typeof import('./configMigrationService.js');

describe('configMigrationService', () => {
  let dataDir = '';
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let closeDbConnections: DbModule['closeDbConnections'];
  let ensureCurrentConfigVersion: ConfigMigrationModule['ensureCurrentConfigVersion'];
  let CURRENT_CONFIG_VERSION: ConfigMigrationModule['CURRENT_CONFIG_VERSION'];

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-config-migration-'));
    process.env.DATA_DIR = dataDir;

    await import('../db/migrate.js');
    const dbModule = await import('../db/index.js');
    const migrationModule = await import('./configMigrationService.js');

    db = dbModule.db;
    schema = dbModule.schema;
    closeDbConnections = dbModule.closeDbConnections;
    ensureCurrentConfigVersion = migrationModule.ensureCurrentConfigVersion;
    CURRENT_CONFIG_VERSION = migrationModule.CURRENT_CONFIG_VERSION;
  });

  beforeEach(async () => {
    await db.delete(schema.settings).run();
  });

  afterAll(async () => {
    if (typeof closeDbConnections === 'function') {
      await closeDbConnections();
    }
    if (dataDir) {
      rmSync(dataDir, { recursive: true, force: true });
    }
    delete process.env.DATA_DIR;
  });

  it('seeds current config version and pricing reference defaults for existing installs', async () => {
    const summary = await ensureCurrentConfigVersion();

    expect(summary).toEqual({
      fromVersion: null,
      toVersion: CURRENT_CONFIG_VERSION,
      migrated: true,
      appliedSettings: expect.arrayContaining([
        'metapi_config_version',
        'pricing_reference_config_v1',
        'platform_pricing_config_v1',
      ]),
    });

    const version = await db.select().from(schema.settings)
      .where(eq(schema.settings.key, 'metapi_config_version'))
      .get();
    const pricing = await db.select().from(schema.settings)
      .where(eq(schema.settings.key, 'pricing_reference_config_v1'))
      .get();
    const platformPricing = await db.select().from(schema.settings)
      .where(eq(schema.settings.key, 'platform_pricing_config_v1'))
      .get();

    expect(JSON.parse(version?.value || 'null')).toBe('2.4');
    expect(JSON.parse(pricing?.value || '{}')).toMatchObject({
      schemaVersion: 1,
      sync: {
        enabled: false,
        replaceOnSync: true,
      },
    });
    expect(JSON.parse(pricing?.value || '{}')).not.toHaveProperty('defaultReferenceMode');
    expect(JSON.parse(pricing?.value || '{}')).not.toHaveProperty('fallbackProfile');
    expect(JSON.parse(pricing?.value || '{}')).not.toHaveProperty('driftCheck');
    expect(JSON.parse(platformPricing?.value || '{}')).toMatchObject({
      baseCostUnit: 'USD',
      upstreamDefaultPricing: {
        inputPerMillion: 1,
        outputPerMillion: 1,
      },
      driftCheck: {
        enabled: false,
      },
    });
  });

  it('normalizes existing pricing config while dropping obsolete strategy choices', async () => {
    await db.insert(schema.settings).values([
      { key: 'metapi_config_version', value: JSON.stringify('2.1') },
      { key: 'routing_fallback_unit_cost', value: JSON.stringify(0.25) },
      {
        key: 'pricing_reference_config_v1',
        value: JSON.stringify({
          schemaVersion: 1,
          defaultReferenceMode: 'manual',
          fallbackProfile: 'unknown',
          catalog: {
            builtInCatalogEnabled: false,
          },
          driftCheck: {
            enabled: true,
            windowHours: 48,
          },
        }),
      },
    ]).run();

    const summary = await ensureCurrentConfigVersion();

    expect(summary.fromVersion).toBe('2.1');
    expect(summary.toVersion).toBe('2.4');
    expect(summary.appliedSettings).toEqual(expect.arrayContaining([
      'metapi_config_version',
      'pricing_reference_config_v1',
      'platform_pricing_config_v1',
      'routing_fallback_unit_cost',
    ]));

    const pricing = await db.select().from(schema.settings)
      .where(eq(schema.settings.key, 'pricing_reference_config_v1'))
      .get();
    expect(JSON.parse(pricing?.value || '{}')).toMatchObject({
      sync: {
        enabled: false,
        replaceOnSync: true,
      },
    });
    expect(JSON.parse(pricing?.value || '{}')).not.toHaveProperty('catalog');
    expect(JSON.parse(pricing?.value || '{}')).not.toHaveProperty('defaultReferenceMode');
    expect(JSON.parse(pricing?.value || '{}')).not.toHaveProperty('fallbackProfile');
    expect(JSON.parse(pricing?.value || '{}')).not.toHaveProperty('driftCheck');
    const platformPricing = await db.select().from(schema.settings)
      .where(eq(schema.settings.key, 'platform_pricing_config_v1'))
      .get();
    expect(JSON.parse(platformPricing?.value || '{}')).toMatchObject({
      baseCostUnit: 'USD',
      upstreamDefaultPricing: {
        inputPerMillion: 1,
        outputPerMillion: 1,
      },
      driftCheck: {
        enabled: true,
        windowHours: 48,
        minSampleSize: 20,
      },
    });
  });
});
