import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function readFixture(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), 'src/testing/fixtures', relativePath), 'utf8');
}

export function readJsonFixture<T = unknown>(relativePath: string): T {
  return JSON.parse(readFixture(relativePath)) as T;
}
