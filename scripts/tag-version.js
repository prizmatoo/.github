#!/usr/bin/env node
// Release guard: the pushed tag must be v<version from package.json>.
// Writes name and version to $GITHUB_OUTPUT when it runs in Actions.
//
//   node scripts/tag-version.js <tag> [package.json]
import { appendFileSync, readFileSync } from 'node:fs';

import { errorCommand, isMain } from './lib/actions.js';

const SEMVER_TAG = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/**
 * @param {string} tag e.g. "v1.0.0"
 * @param {{ name?: string, version?: string }} pkg
 * @returns {{ ok: true, version: string } | { ok: false, problem: string }}
 */
export function checkTag(tag, pkg) {
  const m = SEMVER_TAG.exec(tag);
  if (!m) return { ok: false, problem: `tag "${tag}" is not v<semver>` };
  if (m[1] !== pkg.version) {
    return { ok: false, problem: `tag ${tag} does not match package.json version ${pkg.version}` };
  }
  return { ok: true, version: m[1] };
}

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 * @returns {number} exit code
 */
export function main(argv = process.argv.slice(2), env = process.env) {
  const [tag, pkgPath = 'package.json'] = argv;
  if (!tag) {
    console.error('usage: tag-version.js <tag> [package.json]');
    return 2;
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const result = checkTag(tag, pkg);
  if (!result.ok) {
    console.log(errorCommand(result.problem, { title: 'release' }));
    return 1;
  }
  console.log(`release: ${pkg.name}@${result.version}`);
  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, `name=${pkg.name}\nversion=${result.version}\n`);
  }
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main();
