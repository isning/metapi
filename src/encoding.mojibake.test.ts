import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = join(process.cwd(), 'src');
const TEST_FILE = join(SOURCE_ROOT, 'encoding.mojibake.test.ts');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const MOJIBAKE_MARKERS = [
  '娴嬮',
  '婵炴垶',
  '浠婂ぉ宸茬粡',
  '鏃犳潈杩涜',
  '閺冪姵娼堟潻',
];

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      if (entry === 'generated') continue;
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    const extension = fullPath.slice(fullPath.lastIndexOf('.'));
    if (SOURCE_EXTENSIONS.has(extension) && !/\.(?:test|spec)\.[^.]+$/.test(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

describe('source text integrity', () => {
  it('does not contain known mojibake markers', () => {
    const hits: string[] = [];

    for (const file of collectSourceFiles(SOURCE_ROOT)) {
      if (file === TEST_FILE) continue;
      const source = readFileSync(file, 'utf8');
      for (const marker of MOJIBAKE_MARKERS) {
        const markerIndex = source.indexOf(marker);
        if (markerIndex < 0) continue;
        const line = source.slice(0, markerIndex).split(/\r?\n/u).length;
        hits.push(`${relative(process.cwd(), file)}:${line} contains "${marker}"`);
      }
    }

    expect(hits).toEqual([]);
  });
});
