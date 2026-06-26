import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDialectArtifactFiles } from '../../src/server/db/schemaArtifactGenerator.js';
import {
  type SchemaContract,
  writeSchemaContractFile,
} from '../../src/server/db/schemaContract.js';

function readPreviousSchemaContract(): SchemaContract {
  const dbDir = dirname(fileURLToPath(import.meta.url));
  const fixturePath = resolve(dbDir, '../../src/server/db/generated/fixtures/2026-03-14-baseline.schemaContract.json');
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as SchemaContract;
}

const previousContract = readPreviousSchemaContract();
const contract = writeSchemaContractFile();
writeDialectArtifactFiles(contract, previousContract);
const tableCount = Object.keys(contract.tables).length;

console.log(`[schema:contract] wrote ${tableCount} tables and dialect artifacts`);
