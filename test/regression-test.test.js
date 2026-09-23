import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  MESSAGE,
  evaluate,
  isBugFix,
  isTestChange,
  labelProblem,
  main,
  noTestReason,
  parseLabels,
} from '../scripts/regression-test.js';

/** PR body from the org template with the given types ticked. */
function body(/** @type {string[]} */ ...ticked) {
  const types = ['Bug Fix', 'Improvement', 'Feature', 'Documentation', 'Hot Fix', 'Refactoring'];
  return [
    '### What is this PR for?',
    'Round DIM weight half-up per line.',
    '',
    '### What type of PR is it?',
    ...types.map((t) => `- [${ticked.includes(t) ? 'x' : ' '}] ${t}`),
    '',
    '### What is the Jira issue?',
    'https://prizmato.atlassian.net/browse/BTWL-102',
  ].join('\n');
}

describe('isBugFix', () => {
  it('is true when Bug Fix is ticked', () => {
    assert.equal(isBugFix({ body: body('Bug Fix'), labels: [] }), true);
  });

  it('is true with the bug label', () => {
    assert.equal(isBugFix({ body: body('Feature'), labels: ['bug'] }), true);
  });

  it('is false for a feature', () => {
    assert.equal(isBugFix({ body: body('Feature'), labels: [] }), false);
  });

  it('is false for the untouched template', () => {
    assert.equal(isBugFix({ body: body(), labels: [] }), false);
  });

  it('is true when Hot Fix is ticked', () => {
    assert.equal(isBugFix({ body: body('Hot Fix'), labels: [] }), true);
  });

  it('is true with the hotfix label', () => {
    assert.equal(isBugFix({ body: body(), labels: ['hotfix'] }), true);
  });

  it('accepts an upper-case [X], which GitHub renders as ticked too', () => {
    assert.equal(isBugFix({ body: body('Bug Fix').replace('[x]', '[X]'), labels: [] }), true);
  });

  it('accepts "*" bullets', () => {
    assert.equal(isBugFix({ body: '* [x] Bug Fix\n', labels: [] }), true);
  });

  it('does not read "Bug Fix" in prose as ticked', () => {
    const prose = body('Refactoring') + '\nNot a - [x] Bug Fix, just moving code.';
    assert.equal(isBugFix({ body: prose, labels: [] }), false);
  });
});

describe('isTestChange', () => {
  for (const file of [
    'test/dim/weight.test.ts',
    'tests/test_stock.py',
    'packages/client/test/orders.test.ts',
    'src/orders/__tests__/service.test.ts',
  ]) {
    it(`counts ${file}`, () => assert.equal(isTestChange(file), true));
  }

  for (const file of [
    'src/orders/testdata.ts',
    'src/test-helpers.ts',
    'src/testing/clock.ts',
    'test',
    'docs/testing.md',
  ]) {
    it(`does not count ${file}`, () => assert.equal(isTestChange(file), false));
  }
});

describe('evaluate', () => {
  it('fails a bug fix that changes src/ without a test', () => {
    const r = evaluate({ files: ['src/dim/weight.ts'], body: body('Bug Fix'), labels: [] });
    assert.equal(r.result, 'fail');
    assert.match(r.reason, new RegExp(`^${MESSAGE}`));
  });

  it('passes a bug fix that also changes test/', () => {
    const files = ['src/dim/weight.ts', 'test/dim/weight.test.ts'];
    assert.equal(evaluate({ files, body: body('Bug Fix'), labels: [] }).result, 'pass');
  });

  it('passes a bug fix that changes tests/ (Python layout)', () => {
    const files = ['src/btwl_inventory/stock.py', 'tests/test_stock.py'];
    assert.equal(evaluate({ files, body: body('Bug Fix'), labels: [] }).result, 'pass');
  });

  it('passes a bug fix outside src/ (config, docs)', () => {
    const files = ['docker-compose.yml', 'README.md'];
    assert.equal(evaluate({ files, body: body('Bug Fix'), labels: [] }).result, 'pass');
  });

  it('fails a bug fix whose only "test-looking" change is src/**/testdata', () => {
    const files = ['src/dim/weight.ts', 'src/dim/testdata.ts'];
    assert.equal(evaluate({ files, body: body('Bug Fix'), labels: [] }).result, 'fail');
  });

  it('skips stories, tasks and spikes', () => {
    const r = evaluate({ files: ['src/dim/weight.ts'], body: body('Feature'), labels: [] });
    assert.equal(r.result, 'skip');
  });
});

