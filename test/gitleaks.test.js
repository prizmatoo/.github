import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { annotation, main, parseReport } from '../scripts/gitleaks-annotate.js';
import { allSteps, loadWorkflow } from './helpers.js';

// Shape of a gitleaks 8.x JSON report entry, run with --redact.
const finding = {
  Description: 'Identified a pattern that may indicate AWS credentials',
  StartLine: 12,
  EndLine: 12,
  File: 'src/config/aws.ts',
  Commit: '3f9c2a41d7be0e6a1c55f0d1a9b3e2c47d8a6f10',
  Secret: 'REDACTED',
  Match: 'REDACTED',
  RuleID: 'aws-access-token',
  Fingerprint: '3f9c2a41d7be0e6a1c55f0d1a9b3e2c47d8a6f10:src/config/aws.ts:aws-access-token:12',
};

/** @param {unknown} data */
function reportFile(data) {
  const dir = mkdtempSync(join(tmpdir(), 'gitleaks-'));
  const path = join(dir, 'gitleaks.json');
  writeFileSync(path, JSON.stringify(data));
  return path;
}

/** @param {() => number} fn */
function run(fn) {
  const lines = /** @type {string[]} */ ([]);
  const orig = console.log;
  console.log = (/** @type {unknown[]} */ ...args) => void lines.push(args.join(' '));
  try {
    return { code: fn(), out: lines.join('\n') };
  } finally {
    console.log = orig;
  }
}

describe('gitleaks-annotate', () => {
  it('annotates the finding on its file and line', () => {
    assert.equal(
      annotation(finding),
      '::error file=src/config/aws.ts,line=12,title=gitleaks::possible secret, aws-access-token: ' +
        'Identified a pattern that may indicate AWS credentials (commit 3f9c2a41)',
    );
  });

  it('fails and names file and line when there are findings', () => {
    const { code, out } = run(() => main([reportFile([finding])]));
    assert.equal(code, 1);
    assert.match(out, /^src\/config\/aws\.ts:12 {2}aws-access-token$/m);
    assert.match(out, /gitleaks: 1 finding\(s\)/);
  });

  it('passes on an empty report (nothing found, or everything allowlisted)', () => {
    const { code, out } = run(() => main([reportFile([])]));
    assert.equal(code, 0);
    assert.doesNotMatch(out, /::error/);
  });

  it('rejects a report that is not an array', () => {
    assert.throws(() => parseReport('{"findings": []}'), /not a JSON array/);
  });
});

describe('gitleaks.yml', () => {
  const steps = allSteps(loadWorkflow('gitleaks.yml'));
  const install = steps.find((s) => s.name === 'Install gitleaks');
  const scan = steps.find((s) => s.name === 'Scan commits');

  it('verifies the downloaded release against its checksums', () => {
    assert.match(install?.run ?? '', /sha256sum -c/);
  });

  it("uses the repo's .gitleaks.toml when there is one", () => {
    assert.match(scan?.run ?? '', /--config \.gitleaks\.toml/);
  });

  it('redacts secrets in its output', () => {
    assert.match(scan?.run ?? '', /--redact/);
  });

  it('fails through the annotate script', () => {
    assert.match(scan?.run ?? '', /scripts\/gitleaks-annotate\.js/);
  });

  it('checks out full history so the PR range can be scanned', () => {
    const checkout = steps.find((s) => s.uses?.startsWith('actions/checkout@') && !s.with?.path);
    assert.equal(checkout?.with?.['fetch-depth'], 0);
  });
});
