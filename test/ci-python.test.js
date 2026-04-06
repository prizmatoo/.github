import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ROOT, allSteps, loadWorkflow } from './helpers.js';

const node = loadWorkflow('ci-node.yml');
const py = loadWorkflow('ci-python.yml');
const steps = allSteps(py);

/** @param {string} cmd */
const runIndex = (cmd) => steps.findIndex((s) => s.run?.trim() === cmd);

describe('ci-python.yml', () => {
  it('installs uv and lets it pick Python from .python-version', () => {
    assert.ok(steps.some((s) => s.uses?.startsWith('astral-sh/setup-uv@')));
    assert.ok(runIndex('uv python install') >= 0);
  });

  it('gives up on a stalled uv cache download after 2 minutes, like ci-node (BTWL-347)', () => {
    const uv = steps.find((s) => s.uses?.startsWith('astral-sh/setup-uv@'));
    assert.equal(Number(uv?.env?.SEGMENT_DOWNLOAD_TIMEOUT_MINS), 2);
  });

  it('checks pyproject.toml, uv.lock and .python-version before anything is installed', () => {
    const check = steps.findIndex((s) => s.name === 'Check the Python project');
    assert.ok(check >= 0 && check < runIndex('uv python install'));
    for (const f of ['pyproject.toml', 'uv.lock', '.python-version']) {
      assert.match(steps[check].run ?? '', new RegExp(f.replace('.', '\\.')));
    }
  });

  it('runs make setup, then make ci', () => {
    const setup = runIndex('make setup');
    assert.ok(setup >= 0 && runIndex('make ci') > setup);
  });

  it('asks ruff for GitHub annotations in make ci', () => {
    const ci = steps.find((s) => s.run?.trim() === 'make ci');
    assert.equal(ci?.env?.RUFF_OUTPUT_FORMAT, 'github');
  });

  it('takes the same inputs as ci-node', () => {
    assert.deepEqual(
      Object.keys(py.on.workflow_call.inputs).sort(),
      Object.keys(node.on.workflow_call.inputs).sort(),
    );
  });

  it('uploads JUnit exactly like ci-node', () => {
    /** @param {import('./helpers.js').Workflow} wf */
    const junit = (wf) => allSteps(wf).find((s) => s.name === 'Upload JUnit results');
    assert.deepEqual(junit(py), junit(node));
  });

  it("keeps main's coverage summary and compares with it exactly like ci-node (BTWL-424)", () => {
    /** @param {import('./helpers.js').Workflow} wf */
    const coverage = (wf) =>
      allSteps(wf).filter((s) => /coverage summary$|^Coverage floor$/.test(s.name ?? ''));
    assert.equal(coverage(py).length, 4);
    assert.deepEqual(coverage(py), coverage(node));
  });

  it('keeps the job id so the required check name is the same', () => {
    assert.deepEqual(Object.keys(py.jobs), Object.keys(node.jobs));
  });
});

describe('ci-python-sample.yml', () => {
  const sample = loadWorkflow('ci-python-sample.yml');

  it('runs ci-python.yml from the same commit on the sample project', () => {
    const job = sample.jobs.ci;
    assert.equal(job.uses, './.github/workflows/ci-python.yml');
    assert.equal(job.with?.['working-directory'], 'test/fixtures/python-sample');
    assert.match(String(job.with?.['shared-ci-ref']), /pull_request\.head\.sha/);
  });

  it('runs on every PR and on main', () => {
    assert.ok('pull_request' in sample.on);
    assert.deepEqual(sample.on.push?.branches, ['main']);
  });
});

// The sample project ci-python-sample.yml runs; it has to look like a real Python repo.
describe('test/fixtures/python-sample', () => {
  const dir = join(ROOT, 'test', 'fixtures', 'python-sample');
  /** @param {string} f */
  const read = (f) => readFileSync(join(dir, f), 'utf8');
  const inputs = py.on.workflow_call.inputs;

  it('pins Python 3.12 and commits its lockfile', () => {
    assert.equal(read('.python-version').trim(), '3.12');
    assert.match(read('uv.lock'), /^requires-python = "==3\.12\.\*"$/m);
  });

  it('has the gate targets, with make setup from the lockfile', () => {
    const makefile = read('Makefile');
    for (const target of ['setup', 'lint', 'typecheck', 'test', 'build', 'ci']) {
      assert.match(makefile, new RegExp(`^${target}:`, 'm'), target);
    }
    assert.match(makefile, /^setup:\n\tuv sync --frozen$/m);
  });

  it('writes JUnit and the coverage summary where ci-python looks for them', () => {
    const pyproject = read('pyproject.toml');
    assert.match(pyproject, new RegExp(`--junitxml=${inputs['junit-path'].default}`));
    assert.match(pyproject, new RegExp(`--cov-report=json:${inputs['coverage-summary'].default}`));
  });

  it('keeps JUnit ids as Xray reads them and coverage on lines only', () => {
    const pyproject = read('pyproject.toml');
    assert.match(pyproject, /^junit_family = "xunit2"$/m);
    assert.doesNotMatch(pyproject, /^branch = true$/m);
  });
});
