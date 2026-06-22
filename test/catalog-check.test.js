import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { check, run } from '../scripts/catalog-check.js';
import { ROOT } from './helpers.js';

const CATALOG = readFileSync(join(ROOT, 'service-catalog.yaml'), 'utf8');
const SCHEMA = JSON.parse(readFileSync(join(ROOT, 'service-catalog.schema.json'), 'utf8'));

/**
 * The catalog with one line of btwl-billing-service's entry replaced.
 * @param {RegExp} line
 * @param {string} by
 */
function billingWith(line, by) {
  const start = CATALOG.indexOf('  - name: btwl-billing-service');
  const end = CATALOG.indexOf('  - name: ', start + 1);
  const entry = CATALOG.slice(start, end);
  assert.match(entry, line);
  return CATALOG.slice(0, start) + entry.replace(line, by) + CATALOG.slice(end);
}

/** @param {string} text */
function file(text) {
  const path = join(mkdtempSync(join(tmpdir(), 'catalog-')), 'service-catalog.yaml');
  writeFileSync(path, text);
  return path;
}

describe('catalog-check.js', () => {
  it('passes the catalog as it is', () => {
    assert.deepEqual(check(CATALOG, SCHEMA), []);
    assert.deepEqual(run([]), {
      code: 0,
      out: ['service-catalog.yaml: matches service-catalog.schema.json'],
    });
  });

  it('fails an entry without an owner, naming the repo (BTWL-497 AC)', () => {
    const text = billingWith(/^ {4}owner_team: Order-to-Cash\n/m, '');
    const problems = check(text, SCHEMA);
    assert.deepEqual(
      problems.map((p) => p.message),
      ['btwl-billing-service: missing owner_team'],
    );
    const { code, out } = run([file(text)]);
    assert.equal(code, 1);
    assert.match(
      out[0] ?? '',
      /^::error file=service-catalog\.yaml,line=\d+,title=catalog::btwl-billing-service: missing owner_team$/,
    );
  });

  it('points the annotation at the line of the field it is about', () => {
    const text = billingWith(/jira_component: btwl-billing-service/, 'jira_component: billing');
    const [problem] = check(text, SCHEMA);
    assert.match(
      problem?.message ?? '',
      /^btwl-billing-service: jira_component must match pattern/,
    );
    const line = text.split('\n').findIndex((l) => l.includes('jira_component: billing')) + 1;
    assert.equal(problem?.line, line);
  });

  it('names an unknown squad and the ones it knows', () => {
    const text = billingWith(/owner_team: Order-to-Cash/, 'owner_team: Billing');
    assert.match(
      check(text, SCHEMA)[0]?.message ?? '',
      /owner_team must be equal to one of the allowed values: Platform, Order-to-Cash/,
    );
  });

  it('needs a consumer group on a consumed event and a contract on a produced one', () => {
    const noGroup = billingWith(/, group: btwl-billing-service/, '');
    assert.match(
      check(noGroup, SCHEMA)[0]?.message ?? '',
      /^btwl-billing-service: consumes\.0 missing group$/,
    );
    const order = CATALOG.replace(
      '        contract: contracts/events/OrderConfirmed.v1.schema.json\n',
      '',
    );
    assert.deepEqual(
      check(order, SCHEMA).map((p) => p.message),
      ['btwl-order-service: produces.1 missing contract'],
    );
  });

  it('refuses an unknown field and a catalog that is not version 2', () => {
    const extra = billingWith(/^ {4}language: (.*)$/m, '    language: $1\n    slack: "#billing"');
    assert.deepEqual(
      check(extra, SCHEMA).map((p) => p.message),
      ['btwl-billing-service: unknown field slack'],
    );
    const v1 = CATALOG.replace(/^version: 2$/m, 'version: 1');
    assert.match(
      check(v1, SCHEMA)[0]?.message ?? '',
      /^service-catalog\.yaml: version must be equal to constant/,
    );
  });

  it('reports YAML that does not parse, with its line', () => {
    const [problem] = check('version: 2\nrepos:\n  - name: [unclosed\n', SCHEMA);
    assert.equal(problem?.repo, 'service-catalog.yaml');
    assert.equal(typeof problem?.line, 'number');
  });

  it('takes the catalog and the schema from its arguments', () => {
    const schema = join(mkdtempSync(join(tmpdir(), 'schema-')), 'schema.json');
    writeFileSync(schema, JSON.stringify({ type: 'object', required: ['owners'] }));
    const { code, out } = run([file(CATALOG), '--schema', schema]);
    assert.equal(code, 1);
    assert.match(out[0] ?? '', /service-catalog\.yaml: missing owners/);
  });
});
