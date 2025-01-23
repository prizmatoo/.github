#!/usr/bin/env node
// Turns a gitleaks JSON report into error annotations on the offending file and line,
// and fails when there is at least one finding. Secrets are already redacted by gitleaks.
//
//   node scripts/gitleaks-annotate.js <report.json>
import { readFileSync } from 'node:fs';

import { errorCommand, isMain } from './lib/actions.js';

/**
 * @typedef {{ RuleID: string, Description?: string, File: string, StartLine: number, Commit?: string }} Finding
 */

/**
 * @param {string} text contents of the gitleaks JSON report
 * @returns {Finding[]}
 */
export function parseReport(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error('gitleaks report is not a JSON array');
  return data;
}

/**
 * One annotation per finding, placed on the file and line.
 * @param {Finding} f
 */
export function annotation(f) {
  const where = f.Commit ? ` (commit ${f.Commit.slice(0, 8)})` : '';
  const what = f.Description ? `${f.RuleID}: ${f.Description}` : f.RuleID;
  return errorCommand(`possible secret, ${what}${where}`, {
    file: f.File,
    line: f.StartLine,
    title: 'gitleaks',
  });
}

/**
 * @param {string[]} argv
 * @returns {number} exit code
 */
export function main(argv = process.argv.slice(2)) {
  const [reportPath] = argv;
  if (!reportPath) {
    console.error('usage: gitleaks-annotate.js <report.json>');
    return 2;
  }
  const findings = parseReport(readFileSync(reportPath, 'utf8'));
  for (const f of findings) {
    console.log(`${f.File}:${f.StartLine}  ${f.RuleID}`);
    console.log(annotation(f));
  }
  console.log(`gitleaks: ${findings.length} finding(s)`);
  return findings.length ? 1 : 0;
}

if (isMain(import.meta.url)) process.exitCode = main();
