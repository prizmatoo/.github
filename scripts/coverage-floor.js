#!/usr/bin/env node
// Coverage floor: fail when total line coverage is below the floor (default 80%) and print the
// per-file summary, lowest first, so the PR author sees where coverage dropped.
//
//   node scripts/coverage-floor.js <summary> [--floor 80] [--base <main's summary>]
//
// <summary> is one of
//   - istanbul json-summary (vitest / jest "json-summary" reporter): coverage/coverage-summary.json
//   - coverage.py JSON (pytest --cov-report=json): coverage.json
//   - lcov (any tool; node --test --test-reporter=lcov): *.info
//
// In Actions ($GITHUB_STEP_SUMMARY set) it also writes the total, the delta against --base (a
// summary of the same format from a main build) and the files whose coverage moved to the job
// summary (BTWL-424). That is the check's own output: nothing is posted on the PR.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

import { errorCommand, isMain } from './lib/actions.js';

/**
 * @typedef {{ file: string, pct: number, covered: number, total: number }} FileCoverage
 * @typedef {{ format: string, pct: number, files: FileCoverage[] }} Summary
 */

/**
 * @param {string} text
 * @returns {Summary}
 */
export function readSummary(text) {
  if (/^(TN|SF):/m.test(text) && text.includes('end_of_record')) return fromLcov(text);
  const data = JSON.parse(text);
  if (data?.total?.lines) return fromIstanbul(data);
  if (data?.totals && typeof data.totals.percent_covered === 'number') return fromCoveragePy(data);
  throw new Error(
    'unrecognised coverage summary (expected istanbul json-summary, coverage.py JSON or lcov)',
  );
}

/**
 * lcov: one record per source file, LF = lines found, LH = lines hit.
 * @param {string} text
 * @returns {Summary}
 */
function fromLcov(text) {
  /** @type {FileCoverage[]} */
  const files = [];
  for (const record of text.split('end_of_record')) {
    const file = /^SF:(.+)$/m.exec(record)?.[1];
    if (!file) continue;
    const total = Number(/^LF:(\d+)$/m.exec(record)?.[1] ?? 0);
    const covered = Number(/^LH:(\d+)$/m.exec(record)?.[1] ?? 0);
    files.push({ file, total, covered, pct: total ? (covered / total) * 100 : 100 });
  }
  const total = files.reduce((n, f) => n + f.total, 0);
  const covered = files.reduce((n, f) => n + f.covered, 0);
  return { format: 'lcov', pct: total ? (covered / total) * 100 : 100, files };
}

/**
 * @param {Record<string, { lines: { total: number, covered: number, pct: number } }>} data
 * @returns {Summary}
 */
function fromIstanbul(data) {
  const files = Object.entries(data)
    .filter(([key]) => key !== 'total')
    .map(([file, s]) => ({
      file,
      pct: s.lines.pct,
      covered: s.lines.covered,
      total: s.lines.total,
    }));
  return { format: 'istanbul', pct: data.total.lines.pct, files };
}

/**
 * @param {{ totals: { percent_covered: number }, files?: Record<string, { summary: { covered_lines: number, num_statements: number, percent_covered: number } }> }} data
 * @returns {Summary}
 */
function fromCoveragePy(data) {
  const files = Object.entries(data.files ?? {}).map(([file, f]) => ({
    file,
    pct: f.summary.percent_covered,
    covered: f.summary.covered_lines,
    total: f.summary.num_statements,
  }));
  return { format: 'coverage.py', pct: data.totals.percent_covered, files };
}

/**
 * @param {FileCoverage[]} files
 * @returns {string}
 */
export function formatTable(files) {
  const rows = [...files].sort((a, b) => a.pct - b.pct || a.file.localeCompare(b.file));
  const width = Math.max(4, ...rows.map((r) => r.file.length));
  const lines = [`${'file'.padEnd(width)}  lines %  covered/total`];
  for (const r of rows) {
    lines.push(`${r.file.padEnd(width)}  ${r.pct.toFixed(2).padStart(7)}  ${r.covered}/${r.total}`);
  }
  return lines.join('\n');
}

/**
 * @param {Summary} summary
 * @param {number} floor
 */
export function evaluate(summary, floor) {
  // Compare the unrounded value: 79.95% must not pass as "80.0%". Round only for display,
  // and round down so the log never shows the floor for a run that failed it.
  return { ok: summary.pct >= floor, pct: Math.floor(summary.pct * 100) / 100 };
}

/**
 * A file's path as the job summary shows it: istanbul writes absolute paths, the others relative.
 * @param {string} file
 * @param {string} cwd
 */
function relativeTo(file, cwd) {
  return file.startsWith(`${cwd}/`) ? file.slice(cwd.length + 1) : file;
}

/**
 * @typedef {{ file: string, pct: number, base: number, delta: number }} FileDelta
 * @typedef {{ pct: number, base: number, delta: number, files: FileDelta[] }} Comparison
 */

/**
 * Total and per-file line coverage of this build against a main build's summary. Files whose
 * coverage moved come first by the largest drop.
 * @param {Summary} head
 * @param {Summary} base
 * @param {string} [cwd]
 * @returns {Comparison}
 */
