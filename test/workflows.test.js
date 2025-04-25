// Structural checks over every workflow in .github/workflows.
// These are the rules from the ENG handbook that we want enforced, not just written down.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ROOT, allSteps, isReusable, loadWorkflow, loadWorkflows } from './helpers.js';

const workflows = loadWorkflows();

// GITHUB_TOKEN is for reading and for reporting checks, nothing else.
const WRITABLE = new Set(['checks', 'statuses']);

/**
 * @param {Record<string, string> | string | undefined} perms
 * @returns {string[]}
 */
function permissionProblems(perms) {
  if (perms === undefined) return [];
  if (typeof perms === 'string') return perms === 'read-all' ? [] : [`permissions: ${perms}`];
  return Object.entries(perms)
    .filter(([scope, level]) => !(level === 'read' || level === 'none' || WRITABLE.has(scope)))
    .map(([scope, level]) => `${scope}: ${level}`);
}

describe('workflows', () => {
  it('finds workflows to check', () => {
    assert.ok(workflows.length > 0);
  });

  for (const { file, wf } of workflows) {
    describe(file, () => {
      it('has a name, triggers and jobs', () => {
        assert.equal(typeof wf.name, 'string');
        assert.ok(wf.on && typeof wf.on === 'object', 'on: must be a mapping');
        assert.ok(Object.keys(wf.jobs ?? {}).length > 0, 'no jobs');
      });

      it('declares top-level permissions, read-only apart from checks/statuses', () => {
        assert.ok(wf.permissions !== undefined, 'top-level permissions missing');
        assert.deepEqual(permissionProblems(wf.permissions), []);
        for (const [id, job] of Object.entries(wf.jobs)) {
          assert.deepEqual(permissionProblems(job.permissions), [], `job ${id}`);
        }
      });

      it('gives every job either a reusable workflow or runs-on with steps', () => {
        for (const [id, job] of Object.entries(wf.jobs)) {
          if (job.uses) continue;
          assert.ok(job['runs-on'], `job ${id}: runs-on missing`);
          assert.ok(Array.isArray(job.steps) && job.steps.length > 0, `job ${id}: no steps`);
        }
      });

      it('pins every action to an exact version', () => {
        for (const step of allSteps(wf)) {
          if (!step.uses || step.uses.startsWith('./')) continue;
          assert.match(step.uses, /^[\w.-]+\/[\w./-]+@v\d+\.\d+\.\d+$/, step.uses);
        }
      });

      it('never comments on or reviews a pull request', () => {
        const text = readFileSync(join(ROOT, '.github', 'workflows', file), 'utf8');
        assert.doesNotMatch(text, /gh (pr|issue) (comment|review)/);
        assert.doesNotMatch(text, /\/comments\b|\/reviews\b|createComment|createReview/);
        assert.doesNotMatch(
          text,
          /github-script|create-or-update-comment|sticky-pull-request-comment/,
        );
      });

      if (isReusable(wf)) {
        it('is only triggered through workflow_call', () => {
          assert.deepEqual(Object.keys(wf.on), ['workflow_call']);
        });
      }
    });
  }
});

describe('pr-check.yml', () => {
  const wf = loadWorkflow('pr-check.yml');

  it('passes event values through env, not into the script text', () => {
    for (const step of allSteps(wf)) {
      assert.doesNotMatch(step.run ?? '', /\$\{\{/, `step "${step.name}" interpolates into run`);
    }
  });

  it('runs scripts/pr-check.js', () => {
    assert.ok(allSteps(wf).some((s) => s.run?.includes('scripts/pr-check.js')));
  });

  it('has a regression-test job that diffs the whole PR against its base', () => {
    const job = wf.jobs['regression-test'];
    assert.ok(job, 'regression-test job missing');
    const steps = job.steps ?? [];
    assert.equal(steps[0].with?.['fetch-depth'], 0);
    const diff = steps.find((s) => s.name === 'List changed files');
    assert.match(diff?.run ?? '', /git diff --name-only "\$BASE_SHA\.\.\.\$HEAD_SHA"/);
    const check = steps.find((s) => s.run?.includes('scripts/regression-test.js'));
    assert.ok(check?.env?.PR_BODY && check.env.PR_LABELS, 'PR body and labels come through env');
    assert.ok(
      check?.env?.PR_NUMBER && check.env.PR_AUTHOR,
      'PR number and author come through env',
    );
  });

  it('lets regression-test read label events, and nothing more', () => {
    assert.deepEqual(wf.jobs['regression-test'].permissions, {
      contents: 'read',
      issues: 'read',
      'pull-requests': 'read',
    });
  });
});

describe('scripts/', () => {
  const dir = join(ROOT, 'scripts');
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) =>
    f.endsWith('.js'),
  );

  for (const file of files) {
    const text = readFileSync(join(dir, file), 'utf8');

    it(`${file} imports only node: builtins and local files (callers run it without an install)`, () => {
      for (const [, spec] of text.matchAll(/ from '([^']+)';$/gm)) {
        assert.match(spec, /^(node:|\.\.?\/)/, spec);
      }
    });

    it(`${file} never writes to the GitHub API`, () => {
      assert.doesNotMatch(text, /method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i);
    });
  }
});

describe('PULL_REQUEST_TEMPLATE.md', () => {
  const template = readFileSync(join(ROOT, '.github', 'PULL_REQUEST_TEMPLATE.md'), 'utf8');

  it('has the agreed sections in order', () => {
    const headings = [...template.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(headings, [
      'What is this PR for?',
      'What type of PR is it?',
      'Todos',
      'What is the Jira issue?',
      'How should this be tested?',
      'Screenshots (if appropriate)',
      'Questions',
    ]);
  });

  it('lists the six PR types', () => {
    for (const type of [
      'Bug Fix',
      'Improvement',
      'Feature',
      'Documentation',
      'Hot Fix',
      'Refactoring',
    ]) {
      assert.match(template, new RegExp(`^- \\[ \\] ${type}$`, 'm'));
    }
  });

  it('carries the Jira link line pr-check looks for', () => {
    assert.match(template, /^https:\/\/prizmato\.atlassian\.net\/browse\/BTWL-<n>$/m);
  });
});
