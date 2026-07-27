import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { closeDbConnections } from '../server/db/index.js';
import { publishRouteGraphSource } from '../server/services/routeGraphService.js';

const label = String(process.argv[2] || '').trim();
const barrierPath = String(process.argv[3] || '').trim();
if (!label || !barrierPath) throw new Error('label and barrier path are required');

while (!existsSync(barrierPath)) await sleep(5);

try {
  const result = await publishRouteGraphSource({
    sourceGraph: { nodes: [], edges: [], macros: [], metadata: { publication: label } },
    createdBy: `multi-process:${label}`,
    allowDiagnostics: true,
  });
  process.stdout.write(JSON.stringify({ ok: result.ok, label }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: false,
    label,
    errorName: error instanceof Error ? error.name : 'Error',
  }));
} finally {
  await closeDbConnections();
}