export function compare(head, base, cwd = process.cwd()) {
  const before = new Map(base.files.map((f) => [relativeTo(f.file, cwd), f.pct]));
  /** @type {FileDelta[]} */
  const files = [];
  for (const f of head.files) {
    const file = relativeTo(f.file, cwd);
    const was = before.get(file);
    if (was === undefined) continue;
    const delta = f.pct - was;
    if (Math.abs(delta) >= 0.005) files.push({ file, pct: f.pct, base: was, delta });
  }
  files.sort((a, b) => a.delta - b.delta || a.file.localeCompare(b.file));
  return { pct: head.pct, base: base.pct, delta: head.pct - base.pct, files };
}

/** @param {number} n */
const pct = (n) => `${(Math.floor(n * 100) / 100).toFixed(2)}%`;
/** @param {number} n */
const signed = (n) => `${n >= 0 ? '+' : '-'}${Math.abs(n).toFixed(2)}`;

const MAX_FILES = 25;

/**
 * Markdown for the job summary. `comparison` is undefined when nothing was to be compared (a main
 * build) and null when a main build's summary was wanted but there was none.
 * @param {{ summary: Summary, floor: number, ok: boolean, comparison?: Comparison | null }} result
 * @returns {string}
 */
export function formatStepSummary({ summary, floor, ok, comparison }) {
  const lines = ['### Coverage', ''];
  lines.push('|  | this build | main | change | floor |', '| --- | ---: | ---: | ---: | ---: |');
  const main = comparison ? pct(comparison.base) : '–';
  const change = comparison ? signed(comparison.delta) : '–';
  lines.push(`| lines | ${pct(summary.pct)} | ${main} | ${change} | ${floor}% |`, '');
  lines.push(ok ? `At or above the ${floor}% floor.` : `**Below the ${floor}% floor.**`, '');
  if (comparison === null) {
    lines.push('No coverage summary from a main build to compare with.', '');
  }
  if (!comparison) return lines.join('\n');
  if (comparison.files.length === 0) {
    lines.push('No file changed its line coverage.', '');
    return lines.join('\n');
  }
  const shown = comparison.files.slice(0, MAX_FILES);
  lines.push('| file | main | this build | change |', '| --- | ---: | ---: | ---: |');
  for (const f of shown) {
    lines.push(`| \`${f.file}\` | ${pct(f.base)} | ${pct(f.pct)} | ${signed(f.delta)} |`);
  }
  if (comparison.files.length > shown.length) {
    lines.push('', `${comparison.files.length - shown.length} more files changed.`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * The summary of a main build, or undefined when there is none or it cannot be read.
 * @param {string | undefined} path
 * @returns {Summary | undefined}
 */
function readBase(path) {
  if (!path || !existsSync(path)) return undefined;
  try {
    return readSummary(readFileSync(path, 'utf8'));
  } catch (err) {
    console.log(
      `coverage: main's summary at ${path} not used (${/** @type {Error} */ (err).message})`,
    );
    return undefined;
  }
}

/**
 * Appends to the job summary; a summary that cannot be written never changes the check's result.
 * @param {string | undefined} file
 * @param {string} markdown
 */
function writeStepSummary(file, markdown) {
  if (!file) return;
  try {
    appendFileSync(file, markdown);
  } catch (err) {
    console.log(`coverage: job summary not written (${/** @type {Error} */ (err).message})`);
  }
}

/**
 * @param {string[]} argv
 * @returns {{ path?: string, options: Record<string, string> }}
 */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const options = {};
  /** @type {string[]} */
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) options[argv[i].slice(2)] = argv[++i] ?? '';
    else positional.push(argv[i]);
  }
  return { path: positional[0], options };
}

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 * @returns {number} exit code
 */
export function main(argv = process.argv.slice(2), env = process.env) {
  const { path, options } = parseArgs(argv);
  const floor = options.floor !== undefined ? Number(options.floor) : 80;
  if (!path || Number.isNaN(floor)) {
    console.error('usage: coverage-floor.js <summary> [--floor 80] [--base <summary>]');
    return 2;
  }
  if (floor === 0) {
    console.log('coverage: floor disabled (coverage-floor: 0)');
    return 0;
  }
  if (!existsSync(path)) {
    const hint = 'enable the json-summary coverage reporter, or set coverage-floor: 0 explicitly';
    console.log(errorCommand(`no coverage summary at ${path}: ${hint}`, { title: 'coverage' }));
    return 1;
  }
  const summary = readSummary(readFileSync(path, 'utf8'));
  const { ok, pct } = evaluate(summary, floor);
  const base = readBase(options.base);
  // An empty --base (a main build) compares with nothing.
  const comparison = !options.base ? undefined : base ? compare(summary, base) : null;
  writeStepSummary(env.GITHUB_STEP_SUMMARY, formatStepSummary({ summary, floor, ok, comparison }));
  if (ok) {
    console.log(`coverage: ${pct}% lines (floor ${floor}%)`);
    return 0;
  }
  console.log(
    errorCommand(`line coverage ${pct}% is below the ${floor}% floor`, { title: 'coverage' }),
  );
  console.log(formatTable(summary.files));
  return 1;
}

if (isMain(import.meta.url)) process.exitCode = main();
