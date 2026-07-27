import type { SchemaContract } from './schemaContract.js';

export function makeCleanSchemaUpgradeBaselineContract(currentContract: SchemaContract): SchemaContract {
  const baseline = structuredClone(currentContract) as SchemaContract;

  delete baseline.tables.model_availability?.columns.is_manual;
  baseline.indexes = baseline.indexes.filter((index) => index.name !== 'proxy_files_public_id_unique');
  baseline.uniques = baseline.uniques.filter((unique) => unique.name !== 'proxy_files_public_id_unique');

  return baseline;
}
