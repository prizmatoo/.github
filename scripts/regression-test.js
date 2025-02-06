#!/usr/bin/env node
// regression-test: a bug-fix PR that changes src/ must also add or change a test.
//
// A PR is a bug fix when "Bug Fix" is ticked in the PR template, or it carries the `bug` label.
// Stories, tasks and spikes (nothing ticked) are skipped. The Jira issue type is not looked up:
// that would need a Jira token in Actions, and CI here only reads GitHub.
//
//   node scripts/regression-test.js <changed-files.txt>
//
// Reads PR_BODY and PR_LABELS (JSON array of label names) from the environment.
import { readFileSync } from 'node:fs';

import { errorCommand, isMain } from './lib/actions.js';

export const MESSAGE = 'bug fixes need a regression test';

const BUG_FIX_RE = /^\s*- \[x\] Bug Fix\b/m;

/**
 * @param {{ body: string, labels: string[] }} pr
 */
export function isBugFix({ body, labels }) {
  return BUG_FIX_RE.test(body) || labels.includes('bug');
}

/** @param {string} file */
export function isSourceChange(file) {
  return file.startsWith('src/');
}

/** @param {string} file */
export function isTestChange(file) {
  return file.startsWith('test/') || file.startsWith('tests/') || file.includes('/test');
}

/**
 * @param {{ files: string[], body: string, labels: string[] }} pr
 * @returns {{ result: 'skip' | 'pass' | 'fail', reason: string }}
 */
export function evaluate({ files, body, labels }) {
  if (!isBugFix({ body, labels })) {
    return { result: 'skip', reason: 'not a bug fix (tick "Bug Fix" in the PR template if it is)' };
  }
  if (!files.some(isSourceChange)) return { result: 'pass', reason: 'no change under src/' };
  if (files.some(isTestChange)) return { result: 'pass', reason: 'a test was added or changed' };
  return { result: 'fail', reason: `${MESSAGE}: src/ changed but nothing under test/ or tests/` };
}

/**
 * @param {string | undefined} raw
 * @returns {string[]}
 */
export function parseLabels(raw) {
  if (!raw) return [];
  const labels = JSON.parse(raw);
  return Array.isArray(labels) ? labels.map(String) : [];
}

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 * @returns {number} exit code
 */
export function main(argv = process.argv.slice(2), env = process.env) {
  const [filesPath] = argv;
  if (!filesPath) {
    console.error('usage: regression-test.js <changed-files.txt>');
    return 2;
  }
  const files = readFileSync(filesPath, 'utf8').split('\n').filter(Boolean);
  const { result, reason } = evaluate({
    files,
    body: env.PR_BODY ?? '',
    labels: parseLabels(env.PR_LABELS),
  });
  if (result === 'fail') {
    console.log(errorCommand(reason, { title: 'regression-test' }));
    return 1;
  }
  console.log(`regression-test: ${result === 'skip' ? 'skipped' : 'ok'}, ${reason}`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main();
