#!/usr/bin/env node
// pr-check: a pull request follows the Jira <-> GitHub traceability rules.
//
//   branch  BTWL-<n>, or BTWL-<n>-<m> for a follow-up PR after the first one merged
//   title   "[BTWL-<n>] <Jira summary>", same key as the branch
//   body    links https://prizmato.atlassian.net/browse/BTWL-<n> (the PR template has the line)
//
// Reads PR_BRANCH, PR_TITLE and PR_BODY from the environment. Reports failures as error
// annotations and a non-zero exit code; it never comments on the PR.
import { errorCommand, isMain } from './lib/actions.js';

export const JIRA_BROWSE = 'https://prizmato.atlassian.net/browse/';

const BRANCH_RE = /^(BTWL-[1-9]\d*)(?:-[1-9]\d*)?$/;
const TITLE_RE = /^\[(BTWL-[1-9]\d*)\] \S/;

/**
 * Does the body link exactly this issue (BTWL-4 must not match a link to BTWL-42)?
 * @param {string} body
 * @param {string} key
 */
export function linksIssue(body, key) {
  const url = (JIRA_BROWSE + key).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return new RegExp(`${url}(?![0-9])`).test(body);
}

/**
 * @param {{ branch: string, title: string, body: string }} pr
 * @returns {string[]} problems; empty when the PR follows the rules
 */
export function checkPullRequest({ branch, title, body }) {
  const problems = [];
  const branchKey = BRANCH_RE.exec(branch)?.[1];
  const titleKey = TITLE_RE.exec(title)?.[1];

  if (!branchKey) {
    problems.push(
      `branch "${branch}" is not a Jira key: name it BTWL-<n> (BTWL-<n>-2 for a follow-up PR)`,
    );
  }
  if (!titleKey) {
    problems.push(`title must start with "[BTWL-<n>] " followed by the Jira summary: "${title}"`);
  } else if (branchKey && titleKey !== branchKey) {
    problems.push(`title key ${titleKey} does not match branch key ${branchKey}`);
  }

  const key = branchKey ?? titleKey;
  if (key && !linksIssue(body, key)) {
    problems.push(`body must link the Jira issue: ${JIRA_BROWSE}${key}`);
  }
  return problems;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {number} exit code
 */
export function main(env = process.env) {
  const problems = checkPullRequest({
    branch: env.PR_BRANCH ?? '',
    title: env.PR_TITLE ?? '',
    body: env.PR_BODY ?? '',
  });
  for (const p of problems) console.log(errorCommand(p, { title: 'pr-check' }));
  if (problems.length === 0) console.log('pr-check: branch, title and Jira link follow the rules');
  return problems.length ? 1 : 0;
}

if (isMain(import.meta.url)) process.exitCode = main();
