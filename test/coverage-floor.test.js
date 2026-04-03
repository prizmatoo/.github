import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  compare,
  describeBase,
  evaluate,
  formatStepSummary,
  formatTable,
  main,
  readSummary,
} from '../scripts/coverage-floor.js';

/**
 * istanbul json-summary with the given per-file line counts.
 * @param {Record<string, [number, number]>} files file -> [covered, total]
 */
function istanbul(files) {
  /** @type {Record<string, { lines: { total: number, covered: number, skipped: number, pct: number } }>} */
  const out = {};
  let covered = 0;
  let total = 0;
  for (const [file, [c, t]] of Object.entries(files)) {
    out[file] = {
      lines: { total: t, covered: c, skipped: 0, pct: Math.round((c / t) * 10000) / 100 },
    };
    covered += c;
    total += t;
  }
  const pct = Math.round((covered / total) * 10000) / 100;
  return { total: { lines: { total, covered, skipped: 0, pct } }, ...out };
}

/** @param {unknown} data */
function summaryFile(data) {
  const path = join(mkdtempSync(join(tmpdir(), 'coverage-')), 'coverage-summary.json');
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

// 79.4% overall, as in the BTWL-46 acceptance criteria.
const below = istanbul({
  '/home/runner/work/btwl-order-service/src/orders/service.ts': [412, 500],
  '/home/runner/work/btwl-order-service/src/orders/routes.ts': [382, 500],
});

describe('readSummary', () => {
  it('reads istanbul json-summary', () => {
    const s = readSummary(JSON.stringify(below));
    assert.equal(s.format, 'istanbul');
    assert.equal(s.pct, 79.4);
    assert.equal(s.files.length, 2);
  });

  it('reads lcov and totals LH/LF over all files', () => {
    const lcov = [
      'TN:',
      'SF:scripts/pr-check.js',
      'LF:60',
      'LH:60',
      'end_of_record',
      'TN:',
      'SF:scripts/coverage-floor.js',
      'LF:40',
      'LH:30',
      'end_of_record',
      '',
    ].join('\n');
    const s = readSummary(lcov);
    assert.equal(s.format, 'lcov');
    assert.equal(s.pct, 90);
    assert.deepEqual(
      s.files.map((f) => [f.file, f.pct]),
      [
        ['scripts/pr-check.js', 100],
        ['scripts/coverage-floor.js', 75],
      ],
    );
  });

  it('rejects anything else', () => {
    assert.throws(() => readSummary('{"hello": 1}'), /unrecognised coverage summary/);
  });
});

describe('evaluate', () => {
  it('fails at 79.4%', () => {
    assert.equal(evaluate(readSummary(JSON.stringify(below)), 80).ok, false);
  });

  it('passes at exactly the floor', () => {
    const s = readSummary(JSON.stringify(istanbul({ 'src/a.ts': [80, 100] })));
    assert.equal(evaluate(s, 80).ok, true);
  });

  it('fails at 79.95%, which would print as 80.0 when rounded to one decimal', () => {
    const s = readSummary(JSON.stringify(istanbul({ 'src/a.ts': [1599, 2000] })));
    assert.equal(s.pct, 79.95);
    assert.deepEqual(evaluate(s, 80), { ok: false, pct: 79.95 });
  });

  it('rounds the displayed value down, never up to the floor', () => {
    assert.equal(evaluate({ format: 'lcov', pct: 79.996, files: [] }, 80).pct, 79.99);
  });
});

describe('coverage.py summary', () => {
  // Trimmed pytest --cov-report=json output, 78.5% overall.
  const coveragePy = {
    meta: { format: 3, version: '7.6.10' },
    files: {
      'src/btwl_inventory/stock.py': {
        summary: { covered_lines: 150, num_statements: 200, percent_covered: 75.0 },
      },
      'src/btwl_inventory/api.py': {
        summary: { covered_lines: 164, num_statements: 200, percent_covered: 82.0 },
      },
    },
    totals: { covered_lines: 314, num_statements: 400, percent_covered: 78.5 },
  };

  it('reads totals and files', () => {
    const s = readSummary(JSON.stringify(coveragePy));
    assert.equal(s.format, 'coverage.py');
    assert.equal(s.pct, 78.5);
    assert.deepEqual(s.files[0], {
      file: 'src/btwl_inventory/stock.py',
      pct: 75,
      covered: 150,
      total: 200,
    });
  });

  it('fails below the floor with the per-file table, lowest first', () => {
    const { code, out } = run(() => main([summaryFile(coveragePy)], {}));
    assert.equal(code, 1);
    const table = out.split('\n').slice(1);
    assert.match(table[1], /^src\/btwl_inventory\/stock\.py\s+75\.00  150\/200$/);
    assert.match(table[2], /^src\/btwl_inventory\/api\.py\s+82\.00  164\/200$/);
  });
});

describe('formatTable', () => {
  it('lists files lowest coverage first', () => {
    const table = formatTable([
      { file: 'src/b.ts', pct: 90, covered: 9, total: 10 },
      { file: 'src/a.ts', pct: 50, covered: 1, total: 2 },
    ]);
    const [, first, second] = table.split('\n');
    assert.match(first, /^src\/a\.ts\s+50\.00  1\/2$/);
    assert.match(second, /^src\/b\.ts\s+90\.00  9\/10$/);
  });
});

describe('main', () => {
  it('fails below the floor and prints the per-file summary', () => {
    const { code, out } = run(() => main([summaryFile(below)], {}));
    assert.equal(code, 1);
    // "%" is escaped as %25 in workflow commands; the log shows it as "%".
    assert.match(out, /::error title=coverage::line coverage 79\.4%25 is below the 80%25 floor/);
    assert.match(out, /src\/orders\/routes\.ts\s+76\.40  382\/500/);
  });

  it('passes above the floor', () => {
    const { code, out } = run(() => main([summaryFile(istanbul({ 'src/a.ts': [95, 100] }))], {}));
    assert.equal(code, 0);
    assert.match(out, /coverage: 95% lines \(floor 80%\)/);
  });

  it('takes the floor from --floor', () => {
    assert.equal(run(() => main([summaryFile(below), '--floor', '75'], {})).code, 0);
  });

  it('fails when the summary file does not exist, with the reporter hint', () => {
    const { code, out } = run(() => main(['/nonexistent/coverage-summary.json'], {}));
    assert.equal(code, 1);
    assert.match(out, /::error title=coverage::no coverage summary at \/nonexistent/);
    assert.match(out, /json-summary/);
  });

  it('skips the check entirely with --floor 0', () => {
    const { code, out } = run(() =>
      main(['/nonexistent/coverage-summary.json', '--floor', '0'], {}),
    );
    assert.equal(code, 0);
    assert.match(out, /floor disabled/);
  });

  it('rejects a missing summary argument', () => {
    assert.equal(main([], {}), 2);
  });
});

// BTWL-424: the delta against main in the job summary.
const WS = '/home/runner/work/btwl-order-service/btwl-order-service';
const mainBuild = istanbul({
  [`${WS}/src/orders/service.ts`]: [450, 500],
  [`${WS}/src/orders/routes.ts`]: [400, 500],
  [`${WS}/src/orders/quote.ts`]: [90, 100],
});
const prBuild = istanbul({
  [`${WS}/src/orders/service.ts`]: [450, 500],
  [`${WS}/src/orders/routes.ts`]: [380, 500],
  [`${WS}/src/orders/quote.ts`]: [95, 100],
});

describe('compare', () => {
  const c = compare(
    readSummary(JSON.stringify(prBuild)),
    readSummary(JSON.stringify(mainBuild)),
    WS,
  );

  it('gives the total and its change against main', () => {
    assert.equal(c.base, 85.45);
    assert.equal(c.pct, 84.09);
    assert.equal(Math.round(c.delta * 100) / 100, -1.36);
  });

  it('lists the files whose coverage moved, the largest drop first, relative to the repo', () => {
    assert.deepEqual(
      c.files.map((f) => [f.file, f.base, f.pct]),
      [
        ['src/orders/routes.ts', 80, 76],
        ['src/orders/quote.ts', 90, 95],
      ],
    );
  });

  it('lists files main does not have after them, lowest coverage first', () => {
    const withNew = istanbul({
      [`${WS}/src/orders/service.ts`]: [450, 500],
      [`${WS}/src/orders/expiry.ts`]: [30, 60],
      [`${WS}/src/orders/requote.ts`]: [10, 40],
    });
    const files = compare(
      readSummary(JSON.stringify(withNew)),
      readSummary(JSON.stringify(mainBuild)),
      WS,
    ).files;
    assert.deepEqual(
      files.map((f) => [f.file, f.base, f.pct, f.delta]),
      [
        ['src/orders/requote.ts', null, 25, null],
        ['src/orders/expiry.ts', null, 50, null],
      ],
    );
  });
});

describe('describeBase', () => {
  const sha = '3f9c2a41d7be0e6a1c55f0d1a9b3e2c47d8a6f10';
  const other = '9b1e04c2aa7f3d5e8c6b2f1a0d9e8c7b6a5f4e3d';

  it("names the main commit when it is the PR's base", () => {
    assert.equal(
      describeBase(`coverage-main-.-${sha}`, sha),
      "Compared with main at `3f9c2a4`, this PR's base.",
    );
  });

  it("says so when the cache had only a newer main build than the PR's base", () => {
    const text = describeBase(`coverage-main-.-${sha}`, other);
    assert.match(text, /^Compared with main at `3f9c2a4`, the newest main build with coverage/);
    assert.match(text, /this PR's base `9b1e04c` has none/);
  });

  it('falls back to "a main build" without a key', () => {
    assert.equal(describeBase('', other), 'Compared with a main build.');
    assert.equal(describeBase(undefined, undefined), 'Compared with a main build.');
  });
});

describe('formatStepSummary', () => {
  const summary = readSummary(JSON.stringify(prBuild));

  it('shows this build, main, the change and the floor', () => {
    const comparison = compare(summary, readSummary(JSON.stringify(mainBuild)), WS);
    const md = formatStepSummary({ summary, floor: 80, ok: true, comparison });
    assert.match(md, /^### Coverage$/m);
    assert.match(md, /^\| lines \| 84\.09% \| 85\.45% \| -1\.36 \| 80% \|$/m);
    assert.match(md, /^\| `src\/orders\/routes\.ts` \| 80\.00% \| 76\.00% \| -4\.00 \|$/m);
    assert.match(md, /^\| `src\/orders\/quote\.ts` \| 90\.00% \| 95\.00% \| \+5\.00 \|$/m);
  });

  it('says which main build it compared with, and marks new files', () => {
    const comparison = {
      pct: 84.09,
      base: 85.45,
      delta: -1.36,
      files: [{ file: 'src/orders/expiry.ts', pct: 50, base: null, delta: null }],
    };
    const against = "Compared with main at `3f9c2a4`, this PR's base.";
    const md = formatStepSummary({ summary, floor: 80, ok: true, comparison, against });
    assert.match(md, /^Compared with main at `3f9c2a4`, this PR's base\.$/m);
    assert.match(md, /^\| `src\/orders\/expiry\.ts` \| – \| 50\.00% \| new \|$/m);
  });

  it('says so when there is no main build to compare with', () => {
    const md = formatStepSummary({ summary, floor: 80, ok: true, comparison: null });
    assert.match(md, /^\| lines \| 84\.09% \| – \| – \| 80% \|$/m);
    assert.match(md, /No coverage summary from a main build/);
  });

  it('shows only the total for a build that compares with nothing (main itself)', () => {
    const md = formatStepSummary({ summary, floor: 80, ok: true });
    assert.match(md, /^\| lines \| 84\.09% \| – \| – \| 80% \|$/m);
    assert.doesNotMatch(md, /No coverage summary|\| file \|/);
  });

  it('marks a build below the floor', () => {
    const md = formatStepSummary({
      summary: readSummary(JSON.stringify(below)),
      floor: 80,
      ok: false,
    });
    assert.match(md, /\*\*Below the 80% floor\.\*\*/);
  });
});

describe('main, in Actions', () => {
  /** @param {string} name */
  const jobSummary = (name) => join(mkdtempSync(join(tmpdir(), 'step-summary-')), name);

  it('writes the job summary with the delta against --base', () => {
    const file = jobSummary('summary.md');
    const sha = '3f9c2a41d7be0e6a1c55f0d1a9b3e2c47d8a6f10';
    const args = [summaryFile(prBuild), '--base', summaryFile(mainBuild)];
    args.push('--base-key', `coverage-main-.-${sha}`, '--pr-base', sha);
    assert.equal(run(() => main(args, { GITHUB_STEP_SUMMARY: file })).code, 0);
    const md = readFileSync(file, 'utf8');
    assert.match(md, /\| lines \| 84\.09% \| 85\.45% \| -1\.36 \| 80% \|/);
    assert.match(md, /Compared with main at `3f9c2a4`, this PR's base\./);
  });

  it('still fails below the floor, and the summary says so', () => {
    const file = jobSummary('summary.md');
    assert.equal(run(() => main([summaryFile(below)], { GITHUB_STEP_SUMMARY: file })).code, 1);
    assert.match(readFileSync(file, 'utf8'), /Below the 80% floor/);
  });

  it('ignores a --base that is missing or unreadable', () => {
    const file = jobSummary('summary.md');
    const broken = join(mkdtempSync(join(tmpdir(), 'coverage-')), 'broken.json');
    writeFileSync(broken, 'not json');
    for (const base of ['/nonexistent/coverage-summary.json', broken]) {
      const args = [summaryFile(prBuild), '--base', base];
      assert.equal(run(() => main(args, { GITHUB_STEP_SUMMARY: file })).code, 0);
    }
    assert.match(readFileSync(file, 'utf8'), /No coverage summary from a main build/);
  });

  it('compares with nothing when --base is empty (a main build)', () => {
    const file = jobSummary('summary.md');
    const args = [summaryFile(prBuild), '--floor', '80', '--base', ''];
    assert.equal(run(() => main(args, { GITHUB_STEP_SUMMARY: file })).code, 0);
    assert.doesNotMatch(readFileSync(file, 'utf8'), /No coverage summary/);
  });

  it('never fails because the job summary cannot be written', () => {
    const env = { GITHUB_STEP_SUMMARY: '/nonexistent/dir/summary.md' };
    const { code, out } = run(() => main([summaryFile(prBuild)], env));
    assert.equal(code, 0);
    assert.match(out, /job summary not written/);
  });
});
