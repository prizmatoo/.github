#!/usr/bin/env node
// regression-test: a bug-fix PR that changes src/ must also add or change a test.
//
// A PR is a bug fix when "Bug Fix" or "Hot Fix" is ticked in the PR template, or it carries the
// `bug` or `hotfix` label.
// Stories, tasks and spikes (nothing ticked) are skipped. The Jira issue type is not looked up:
// that would need a Jira token in Actions, and CI here only reads GitHub.
//
//   node scripts/regression-test.js <changed-files.txt>
//
// A config-only fix can go without a test when a reviewer applies the `no-regression-test`
// label and the PR body says why, on a line "No regression test: <reason>". The label only counts
// when it was applied by a CODEOWNER who is not the PR author (read from the PR's label events).
//
// Reads PR_BODY, PR_LABELS (JSON array of label names), PR_NUMBER, PR_AUTHOR, GITHUB_REPOSITORY,
// GITHUB_API_URL and GITHUB_TOKEN (read-only) from the environment.
import { readFileSync } from 'node:fs';

import { errorCommand, isMain } from './lib/actions.js';
import { readOwners } from './lib/codeowners.js';
import { labelActor } from './lib/github.js';

export const MESSAGE = 'bug fixes need a regression test';
export const NO_TEST_LABEL = 'no-regression-test';

// GitHub renders "- [x]" and "- [X]" (and "*" bullets) as the same ticked box.
const BUG_FIX_RE = /^\s*[-*] \[[xX]\] (?:Bug Fix|Hot Fix)\s*$/m;
const BUG_LABELS = ['bug', 'hotfix'];
const TEST_DIRS = new Set(['test', 'tests', '__tests__']);
const REASON_RE = /^\s*No regression test:[ \t]*(.*)$/im;
const MIN_REASON = 10;

/**
 * @param {{ body: string, labels: string[] }} pr
 */
export function isBugFix({ body, labels }) {
  return BUG_FIX_RE.test(body) || labels.some((l) => BUG_LABELS.includes(l));
}

/** @param {string} file */
export function isSourceChange(file) {
  return file.startsWith('src/');
}

/** @param {string} file */
export function isTestChange(file) {
  // A directory named test/, tests/ or __tests__ anywhere in the path; not "src/testdata.ts".
  return file
    .split('/')
    .slice(0, -1)
    .some((dir) => TEST_DIRS.has(dir));
}

/**
 * The reason given for skipping the regression test, if any.
 * @param {string} body
 */
export function noTestReason(body) {
  return REASON_RE.exec(body)?.[1].trim() ?? '';
}

/**
 * @param {{ files: string[], body: string, labels: string[] }} pr
 * @returns {{ result: 'skip' | 'pass' | 'fail', reason: string, viaLabel?: true }}
 */
export function evaluate({ files, body, labels }) {
  if (!isBugFix({ body, labels })) {
    return {
      result: 'skip',
      reason: 'not a bug fix (tick "Bug Fix" or "Hot Fix" in the PR template if it is)',
    };
  }
  if (!files.some(isSourceChange)) return { result: 'pass', reason: 'no change under src/' };
  if (files.some(isTestChange)) return { result: 'pass', reason: 'a test was added or changed' };
  if (labels.includes(NO_TEST_LABEL)) {
    const why = noTestReason(body);
    if (why.length >= MIN_REASON) {
      return { result: 'pass', reason: `${NO_TEST_LABEL}: ${why}`, viaLabel: true };
    }
    return {
      result: 'fail',
      reason: `${NO_TEST_LABEL} needs a reason: add a line "No regression test: <why>" to the PR body`,
    };
  }
  return { result: 'fail', reason: `${MESSAGE}: src/ changed but nothing under test/ or tests/` };
}

/**
 * The label has to come from a CODEOWNER, and not from the author of the PR.
 * @param {{ actor: string | undefined, author: string, owners: Set<string> | undefined }} who
 * @returns {string | undefined} the problem, or undefined when the label counts
 */
export function labelProblem({ actor, author, owners }) {
  if (!actor) return `could not tell who applied ${NO_TEST_LABEL}`;
  const login = actor.toLowerCase();
  if (login === author.toLowerCase()) {
    return `${NO_TEST_LABEL} was applied by the PR author; a CODEOWNER other than the author applies it`;
  }
  if (!owners) return `${NO_TEST_LABEL} needs a CODEOWNERS file to check who may apply it`;
  if (!owners.has(login))
    return `${NO_TEST_LABEL} was applied by @${actor}, who is not a CODEOWNER`;
  return undefined;
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
 * @param {{ fetch?: import('./lib/github.js').Fetch, cwd?: string }} [deps]
 * @returns {Promise<number>} exit code
 */
export async function main(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const [filesPath] = argv;
  if (!filesPath) {
    console.error('usage: regression-test.js <changed-files.txt>');
    return 2;
  }
  const files = readFileSync(filesPath, 'utf8').split('\n').filter(Boolean);
  let { result, reason, viaLabel } = evaluate({
    files,
    body: env.PR_BODY ?? '',
    labels: parseLabels(env.PR_LABELS),
  });

  if (viaLabel) {
    const actor = await labelActor({
      fetch: deps.fetch ?? globalThis.fetch,
      apiUrl: env.GITHUB_API_URL ?? 'https://api.github.com',
      repo: env.GITHUB_REPOSITORY ?? '',
      number: env.PR_NUMBER ?? '',
      token: env.GITHUB_TOKEN ?? '',
      label: NO_TEST_LABEL,
    });
    const owners = readOwners(deps.cwd ?? process.cwd());
    const problem = labelProblem({ actor, author: env.PR_AUTHOR ?? '', owners });
    if (problem) [result, reason] = ['fail', problem];
    else reason += ` (label applied by @${actor})`;
  }

  if (result === 'fail') {
    console.log(errorCommand(reason, { title: 'regression-test' }));
    return 1;
  }
  console.log(`regression-test: ${result === 'skip' ? 'skipped' : 'ok'}, ${reason}`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = await main();
