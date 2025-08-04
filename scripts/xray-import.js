#!/usr/bin/env node
// Import JUnit reports into an existing Xray Test Execution (BTWL-197).
//
//   XRAY_CLIENT_ID=... XRAY_CLIENT_SECRET=... \
//     node scripts/xray-import.js --execution BTWLQA-123 reports/*.xml
//   node scripts/xray-import.js --project BTWLQA reports/*.xml     (a new execution)
//
// Each file goes to Xray's JUnit import with `testExecKey`, so the results land in that execution.
// Xray matches every testcase to the Generic test whose definition is its `classname.name`
// (QA page "Test repository conventions").
import { readFileSync } from 'node:fs';

import { errorCommand, isMain } from './lib/actions.js';

export const XRAY_URL = 'https://xray.cloud.getxray.app';
const KEY = /^[A-Z][A-Z0-9]*-[1-9]\d*$/;

/**
 * @typedef {{ execution?: string, project?: string, files: string[] }} Args
 * @typedef {{ file: string, key: string }} Imported
 * @typedef {(url: string, init: { method: string, headers: Record<string, string>, body: string }) => Promise<{ ok: boolean, status: number, text: () => Promise<string> }>} Fetch
 */

/**
 * @param {string[]} argv
 * @returns {Args}
 */
export function parseArgs(argv) {
  /** @type {Args} */
  const args = { files: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--execution') args.execution = argv[++i];
    else if (argv[i] === '--project') args.project = argv[++i];
    else args.files.push(argv[i]);
  }
  return args;
}

/**
 * The reason a Test Execution key is refused, or undefined when it is a Jira key.
 * @param {string | undefined} key
 */
export function keyProblem(key) {
  if (!key) return 'no test execution key';
  if (!KEY.test(key)) return `"${key}" is not a Jira issue key such as BTWLQA-123`;
  return undefined;
}

/**
 * @param {Fetch} fetchFn
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {string} body
 */
async function post(fetchFn, url, headers, body) {
  const res = await fetchFn(url, { method: 'POST', headers, body });
  const text = await res.text();
  if (!res.ok)
    throw new Error(
      `Xray answered ${res.status} for ${url.replace(/\?.*$/, '')}: ${text.slice(0, 300)}`,
    );
  return text;
}

/**
 * Import each JUnit file into the Test Execution `execution`, or into a new one in `project`.
 * @param {{ execution?: string, project?: string, files: string[], clientId: string, clientSecret: string, baseUrl?: string, fetchFn?: Fetch, read?: (file: string) => string }} opts
 * @returns {Promise<Imported[]>}
 */
export async function importReports(opts) {
  const { execution, project, files, clientId, clientSecret } = opts;
  const baseUrl = opts.baseUrl ?? XRAY_URL;
  const fetchFn = opts.fetchFn ?? /** @type {Fetch} */ (/** @type {unknown} */ (fetch));
  const read = opts.read ?? ((/** @type {string} */ f) => readFileSync(f, 'utf8'));
  if (!execution && !project) throw new Error('give --execution <key> or --project <key>');
  const problem = execution ? keyProblem(execution) : undefined;
  if (problem) throw new Error(problem);
  if (files.length === 0) throw new Error('no JUnit reports given (reports/*.xml)');
  if (!clientId || !clientSecret)
    throw new Error('XRAY_CLIENT_ID and XRAY_CLIENT_SECRET are not set');
  const reports = files.map((file) => {
    const xml = read(file);
    if (!/<testsuites?\b/.test(xml)) throw new Error(`${file} is not a JUnit report`);
    return { file, xml };
  });
  const json = { 'Content-Type': 'application/json' };
  const auth = JSON.stringify({ client_id: clientId, client_secret: clientSecret });
  const token = JSON.parse(await post(fetchFn, `${baseUrl}/api/v2/authenticate`, json, auth));
  /** @type {Imported[]} */
  const done = [];
  for (const { file, xml } of reports) {
    const query = execution
      ? `testExecKey=${encodeURIComponent(execution)}`
      : `projectKey=${encodeURIComponent(project ?? '')}`;
    const url = `${baseUrl}/api/v2/import/execution/junit?${query}`;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'text/xml' };
    const answer = JSON.parse(await post(fetchFn, url, headers, xml));
    if (execution && answer.key !== execution) {
      throw new Error(`Xray put ${file} into ${answer.key}, not ${execution}`);
    }
    done.push({ file, key: answer.key });
  }
  return done;
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {Fetch} [fetchFn]
 */
export async function main(argv = process.argv.slice(2), env = process.env, fetchFn) {
  const args = parseArgs(argv);
  try {
    const done = await importReports({
      execution: args.execution,
      project: args.project,
      files: args.files,
      clientId: env.XRAY_CLIENT_ID ?? '',
      clientSecret: env.XRAY_CLIENT_SECRET ?? '',
      baseUrl: env.XRAY_URL || undefined,
      fetchFn,
    });
    for (const d of done) console.log(`xray: ${d.file} imported into ${d.key}`);
    return 0;
  } catch (e) {
    console.log(errorCommand(e instanceof Error ? e.message : String(e), { title: 'xray' }));
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main();
