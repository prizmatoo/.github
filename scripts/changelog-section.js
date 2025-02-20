#!/usr/bin/env node
// Prints the CHANGELOG.md section of one version (Keep a Changelog), without its heading,
// for the GitHub release notes. Fails when the version has no section.
//
//   node scripts/changelog-section.js <CHANGELOG.md> <version>
import { readFileSync } from 'node:fs';

import { errorCommand, isMain } from './lib/actions.js';

/**
 * @param {string} changelog
 * @param {string} version e.g. "1.0.0"
 * @returns {string | undefined} section body, trimmed; undefined when there is none
 */
export function section(changelog, version) {
  const lines = changelog.split('\n');
  const heading = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`);
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return undefined;
  let end = lines.findIndex((l, i) => i > start && /^## |^\[[^\]]+\]: /.test(l));
  if (end < 0) end = lines.length;
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
}

/**
 * @param {string[]} argv
 * @returns {number} exit code
 */
export function main(argv = process.argv.slice(2)) {
  const [path, version] = argv;
  if (!path || !version) {
    console.error('usage: changelog-section.js <CHANGELOG.md> <version>');
    return 2;
  }
  const body = section(readFileSync(path, 'utf8'), version);
  if (!body) {
    console.error(errorCommand(`${path} has no "## [${version}]" section`, { title: 'release' }));
    return 1;
  }
  console.log(body);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main();
