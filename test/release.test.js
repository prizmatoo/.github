import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { WORKFLOWS_DIR, allSteps, loadWorkflow } from './helpers.js';

const wf = loadWorkflow('release.yml');
const steps = allSteps(wf);
const text = readFileSync(join(WORKFLOWS_DIR, 'release.yml'), 'utf8');

/** @param {string} name */
const index = (name) => steps.findIndex((s) => s.name === name);

describe('release.yml', () => {
  it('only runs for v* tags', () => {
    assert.equal(wf.jobs.pack.if, "startsWith(github.ref, 'refs/tags/v')");
  });

  it('checks the tag, runs make ci, then packs', () => {
    const ci = steps.findIndex((s) => s.run?.trim() === 'make ci');
    const tag = index('Check the tag matches package.json');
    const pack = index('npm pack');
    assert.ok(ci >= 0 && tag > ci && pack > tag, `make ci ${ci}, tag ${tag}, pack ${pack}`);
  });

  it('uploads the tarball and the release notes', () => {
    const upload = steps.find((s) => s.uses?.startsWith('actions/upload-artifact@'));
    assert.equal(upload?.with?.['if-no-files-found'], 'error');
    assert.match(String(upload?.with?.name), /steps\.version\.outputs\.version/);
  });

  it('never publishes or creates a release (no-bots rule)', () => {
    for (const step of steps) {
      assert.doesNotMatch(step.run ?? '', /\b(npm|pnpm) publish\b/, step.name);
      assert.doesNotMatch(step.run ?? '', /gh release/, step.name);
      assert.doesNotMatch(step.uses ?? '', /release|publish/i, step.uses);
    }
    assert.doesNotMatch(text, /NODE_AUTH_TOKEN|registry-url/);
  });

  it('keeps contents read-only', () => {
    assert.deepEqual(wf.permissions, { contents: 'read' });
  });
});
