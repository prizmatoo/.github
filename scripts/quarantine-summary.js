#!/usr/bin/env node
// Quarantined tests in the job summary (BTWL-430). Every build that gets through make ci lists the
// tests the repo skips in CI while their fix waits, with the Jira bug, how long they have been
// quarantined and what this build did with them, so nobody forgets they are there.
//
//   node scripts/quarantine-summary.js <quarantine.json> [--junit reports/junit.xml] [--today YYYY-MM-DD]
//
// <quarantine.json> is the repo's own list (e.g. btwl-order-service test/quarantine.json):
//   { "tests": [{ "name", "file", "issue", "since", "skipInCiBetweenUtc"?: [from, to], "why"? }] }
// A repo without the file has nothing in quarantine. The table goes to $GITHUB_STEP_SUMMARY (stdout
// when it is not set). The step only reports: it exits 0 whatever it finds, and a list it cannot
// read is a warning annotation.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

import { isMain } from './lib/actions.js';

const JIRA = 'https://prizmato.atlassian.net/browse/';
const KEY = /^BTWL-\d+$/;

/**
 * @typedef {{ name: string, file?: string, issue?: string, since?: string,
 *   skipInCiBetweenUtc?: [string, string], why?: string }} Entry
 */

/**
 * The entries of a quarantine file.
 * @param {string} text
 * @returns {Entry[]}
 */
export function readQuarantine(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.tests)) {
    throw new Error('expected { "tests": [...] }');
  }
  return data.tests.map((/** @type {any} */ t, /** @type {number} */ i) => {
    if (!t || typeof t.name !== 'string' || t.name.trim() === '') {
      throw new Error(`tests[${i}] has no name`);
    }
    return /** @type {Entry} */ (t);
  });
}

/** @param {string} s */
function unescapeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * What a JUnit report says about the test called `name`: Vitest writes "describe > test", pytest
 * the function name, so the name matches the whole testcase name or its last " > " part.
 * @param {string} xml
 * @param {string} name
 * @returns {'passed' | 'failed' | 'skipped' | undefined}
 */
export function junitOutcome(xml, name) {
  const cases = xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g);
  for (const [, attrs, , body = ''] of cases) {
    const raw = /\bname="([^"]*)"/.exec(attrs ?? '')?.[1];
    if (raw === undefined) continue;
    const full = unescapeXml(raw);
    if (full !== name && !full.endsWith(` > ${name}`)) continue;
    if (/<(failure|error)\b/.test(body)) return 'failed';
    if (/<skipped\b/.test(body)) return 'skipped';
    return 'passed';
  }
  return undefined;
}

/**
 * Whole days from `since` to `today` (both YYYY-MM-DD).
 * @param {string} since
 * @param {string} today
 */
export function daysSince(since, today) {
  return Math.round((Date.parse(today) - Date.parse(since)) / 86_400_000);
}

/**
 * Markdown for the job summary.
 * @param {Entry[]} entries
 * @param {{ junit?: string, today: string, source: string }} opts
 */
export function render(entries, { junit, today, source }) {
  const lines = ['### Quarantined tests', ''];
  if (entries.length === 0) {
    lines.push(`None (\`${source}\`).`, '');
    return lines.join('\n');
  }
  lines.push(
    `${entries.length} test${entries.length === 1 ? '' : 's'} in \`${source}\`. Remove an entry in the PR that fixes the test.`,
    '',
    '| Test | File | Jira | Quarantined since | Skipped in CI (UTC) | This build |',
    '| ---- | ---- | ---- | ----------------- | ------------------- | ---------- |',
  );
  for (const e of entries) {
    const issue =
      e.issue && KEY.test(e.issue) ? `[${e.issue}](${JIRA}${e.issue})` : '**no Jira key**';
    const since = e.since ? `${e.since} (${daysSince(e.since, today)} days)` : '';
    const window = e.skipInCiBetweenUtc ? e.skipInCiBetweenUtc.join('–') : 'always';
    const outcome =
      junit === undefined
        ? 'no JUnit report'
        : (junitOutcome(junit, e.name) ?? 'not in the report');
    const cells = [e.name, e.file ? `\`${e.file}\`` : '', issue, since, window, outcome];
    lines.push(`| ${cells.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * @param {string[]} argv
 * @returns {{ file?: string, junit?: string, today?: string }}
 */
export function parseArgs(argv) {
  /** @type {{ file?: string, junit?: string, today?: string }} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--junit') out.junit = argv[++i];
    else if (a === '--today') out.today = argv[++i];
    else out.file = a;
  }
  return out;
}

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 * @returns {string} what was written
 */
export function main(argv, env = process.env) {
  const args = parseArgs(argv);
  const source = args.file || 'test/quarantine.json';
  const today = args.today || new Date().toISOString().slice(0, 10);
  /** @type {Entry[]} */
  let entries = [];
  const notes = [];
  if (existsSync(source)) {
    try {
      entries = readQuarantine(readFileSync(source, 'utf8'));
    } catch (e) {
      notes.push(
        `::warning title=quarantine::${source} could not be read: ${/** @type {Error} */ (e).message}`,
      );
    }
  }
  for (const e of entries) {
    if (!e.issue || !KEY.test(e.issue)) {
      notes.push(`::warning title=quarantine::quarantined test without a Jira key: ${e.name}`);
    }
  }
  const junit = args.junit && existsSync(args.junit) ? readFileSync(args.junit, 'utf8') : undefined;
  const md = render(entries, { junit, today, source });
  for (const n of notes) console.log(n);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, md + '\n');
  else console.log(md);
  return md;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2));
}
