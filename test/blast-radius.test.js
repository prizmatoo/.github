import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  blastRadius,
  findProduced,
  parseArgs,
  readCatalog,
  run,
  summarise,
} from '../scripts/blast-radius.js';
import { ROOT } from './helpers.js';

const catalog = readCatalog(readFileSync(join(ROOT, 'service-catalog.yaml'), 'utf8'));

/** @param {string} text */
function catalogFile(text) {
  const path = join(mkdtempSync(join(tmpdir(), 'catalog-')), 'service-catalog.yaml');
  writeFileSync(path, text);
  return path;
}

// Three repos: a producer, a consumer that builds a file from the event and serves an API, and a
// reader of that API that should stay out of the event's radius.
const SMALL = `version: 2
repos:
  - name: a
    owner_team: Platform
    primary: p1
    backup: b1
    jira_component: a
    produces: [{ kind: event, name: thing.done.v1, event: ThingDone, version: 1 }]
    consumes: []
  - name: b
    owner_team: Order-to-Cash
    primary: p2
    backup: b2
    jira_component: b
    produces:
      - { kind: api, name: b }
      - { kind: file, name: b-file, to: [Ledgerline], from: [thing.done.v1] }
    consumes: [{ kind: event, name: thing.done.v1, group: b }]
  - name: c
    owner_team: Warehouse Systems
    primary: p3
    backup: b3
    jira_component: c
    produces: []
    consumes: [{ kind: api, name: b }, { kind: file, name: b-file }]
`;

describe('blast-radius.js', () => {
  it('finds an event by name across its majors, or one topic by its name', () => {
    assert.deepEqual(
      findProduced(catalog, 'OrderShipped').map((p) => p.item.name),
      ['order.shipped.v1', 'order.shipped.v2'],
    );
    assert.deepEqual(
      findProduced(catalog, 'order.shipped.v1').map((p) => p.repo.name),
      ['btwl-order-service'],
    );
  });

  it('resolves OrderShipped to billing, inventory and finance-export', () => {
    const nodes = blastRadius(catalog, 'OrderShipped');
    assert.deepEqual(summarise(nodes), {
      radius: ['btwl-billing-service', 'btwl-inventory-service', 'finance-export'],
      teams: ['Order-to-Cash', 'Warehouse Systems'],
      external: ['Ledgerline'],
    });
    const v1 = nodes.find((n) => n.item.name === 'order.shipped.v1');
    assert.deepEqual(
      v1?.consumers.map((c) => [c.repo.name, c.via.group]),
      [
        ['btwl-billing-service', 'btwl-billing-service'],
        ['btwl-inventory-service', 'btwl-inventory-service'],
      ],
    );
  });

  it('follows a consumer only through what it produces from the item, not its own API', () => {
    const path = catalogFile(SMALL);
    const nodes = blastRadius(readCatalog(readFileSync(path, 'utf8')), 'ThingDone');
    // c reads b's API and b's file: only the file carries the event on.
    assert.deepEqual(summarise(nodes).radius, ['b', 'c', 'b-file']);
    assert.deepEqual(summarise(blastRadius(readCatalog(SMALL), 'b')).radius, ['c']);
  });

  it('prints every topic, the consumers, what they pass it on in, and who to involve', () => {
    const { code, out } = run(['OrderShipped']);
    assert.equal(code, 0);
    assert.equal(
      out,
      [
        'OrderShipped, produced by btwl-order-service:',
        '  order.shipped.v1',
        '    btwl-billing-service (Order-to-Cash; krunal-prizmato, backup venkat-prizmato), consumer group btwl-billing-service',
        '      passes it on in finance-export (file), read by Ledgerline',
        '    btwl-inventory-service (Warehouse Systems; sathwik-prizmato, backup aaquib-prizmato), consumer group btwl-inventory-service, since 2.0.0',
        '  order.shipped.v2 (behind orders.events.v2, from 1.5.0)',
        '    no consumers yet',
        '',
        'Blast radius: btwl-billing-service, btwl-inventory-service, finance-export',
        'Teams to involve: Order-to-Cash, Warehouse Systems',
        'Outside the org: Ledgerline',
      ].join('\n'),
    );
  });

  it('prints nested consumers of a passed-on item', () => {
    const { out } = run(['thing.done.v1', '--catalog', catalogFile(SMALL)]);
    assert.match(out, /passes it on in b-file \(file\), read by Ledgerline\n {8}c \(Warehouse/);
  });

  it('answers in JSON with --json', () => {
    const { code, out } = run(['order.shipped.v1', '--json']);
    assert.equal(code, 0);
    const json = JSON.parse(out);
    assert.equal(json.items[0].producer, 'btwl-order-service');
    const billing = json.items[0].consumers.find(
      (/** @type {any} */ c) => c.repo === 'btwl-billing-service',
    );
    assert.equal(billing.group, 'btwl-billing-service');
    assert.deepEqual(
      billing.passes_on.map((/** @type {any} */ p) => [p.name, p.to]),
      [['finance-export', ['Ledgerline']]],
    );
    assert.deepEqual(json.radius, [
      'btwl-billing-service',
      'btwl-inventory-service',
      'finance-export',
    ]);
  });

  it('names the outside readers of a file asked about directly', () => {
    const { out } = run(['finance-export']);
    assert.match(out, /^ {2}finance-export, read by Ledgerline$/m);
    assert.match(out, /^Outside the org: Ledgerline$/m);
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
