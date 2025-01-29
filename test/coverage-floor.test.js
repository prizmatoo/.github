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

  it('rejects a missing summary argument', () => {
    assert.equal(main([]), 2);
  });
});
