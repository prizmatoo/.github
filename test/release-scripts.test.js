import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { main as notesMain, section } from '../scripts/changelog-section.js';
import { checkTag, main as tagMain } from '../scripts/tag-version.js';

const CHANGELOG = `# Changelog

## [Unreleased]

## [1.0.0] - 2025-02-25

### Added

- \`Money\` in integer minor units (BTWL-36).
- \`quote()\` with line-level half-up rounding.

## [0.9.0] - 2025-02-11

### Added

- Zones.

[1.0.0]: https://github.com/prizmatoo/btwl-pricing-lib/releases/tag/v1.0.0
`;

/** @param {() => number} fn */
function quiet(fn) {
  const out = /** @type {string[]} */ ([]);
  const [log, err] = [console.log, console.error];
  console.log = console.error = (/** @type {unknown[]} */ ...a) => void out.push(a.join(' '));
  try {
    return { code: fn(), out: out.join('\n') };
  } finally {
    [console.log, console.error] = [log, err];
  }
}

describe('checkTag', () => {
  it('accepts v<version> matching package.json', () => {
    assert.deepEqual(checkTag('v1.0.0', { version: '1.0.0' }), { ok: true, version: '1.0.0' });
  });

  it('accepts a pre-release tag', () => {
    assert.equal(checkTag('v1.1.0-rc.1', { version: '1.1.0-rc.1' }).ok, true);
  });

  it('rejects a tag that does not match package.json', () => {
    const r = checkTag('v1.0.1', { version: '1.0.0' });
    assert.equal(r.ok, false);
  });

  for (const tag of ['1.0.0', 'v1.0', 'release-1.0.0']) {
    it(`rejects "${tag}"`, () => assert.equal(checkTag(tag, { version: '1.0.0' }).ok, false));
  }
});

describe('tag-version main', () => {
  it('writes name and version to GITHUB_OUTPUT', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-'));
    const pkg = join(dir, 'package.json');
    const output = join(dir, 'output');
    writeFileSync(pkg, JSON.stringify({ name: '@btwl/pricing', version: '1.0.0' }));
    writeFileSync(output, '');
    const { code } = quiet(() => tagMain(['v1.0.0', pkg], { GITHUB_OUTPUT: output }));
    assert.equal(code, 0);
    assert.equal(readFileSync(output, 'utf8'), 'name=@btwl/pricing\nversion=1.0.0\n');
  });

  it('fails on a mismatch', () => {
    const pkg = join(mkdtempSync(join(tmpdir(), 'release-')), 'package.json');
    writeFileSync(pkg, JSON.stringify({ name: '@btwl/pricing', version: '1.0.0' }));
    const { code, out } = quiet(() => tagMain(['v1.1.0', pkg], {}));
    assert.equal(code, 1);
    assert.match(out, /does not match package\.json version 1\.0\.0/);
  });

  it('rejects a missing tag argument', () => {
    assert.equal(quiet(() => tagMain([], {})).code, 2);
  });
});

describe('section', () => {
  it('returns the body of one version, up to the next heading', () => {
    assert.equal(
      section(CHANGELOG, '1.0.0'),
      '### Added\n\n- `Money` in integer minor units (BTWL-36).\n- `quote()` with line-level half-up rounding.',
    );
  });

  it('stops at the link references for the last version', () => {
    assert.equal(section(CHANGELOG, '0.9.0'), '### Added\n\n- Zones.');
  });

  it('matches the whole version, not the tail of 10.0.0', () => {
    assert.equal(section('## [10.0.0]\n\n- x\n', '0.0.0'), undefined);
  });

  it('returns undefined for a version without a section', () => {
    assert.equal(section(CHANGELOG, '2.0.0'), undefined);
  });
});

describe('changelog-section main', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'changelog-')), 'CHANGELOG.md');
  writeFileSync(path, CHANGELOG);

  it('prints the section', () => {
    const { code, out } = quiet(() => notesMain([path, '0.9.0']));
    assert.equal(code, 0);
    assert.equal(out, '### Added\n\n- Zones.');
  });

  it('fails when the version has no section', () => {
    const { code, out } = quiet(() => notesMain([path, '2.0.0']));
    assert.equal(code, 1);
    assert.match(out, /has no "## \[2\.0\.0\]" section/);
  });

  it('rejects missing arguments', () => {
    assert.equal(quiet(() => notesMain([path])).code, 2);
  });
});
