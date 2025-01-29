#!/usr/bin/env node
// Coverage floor: fail when total line coverage is below the floor (default 80%) and print the
// per-file summary, lowest first, so the PR author sees where coverage dropped.
//
//   node scripts/coverage-floor.js <summary> [--floor 80]
//
// <summary> is one of
//   - istanbul json-summary (vitest / jest "json-summary" reporter): coverage/coverage-summary.json
//   - coverage.py JSON (pytest --cov-report=json): coverage.json
import { existsSync, readFileSync } from 'node:fs';

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
  const data = JSON.parse(text);
  if (data?.total?.lines) return fromIstanbul(data);
  if (data?.totals && typeof data.totals.percent_covered === 'number') return fromCoveragePy(data);
  throw new Error(
    'unrecognised coverage summary (expected istanbul json-summary or coverage.py JSON)',
  );
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
  const pct = Number(summary.pct.toFixed(1));
  return { ok: pct >= floor, pct };
}

/**
 * @param {string[]} argv
 * @returns {number} exit code
 */
export function main(argv = process.argv.slice(2)) {
  const floorAt = argv.indexOf('--floor');
  const floor = floorAt >= 0 ? Number(argv[floorAt + 1]) : 80;
  const path = argv.find((a, i) => !a.startsWith('--') && (floorAt < 0 || i !== floorAt + 1));
  if (!path || Number.isNaN(floor)) {
    console.error('usage: coverage-floor.js <summary> [--floor 80]');
    return 2;
  }
  if (!existsSync(path)) {
    console.log(`::warning title=coverage::no coverage summary at ${path}, floor not checked`);
    return 0;
  }
  const summary = readSummary(readFileSync(path, 'utf8'));
  const { ok, pct } = evaluate(summary, floor);
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
