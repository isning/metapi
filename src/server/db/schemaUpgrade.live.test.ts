import currentContract from './generated/schemaContract.json' with { type: 'json' };
import type { SchemaContract } from './schemaContract.js';
import { makeCleanSchemaUpgradeBaselineContract } from './schemaContractTestFixtures.js';
import { applyContractFixtureThenUpgrade, introspectLiveSchema } from './schemaIntrospection.js';
import { describe, expect, it } from 'vitest';

const skipLiveSchema = process.env.DB_PARITY_SKIP_LIVE_SCHEMA === 'true';
const sqliteUpgrade = !skipLiveSchema && process.env.DB_PARITY_SQLITE !== 'false' ? it : it.skip;
const mysqlUpgrade = process.env.DB_PARITY_MYSQL_URL ? it : it.skip;
const postgresUpgrade = process.env.DB_PARITY_POSTGRES_URL ? it : it.skip;
const cleanBaselineContract = makeCleanSchemaUpgradeBaselineContract(currentContract as SchemaContract);
const LIVE_SCHEMA_TIMEOUT_MS = 20_000;

describe('schema upgrade parity', () => {
  sqliteUpgrade('upgrades sqlite to the current contract', async () => {
    const sqliteUrl = await applyContractFixtureThenUpgrade('sqlite', cleanBaselineContract, currentContract as SchemaContract);
    const live = await introspectLiveSchema({ dialect: 'sqlite', connectionString: sqliteUrl });
    expect(live).toEqual(currentContract);
  }, LIVE_SCHEMA_TIMEOUT_MS);

  mysqlUpgrade('upgrades mysql to the current contract', async () => {
    const mysqlUrl = await applyContractFixtureThenUpgrade('mysql', cleanBaselineContract, currentContract as SchemaContract, {
      connectionString: process.env.DB_PARITY_MYSQL_URL!,
    });
    const live = await introspectLiveSchema({ dialect: 'mysql', connectionString: mysqlUrl });
    expect(live).toEqual(currentContract);
  }, LIVE_SCHEMA_TIMEOUT_MS);

  postgresUpgrade('upgrades postgres to the current contract', async () => {
    const postgresUrl = await applyContractFixtureThenUpgrade('postgres', cleanBaselineContract, currentContract as SchemaContract, {
      connectionString: process.env.DB_PARITY_POSTGRES_URL!,
    });
    const live = await introspectLiveSchema({ dialect: 'postgres', connectionString: postgresUrl });
    expect(live).toEqual(currentContract);
  }, LIVE_SCHEMA_TIMEOUT_MS);
});
