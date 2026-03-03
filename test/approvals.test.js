// .approvals/: this repo's workflow files for approval-router (BTWL-322). The router evaluates its
// registered copy; these checks keep our copy readable for it and say what prod-change is.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parse } from 'yaml';

import { ROOT } from './helpers.js';

/**
 * @typedef {{ name?: string, when: unknown, approvers: { role: string, min: number },
 *   escalate_after?: string, escalation?: string, escalate_to?: string[], notify?: string[] }} Step
 * @typedef {{ workflow: string, description?: string, callback: unknown, steps: Step[] }} WorkflowFile
 */

const DIR = join(ROOT, '.approvals');
const files = readdirSync(DIR).filter((f) => f.endsWith('.yml'));

/** @param {string} file */
const load = (file) => /** @type {WorkflowFile} */ (parse(readFileSync(join(DIR, file), 'utf8')));

describe('.approvals/', () => {
  it('has the prod-change workflow', () => {
    assert.ok(files.includes('prod-change.yml'), files.join(', '));
  });

  for (const file of files) {
    describe(file, () => {
      const wf = load(file);

      it('is named after its file', () => {
        assert.equal(`${wf.workflow}.yml`, file);
      });

      it('says where the outcome goes (a URL per environment, or none)', () => {
        assert.ok(wf.callback !== undefined, 'callback missing');
      });

      it('has steps with a role and at least one approver', () => {
        assert.ok(Array.isArray(wf.steps) && wf.steps.length > 0, 'no steps');
        for (const step of wf.steps) {
          assert.match(step.approvers?.role ?? '', /^[a-z][a-z0-9_]*$/);
          assert.ok(Number.isInteger(step.approvers.min) && step.approvers.min >= 1);
        }
      });
    });
  }
});

describe('prod-change.yml', () => {
  const wf = load('prod-change.yml');

  it('needs one admin for every production deploy, and nobody is called back', () => {
    assert.equal(wf.callback, 'none');
    assert.equal(wf.steps.length, 1);
    assert.equal(wf.steps[0].when, true);
    assert.deepEqual(wf.steps[0].approvers, { role: 'admin', min: 1 });
  });

  it('escalates to the Platform on-call channel', () => {
    assert.equal(
      wf.steps[0].escalation,
      'platform-4h@1',
      '4 business hours, US federal holidays off',
    );
    assert.equal(wf.steps[0].escalate_after, undefined, 'the policy replaces escalate_after');
    assert.deepEqual(wf.steps[0].escalate_to, ['hearth:#platform-oncall']);
    assert.deepEqual(wf.steps[0].notify, ['hearth:#platform-changes']);
  });
});
