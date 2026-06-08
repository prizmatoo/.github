import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { blastRadius, findProduced, parseArgs, readCatalog, run } from '../scripts/blast-radius.js';
import { ROOT } from './helpers.js';

const catalog = readCatalog(readFileSync(join(ROOT, 'service-catalog.yaml'), 'utf8'));

/** @param {string} text */
function catalogFile(text) {
  const path = join(mkdtempSync(join(tmpdir(), 'catalog-')), 'service-catalog.yaml');
  writeFileSync(path, text);
  return path;
}

describe('blast-radius.js', () => {
  it('finds an event by name across its majors, or one topic by its name', () => {
    assert.deepEqual(
      findProduced(catalog, 'OrderShipped').map((p) => p.item.name),
      findProduced(catalog, 'OrderShipped')
        .map((p) => p.item.name)
        .filter((n) => n.startsWith('order.shipped.v')),
    );
    assert.deepEqual(
      findProduced(catalog, 'order.shipped.v1').map((p) => p.repo.name),
      ['btwl-order-service'],
    );
  });

  it('lists the consumers of OrderShipped v1 with their consumer groups', () => {
    const { hits } = blastRadius(catalog, 'order.shipped.v1');
    const direct = hits.filter((h) => h.depth === 0);
    assert.deepEqual(direct.map((h) => [h.repo.name, h.via.group]).sort(), [
      ['btwl-billing-service', 'btwl-billing-service'],
      ['btwl-inventory-service', 'btwl-inventory-service'],
    ]);
  });

  it('follows what the consumers produce, once each', () => {
    const { hits } = blastRadius(catalog, '@btwl/pricing');
    const names = hits.map((h) => h.repo.name);
    assert.deepEqual(names, [...new Set(names)]);
    assert.ok(names.includes('btwl-order-service') && names.includes('btwl-billing-service'));
  });

  it('prints the radius and the teams to involve', () => {
    const { code, out } = run(['OrderShipped']);
    assert.equal(code, 0);
    assert.match(out, /^OrderShipped, produced by btwl-order-service:$/m);
    assert.match(out, /consumer group btwl-inventory-service, since 2\.0\.0/);
    assert.match(out, /^Blast radius: .*btwl-billing-service/m);
    assert.match(out, /^Teams to involve: .*Order-to-Cash/m);
  });

  it('answers in JSON with --json', () => {
    const { code, out } = run(['order.shipped.v1', '--json']);
    assert.equal(code, 0);
    const json = JSON.parse(out);
    assert.deepEqual(json.producers, ['btwl-order-service']);
    assert.ok(
      json.consumers.some(
        (/** @type {any} */ c) =>
          c.repo === 'btwl-billing-service' && c.group === 'btwl-billing-service',
      ),
    );
  });

  it('exits 2 for a name nothing produces, listing the events it knows', () => {
    const { code, out } = run(['OrderCancelled']);
    assert.equal(code, 2);
    assert.match(out, /nothing in the catalog produces OrderCancelled \(events: .*OrderShipped/);
    assert.equal(run([]).code, 2);
  });

  it('refuses a version 1 catalog', () => {
    const path = catalogFile('version: 1\nrepos: []\n');
    assert.throws(() => run(['OrderShipped', '--catalog', path]), /needs version 2/);
  });

  it('parses its arguments', () => {
    assert.deepEqual(parseArgs(['x', '--json', '--catalog', 'c.yaml']), {
      name: 'x',
      json: true,
      catalog: 'c.yaml',
    });
  });
});
