import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  MESSAGE,
  evaluate,
  isBugFix,
  isTestChange,
  main,
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

describe('parseLabels', () => {
  it('reads the JSON array from toJSON(labels.*.name)', () => {
    assert.deepEqual(parseLabels('["bug", "tech-debt"]'), ['bug', 'tech-debt']);
  });

  it('treats a missing value as no labels', () => {
    assert.deepEqual(parseLabels(undefined), []);
  });
});

describe('main', () => {
  /** @param {string[]} files */
  const list = (files) => {
    const path = join(mkdtempSync(join(tmpdir(), 'regression-')), 'changed-files.txt');
    writeFileSync(path, files.join('\n') + '\n');
    return path;
  };

  /** @param {() => number} fn */
  const run = (fn) => {
    const lines = /** @type {string[]} */ ([]);
    const orig = console.log;
    console.log = (/** @type {unknown[]} */ ...args) => void lines.push(args.join(' '));
    try {
      return { code: fn(), out: lines.join('\n') };
    } finally {
      console.log = orig;
    }
  };

  it('fails with the agreed message', () => {
    const env = { PR_BODY: body('Bug Fix'), PR_LABELS: '[]' };
    const { code, out } = run(() => main([list(['src/dim/weight.ts'])], env));
    assert.equal(code, 1);
    assert.match(out, /::error title=regression-test::bug fixes need a regression test/);
  });

  it('prints why it skipped', () => {
    const env = { PR_BODY: body('Improvement'), PR_LABELS: '[]' };
    const { code, out } = run(() => main([list(['src/dim/weight.ts'])], env));
    assert.equal(code, 0);
    assert.match(out, /regression-test: skipped, not a bug fix/);
  });

  it('rejects a missing file list argument', () => {
    assert.equal(main([], {}), 2);
  });
});