describe('no-regression-test label', () => {
  const files = ['src/config/defaults.ts'];
  const labels = ['bug', 'no-regression-test'];

  it('passes with a reason in the PR body', () => {
    const b =
      body('Bug Fix') + '\n\nNo regression test: timeout default only, covered by config schema';
    const r = evaluate({ files, body: b, labels });
    assert.deepEqual(r, {
      result: 'pass',
      reason: 'no-regression-test: timeout default only, covered by config schema',
      viaLabel: true,
    });
  });

  it('fails without a reason', () => {
    const r = evaluate({ files, body: body('Bug Fix'), labels });
    assert.equal(r.result, 'fail');
    assert.match(r.reason, /needs a reason/);
  });

  it('fails with an empty or token reason', () => {
    for (const line of [
      'No regression test:',
      'No regression test: n/a',
      'No regression test: tbd',
    ]) {
      assert.equal(evaluate({ files, body: `${body('Bug Fix')}\n${line}`, labels }).result, 'fail');
    }
  });

  it('reads the reason case-insensitively, anywhere in the body', () => {
    assert.equal(
      noTestReason('intro\nno regression test:  only the retry count  \n'),
      'only the retry count',
    );
  });

  it('does not need the label when a test was changed anyway', () => {
    const r = evaluate({ files: [...files, 'test/config.test.ts'], body: body('Bug Fix'), labels });
    assert.equal(r.result, 'pass');
  });
});

describe('parseLabels', () => {
  it('reads the JSON array from toJSON(labels.*.name)', () => {
    assert.deepEqual(parseLabels('["bug", "tech-debt"]'), ['bug', 'tech-debt']);
  });

  it('treats a missing value as no labels', () => {
    assert.deepEqual(parseLabels(undefined), []);
  });
});

describe('labelProblem', () => {
  const owners = new Set(['cei-prizmato', 'aaquib-prizmato']);

  it('accepts a CODEOWNER who is not the author', () => {
    assert.equal(
      labelProblem({ actor: 'aaquib-prizmato', author: 'cei-prizmato', owners }),
      undefined,
    );
  });

  it('rejects the PR author, even when they are a CODEOWNER', () => {
    const p = labelProblem({ actor: 'cei-prizmato', author: 'cei-prizmato', owners });
    assert.match(p ?? '', /applied by the PR author/);
  });

  it('rejects someone who is not a CODEOWNER', () => {
    const p = labelProblem({ actor: 'krunal-prizmato', author: 'cei-prizmato', owners });
    assert.match(p ?? '', /@krunal-prizmato, who is not a CODEOWNER/);
  });

  it('compares logins case-insensitively', () => {
    const p = labelProblem({ actor: 'Aaquib-Prizmato', author: 'cei-prizmato', owners });
    assert.equal(p, undefined);
  });

  it('rejects when it cannot tell who applied the label', () => {
    assert.match(labelProblem({ actor: undefined, author: 'x', owners }) ?? '', /could not tell/);
  });

  it('rejects when the repo has no CODEOWNERS', () => {
    const p = labelProblem({ actor: 'aaquib-prizmato', author: 'cei-prizmato', owners: undefined });
    assert.match(p ?? '', /needs a CODEOWNERS file/);
  });
});

