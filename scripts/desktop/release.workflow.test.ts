import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('release workflow', () => {
  it('builds macOS arm64 and x64 on dedicated runners and verifies packaged app architecture', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8');

    expect(workflow).toContain('runner: macos-15-intel');
    expect(workflow).toContain('runner: macos-15');
    expect(workflow).toContain('expectedMacArch: x64');
    expect(workflow).toContain('expectedMacArch: arm64');
    expect(workflow).toContain('Verify packaged macOS architecture');
    expect(workflow).toContain('node scripts/desktop/verifyMacArchitecture.mjs');
  });

  it('uploads Linux desktop artifacts for AppImage, deb, and rpm packages', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8');

    expect(workflow).toContain('release/*.AppImage');
    expect(workflow).toContain('release/*.deb');
    expect(workflow).toContain('release/*.rpm');
  });

  it('installs rpm tooling on Linux runners before packaging Fedora desktop artifacts', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8');

    expect(workflow).toContain("if: runner.os == 'Linux'");
    expect(workflow).toContain('sudo apt-get install --no-install-recommends -y rpm');
  });

  it('uses Electron Builder environment variables without passing unsupported npm config', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8');

    expect(workflow).toContain('ELECTRON_BUILDER_BINARIES_MIRROR');
    expect(workflow).not.toContain('npm_config_electron_builder_binaries_mirror');
  });
});
