import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { evaluate, formatTable, main, readSummary } from '../scripts/coverage-floor.js';

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
    const { code, out } = run(() => main([summaryFile(coveragePy)]));
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
    const { code, out } = run(() => main([summaryFile(below)]));
    assert.equal(code, 1);
    // "%" is escaped as %25 in workflow commands; the log shows it as "%".
    assert.match(out, /::error title=coverage::line coverage 79\.4%25 is below the 80%25 floor/);
    assert.match(out, /src\/orders\/routes\.ts\s+76\.40  382\/500/);
  });

  it('passes above the floor', () => {
    const { code, out } = run(() => main([summaryFile(istanbul({ 'src/a.ts': [95, 100] }))]));
    assert.equal(code, 0);
    assert.match(out, /coverage: 95% lines \(floor 80%\)/);
  });

  it('takes the floor from --floor', () => {
    assert.equal(run(() => main([summaryFile(below), '--floor', '75'])).code, 0);
  });

  it('fails when the summary file does not exist, with the reporter hint', () => {
    const { code, out } = run(() => main(['/nonexistent/coverage-summary.json']));
    assert.equal(code, 1);
    assert.match(out, /::error title=coverage::no coverage summary at \/nonexistent/);
    assert.match(out, /json-summary/);
  });

  it('skips the check entirely with --floor 0', () => {
    const { code, out } = run(() => main(['/nonexistent/coverage-summary.json', '--floor', '0']));
    assert.equal(code, 0);
    assert.match(out, /floor disabled/);
  });

  it('rejects a missing summary argument', () => {
    assert.equal(main([]), 2);
  });
});
