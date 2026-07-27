import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bootIsolatedRuntimeDb,
  type IsolatedRuntimeDbHandle,
} from '../../testing/dbHarness.js';

type DbModule = typeof import('../db/index.js');
type FxRateServiceModule = typeof import('./fxRateService.js');

describe('fxRateService', () => {
  let runtimeDb: IsolatedRuntimeDbHandle;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let createFxRateSnapshot: FxRateServiceModule['createFxRateSnapshot'];
  let updateFxRateSnapshot: FxRateServiceModule['updateFxRateSnapshot'];
  let deleteFxRateSnapshot: FxRateServiceModule['deleteFxRateSnapshot'];
  let listFxRateSnapshots: FxRateServiceModule['listFxRateSnapshots'];

  beforeAll(async () => {
    runtimeDb = await bootIsolatedRuntimeDb('metapi-fx-rate-service-');
    db = runtimeDb.dbModule.db;
    schema = runtimeDb.dbModule.schema;
    const service = await import('./fxRateService.js');
    createFxRateSnapshot = service.createFxRateSnapshot;
    updateFxRateSnapshot = service.updateFxRateSnapshot;
    deleteFxRateSnapshot = service.deleteFxRateSnapshot;
    listFxRateSnapshots = service.listFxRateSnapshots;
  });

  beforeEach(async () => {
    await db.delete(schema.fxRateSnapshots).run();
  });

  afterAll(async () => {
    await runtimeDb.cleanup();
  });

  it('rejects identity conversions because same-unit rates are implicit', async () => {
    await expect(createFxRateSnapshot({
      fromCurrency: 'USD',
      toCurrency: 'usd',
      rate: 1,
    })).rejects.toThrow('must use different units');

    await expect(listFxRateSnapshots()).resolves.toHaveLength(0);
  });

  it('rejects duplicate conversion pairs on create and update', async () => {
    const created = await createFxRateSnapshot({
      fromCurrency: 'usd',
      toCurrency: 'cny',
      rate: 7.2,
    });
    expect(created).toMatchObject({
      fromCurrency: 'CNY',
      toCurrency: 'USD',
      rate: 1 / 7.2,
    });

    await expect(createFxRateSnapshot({
      fromCurrency: 'USD',
      toCurrency: 'CNY',
      rate: 7.3,
    })).rejects.toThrow('already exists');

    const second = await createFxRateSnapshot({
      fromCurrency: 'EUR',
      toCurrency: 'USD',
      rate: 1.1,
    });
    await expect(updateFxRateSnapshot(second.id, {
      fromCurrency: 'USD',
      toCurrency: 'CNY',
    })).rejects.toThrow('already exists');

    await expect(listFxRateSnapshots()).resolves.toHaveLength(2);
  });

  it('canonicalizes conversion pairs and resolves requested direction by direct or inverse rate', async () => {
    const created = await createFxRateSnapshot({
      fromCurrency: 'USD',
      toCurrency: 'CNY',
      rate: 7.2,
    });
    expect(created).toMatchObject({
      fromCurrency: 'CNY',
      toCurrency: 'USD',
      rate: 1 / 7.2,
    });

    const resolved = await (await import('./fxRateService.js')).resolveFxRate({
      fromCurrency: 'CNY',
      toCurrency: 'USD',
    });
    expect(resolved).toMatchObject({
      rate: {
        fromCurrency: 'CNY',
        toCurrency: 'USD',
        rate: created.rate,
        source: 'manual',
        snapshotId: created.id,
      },
      diagnostics: [],
    });

    const reverseResolved = await (await import('./fxRateService.js')).resolveFxRate({
      fromCurrency: 'USD',
      toCurrency: 'CNY',
    });
    expect(reverseResolved.diagnostics).toEqual([]);
    expect(reverseResolved.rate).toMatchObject({
      fromCurrency: 'USD',
      toCurrency: 'CNY',
      source: 'manual',
      snapshotId: created.id,
    });
    expect(reverseResolved.rate?.rate).toBeCloseTo(7.2);
  });

  it('stores reverse input in canonical direction with inverted rate', async () => {
    const created = await createFxRateSnapshot({
      fromCurrency: 'USD',
      toCurrency: 'CNY',
      rate: 7.2,
    });
    await deleteFxRateSnapshot(created.id);

    const reverseInput = await createFxRateSnapshot({
      fromCurrency: 'CNY',
      toCurrency: 'USD',
      rate: 0.125,
    });

    expect(reverseInput).toMatchObject({
      fromCurrency: 'CNY',
      toCurrency: 'USD',
      rate: 0.125,
    });
    const resolved = await (await import('./fxRateService.js')).resolveFxRate({
      fromCurrency: 'USD',
      toCurrency: 'CNY',
    });
    expect(resolved.rate?.rate).toBe(8);
  });
});