describe('main', () => {
  /** @param {string[]} files */
  const list = (files) => {
    const path = join(mkdtempSync(join(tmpdir(), 'regression-')), 'changed-files.txt');
    writeFileSync(path, files.join('\n') + '\n');
    return path;
  };

  /** @param {() => Promise<number>} fn */
  const run = async (fn) => {
    const lines = /** @type {string[]} */ ([]);
    const orig = console.log;
    console.log = (/** @type {unknown[]} */ ...args) => void lines.push(args.join(' '));
    try {
      return { code: await fn(), out: lines.join('\n') };
    } finally {
      console.log = orig;
    }
  };

  /** A repo checkout with a CODEOWNERS file. */
  const repo = () => {
    const dir = mkdtempSync(join(tmpdir(), 'repo-'));
    mkdirSync(join(dir, '.github'));
    writeFileSync(join(dir, '.github', 'CODEOWNERS'), '*  @venkat-prizmato @krunal-prizmato\n');
    return dir;
  };

  /**
   * fetch stub serving the issue events of one PR.
   * @param {object[]} events
   */
  const eventsApi = (events) => {
    /** @type {string[]} */
    const calls = [];
    /** @type {import('../scripts/lib/github.js').Fetch} */
    const fetch = async (url) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => (url.endsWith('page=1') ? events : []) };
    };
    return { fetch, calls };
  };

  const labeled = (/** @type {string} */ login) => ({
    event: 'labeled',
    actor: { login },
    label: { name: 'no-regression-test' },
  });

  const labelEnv = {
    PR_BODY: `${body('Bug Fix')}\nNo regression test: only the default timeout changes`,
    PR_LABELS: '["no-regression-test"]',
    PR_NUMBER: '41',
    PR_AUTHOR: 'venkat-prizmato',
    GITHUB_REPOSITORY: 'prizmatoo/btwl-order-service',
    GITHUB_TOKEN: 'fake-read-only',
  };

  it('fails with the agreed message', async () => {
    const env = { PR_BODY: body('Bug Fix'), PR_LABELS: '[]' };
    const { code, out } = await run(() => main([list(['src/dim/weight.ts'])], env));
    assert.equal(code, 1);
    assert.match(out, /::error title=regression-test::bug fixes need a regression test/);
  });

  it('prints why it skipped', async () => {
    const env = { PR_BODY: body('Improvement'), PR_LABELS: '[]' };
    const { code, out } = await run(() => main([list(['src/dim/weight.ts'])], env));
    assert.equal(code, 0);
    assert.match(out, /regression-test: skipped, not a bug fix/);
  });

  it('passes when a CODEOWNER other than the author applied the label', async () => {
    const api = eventsApi([labeled('krunal-prizmato')]);
    const { code, out } = await run(() =>
      main([list(['src/config.ts'])], labelEnv, { fetch: api.fetch, cwd: repo() }),
    );
    assert.equal(code, 0);
    assert.match(out, /label applied by @krunal-prizmato/);
    assert.equal(
      api.calls[0],
      'https://api.github.com/repos/prizmatoo/btwl-order-service/issues/41/events?per_page=100&page=1',
    );
  });

  it('fails when the author applied the label', async () => {
    const api = eventsApi([labeled('venkat-prizmato')]);
    const { code, out } = await run(() =>
      main([list(['src/config.ts'])], labelEnv, { fetch: api.fetch, cwd: repo() }),
    );
    assert.equal(code, 1);
    assert.match(out, /applied by the PR author/);
  });

  it('uses the most recent labeled event', async () => {
    const api = eventsApi([
      labeled('krunal-prizmato'),
      { event: 'unlabeled' },
      labeled('venkat-prizmato'),
    ]);
    const { code } = await run(() =>
      main([list(['src/config.ts'])], labelEnv, { fetch: api.fetch, cwd: repo() }),
    );
    assert.equal(code, 1);
  });

  it('does not call the API when the label is not needed', async () => {
    const api = eventsApi([]);
    const files = ['src/config.ts', 'test/config.test.ts'];
    const { code } = await run(() =>
      main([list(files)], labelEnv, { fetch: api.fetch, cwd: repo() }),
    );
    assert.equal(code, 0);
    assert.deepEqual(api.calls, []);
  });

  it('rejects a missing file list argument', async () => {
    assert.equal(await main([], {}), 2);
  });
});
