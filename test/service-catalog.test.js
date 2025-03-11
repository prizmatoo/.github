// Validates service-catalog.yaml: every repo has a complete entry, owners are org members,
// components follow the btwl-* naming, and this repo's own CODEOWNERS agrees with its entry.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parse } from 'yaml';

import { ROOT } from './helpers.js';

/**
 * @typedef {{ name: string, description: string, owner_team: string, primary: string, backup: string,
 *   jira_component: string, confluence_space: string, confluence_page: string, language: string,
 *   paths: string[] }} Entry
 */

const catalog = /** @type {{ version: number, repos: Entry[] }} */ (
  parse(readFileSync(join(ROOT, 'service-catalog.yaml'), 'utf8'))
);

const REQUIRED = /** @type {const} */ ([
  'name',
  'description',
  'owner_team',
  'primary',
  'backup',
  'jira_component',
  'confluence_space',
  'confluence_page',
  'language',
]);

const TEAMS = [
  'Platform',
  'Order-to-Cash',
  'Procurement & Spend',
  'Warehouse Systems',
  'Quality',
  'Application Support',
];

// The org's members (GitHub logins).
const MEMBERS = [
  'sourya-prizmato',
  'aaquib-prizmato',
  'shubham-prizmato',
  'krunal-prizmato',
  'venkat-prizmato',
  'sathwik-prizmato',
  'cei-prizmato',
  'gehna-prizmato',
  'Dharma-prizmato',
];

describe('service-catalog.yaml', () => {
  it('is version 1 with a list of repos', () => {
    assert.equal(catalog.version, 1);
    assert.ok(Array.isArray(catalog.repos) && catalog.repos.length > 0);
  });

  it('has one entry per repo name', () => {
    const names = catalog.repos.map((r) => r.name);
    assert.deepEqual(names, [...new Set(names)]);
  });

  it('lists the repos of the org', () => {
    const names = catalog.repos.map((r) => r.name).sort();
    assert.deepEqual(names, [
      '.github',
      'btwl-auth-gateway',
      'btwl-order-service',
      'btwl-pricing-lib',
      'btwl-procurement-api',
    ]);
  });

  for (const entry of catalog.repos) {
    describe(entry.name, () => {
      it('has every required field, non-empty', () => {
        for (const field of REQUIRED) {
          assert.equal(typeof entry[field], 'string', `${field} missing`);
          assert.notEqual(entry[field].trim(), '', `${field} empty`);
        }
      });

      it('names a known owner team', () => {
        assert.ok(TEAMS.includes(entry.owner_team), entry.owner_team);
      });

      it('has an org member as primary and a different one as backup', () => {
        assert.ok(MEMBERS.includes(entry.primary), `primary ${entry.primary}`);
        assert.ok(MEMBERS.includes(entry.backup), `backup ${entry.backup}`);
        assert.notEqual(entry.primary, entry.backup);
      });

      it('uses a btwl-* Jira component named after the repo', () => {
        const expected = entry.name === '.github' ? 'btwl-shared-ci' : entry.name;
        assert.equal(entry.jira_component, expected);
      });

      it('points at the BTWL Confluence space', () => {
        assert.equal(entry.confluence_space, 'BTWL');
      });

      it('lists relative path globs for the component', () => {
        assert.ok(Array.isArray(entry.paths) && entry.paths.length > 0, 'paths missing');
        for (const glob of entry.paths) {
          assert.equal(typeof glob, 'string');
          assert.doesNotMatch(glob, /^\/|^\.\//, `${glob} must be relative to the repo root`);
        }
      });
    });
  }

  it("agrees with this repo's CODEOWNERS", () => {
    const self = catalog.repos.find((r) => r.name === '.github');
    const codeowners = readFileSync(join(ROOT, 'CODEOWNERS'), 'utf8');
    const rule = codeowners.split('\n').find((l) => l.startsWith('*'));
    assert.deepEqual(rule?.split(/\s+/).slice(1), [`@${self?.primary}`, `@${self?.backup}`]);
  });
});
