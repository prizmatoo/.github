import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { allSteps, loadWorkflow } from './helpers.js';

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

  it('runs make setup, then make ci', () => {
    const setup = runIndex('make setup');
    assert.ok(setup >= 0 && runIndex('make ci') > setup);
  });

  it('takes the same inputs as ci-node', () => {
    assert.deepEqual(
      Object.keys(py.on.workflow_call.inputs).sort(),
      Object.keys(node.on.workflow_call.inputs).sort(),
    );
  });

  it('keeps the job id so the required check name is the same', () => {
    assert.deepEqual(Object.keys(py.jobs), Object.keys(node.jobs));
  });
});
