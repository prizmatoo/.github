import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const WORKFLOWS_DIR = join(ROOT, '.github', 'workflows');

/**
 * @typedef {{ uses?: string, run?: string, with?: Record<string, unknown>, env?: Record<string, string>, if?: string, name?: string, id?: string }} Step
 * @typedef {{ 'runs-on'?: string, uses?: string, steps?: Step[], permissions?: Record<string, string> | string, if?: string, with?: Record<string, unknown>, needs?: string | string[] }} Job
 * @typedef {{ name?: string, on: Record<string, any>, permissions?: Record<string, string> | string, jobs: Record<string, Job> }} Workflow
 */

/** @returns {{ file: string, wf: Workflow }[]} */
export function loadWorkflows() {
  return readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
    .map((file) => ({ file, wf: parse(readFileSync(join(WORKFLOWS_DIR, file), 'utf8')) }));
}

/** @param {string} file */
export function loadWorkflow(file) {
  return /** @type {Workflow} */ (parse(readFileSync(join(WORKFLOWS_DIR, file), 'utf8')));
}

/** @param {Workflow} wf */
export function isReusable(wf) {
  return Object.prototype.hasOwnProperty.call(wf.on ?? {}, 'workflow_call');
}

/** @param {Workflow} wf */
export function allSteps(wf) {
  return Object.values(wf.jobs).flatMap((job) => job.steps ?? []);
}
