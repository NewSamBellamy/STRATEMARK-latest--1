import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

interface DesktopPackageJson {
  repository?: string;
  build?: { publish?: { provider?: string; owner?: string; repo?: string } };
}

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as DesktopPackageJson;

// The repo the app's Settings "Source code" link points to. Installers are
// published from here, so electron-builder's publish target must match it.
const RELEASE_OWNER = 'NewSamBellamy';
const RELEASE_REPO = 'STRATEMARK-latest--1';

describe('desktop release config', () => {
  it('publishes to the Stratemark repo, not a fork or another owner', () => {
    const publish = pkg.build?.publish;
    expect(publish?.provider).toBe('github');
    expect(publish?.owner).toBe(RELEASE_OWNER);
    expect(publish?.repo).toBe(RELEASE_REPO);
  });

  it('package repository field matches the publish target', () => {
    expect(pkg.repository).toBe(`https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}`);
  });
});
