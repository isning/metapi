import { writeDialectArtifactFiles } from '../../src/server/db/schemaArtifactGenerator.js';
import { writeSchemaContractFile } from '../../src/server/db/schemaContract.js';

const contract = writeSchemaContractFile();
writeDialectArtifactFiles(contract);
const tableCount = Object.keys(contract.tables).length;

console.log(`[schema:contract] wrote ${tableCount} tables and dialect artifacts`);
