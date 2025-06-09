import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { allSteps, loadWorkflow } from './helpers.js';

const wf = loadWorkflow('ci-node.yml');
const steps = allSteps(wf);

/** @param {string} prefix */
const usesStep = (prefix) => steps.find((s) => s.uses?.startsWith(prefix));
/** @param {string} cmd */
const runIndex = (cmd) => steps.findIndex((s) => s.run?.trim() === cmd);

describe('ci-node.yml', () => {
  it('takes pnpm from packageManager, not from a pinned version input', () => {
    const pnpm = usesStep('pnpm/action-setup@');
    assert.ok(pnpm, 'pnpm/action-setup step missing');
    assert.equal(pnpm.with?.version, undefined);
  });

  it('takes Node from the repo .nvmrc', () => {
    const node = usesStep('actions/setup-node@');
    assert.ok(node, 'actions/setup-node step missing');
    assert.match(String(node.with?.['node-version-file']), /\.nvmrc$/);
    assert.equal(node.with?.['node-version'], undefined);
  });

  it('runs make setup, then make ci', () => {
    const setup = runIndex('make setup');
    const ci = runIndex('make ci');
    assert.ok(setup >= 0 && ci > setup, `make setup at ${setup}, make ci at ${ci}`);
  });

  it('sets up pnpm before Node', () => {
    const pnpm = steps.findIndex((s) => s.uses?.startsWith('pnpm/action-setup@'));
    const node = steps.findIndex((s) => s.uses?.startsWith('actions/setup-node@'));
    assert.ok(pnpm < node);
  });

  it('restores the pnpm store before make setup, keyed on the lockfile', () => {
    const cache = steps.findIndex((s) => s.uses?.startsWith('actions/cache@'));
    assert.ok(cache >= 0, 'actions/cache step missing');
    assert.ok(cache < runIndex('make setup'), 'cache must be restored before make setup');
    const { path, key } = /** @type {{ path: string, key: string }} */ (steps[cache].with);
    assert.equal(path, '${{ steps.pnpm-store.outputs.path }}');
    assert.match(key, /hashFiles\(.*pnpm-lock\.yaml/);
  });

  it('uploads coverage even when make ci fails', () => {
    const upload = steps.find((s) => s.name === 'Upload coverage');
    assert.ok(upload, 'coverage upload missing');
    assert.equal(upload.if, 'always()');
  });

  it('checks the coverage floor after make ci, 80% by default', () => {
    const floor = steps.findIndex((s) => s.name === 'Coverage floor');
    assert.ok(floor > runIndex('make ci'), 'coverage floor must run after make ci');
    assert.match(steps[floor].run ?? '', /scripts\/coverage-floor\.js/);
    assert.equal(wf.on.workflow_call.inputs['coverage-floor'].default, 80);
  });

  it('checks out the shared scripts only after make ci', () => {
    const shared = steps.findIndex((s) => s.with?.repository === 'prizmatoo/.github');
    assert.ok(shared > runIndex('make ci'));
  });

  it('uploads the JUnit report as junit-<repo>-<sha>', () => {
    const upload = steps.find((s) => s.name === 'Upload JUnit results');
    assert.equal(upload?.with?.name, 'junit-${{ github.event.repository.name }}-${{ github.sha }}');
    assert.equal(wf.on.workflow_call.inputs['junit-path'].default, 'reports/junit.xml');
  });

  it('does not keep the checkout credentials around', () => {
    const checkout = usesStep('actions/checkout@');
    assert.equal(checkout?.with?.['persist-credentials'], false);
  });
});
