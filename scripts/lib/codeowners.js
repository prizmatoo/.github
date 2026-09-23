// Reads a repo's CODEOWNERS and returns the individual owners in it.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Where GitHub looks for CODEOWNERS, in its order.
export const LOCATIONS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

/**
 * Individual owners (@login) named anywhere in the file, lower-cased.
 * Team owners (@org/team) are left out: resolving team membership needs more than a read token.
 * @param {string} text
 * @returns {Set<string>}
 */
export function parseOwners(text) {
  const owners = new Set();
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    for (const token of line.split(/\s+/).slice(1)) {
      if (/^@[A-Za-z0-9-]+$/.test(token)) owners.add(token.slice(1).toLowerCase());
    }
  }
  return owners;
}

/**
 * @param {string} dir repo checkout
 * @returns {Set<string> | undefined} undefined when the repo has no CODEOWNERS
 */
export function readOwners(dir) {
  const found = LOCATIONS.map((p) => join(dir, p)).find((p) => existsSync(p));
  return found ? parseOwners(readFileSync(found, 'utf8')) : undefined;
}
