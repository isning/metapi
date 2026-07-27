import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getAbi } from 'node-abi';
import { describe, expect, it } from 'vitest';

describe('desktop Electron ABI support', () => {
  it('resolves the ABI for the packaged Electron version', () => {
    const electronPackage = JSON.parse(
      readFileSync(resolve(process.cwd(), 'node_modules/electron/package.json'), 'utf8'),
    ) as { version: string };

    expect(() => getAbi(electronPackage.version, 'electron')).not.toThrow();
  });
});
