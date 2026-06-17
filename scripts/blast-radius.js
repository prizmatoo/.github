#!/usr/bin/env node
// Blast radius of a change, from service-catalog.yaml (BTWL-495): who consumes an event, API,
// file, library or workflow, and what those consumers pass it on in, so the PR author knows which
// teams to involve before changing a contract.
//
//   node scripts/blast-radius.js <name> [--catalog service-catalog.yaml] [--json]
//
// <name> is anything a catalog entry produces (order.shipped.v1, btwl-billing-service,
// @btwl/pricing, finance-export, ci-node.yml) or an event name for all of its majors (OrderShipped).
// Exits 2 when nothing in the catalog has that name.
//
// The radius follows a consumer further only through what it produces `from` the changed item (a
// file built from the event's fields, say), not through everything it produces: a consumer that
// absorbs the change in its own code keeps its own API as it was.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { isMain } from './lib/actions.js';

const DEFAULT_CATALOG = fileURLToPath(new URL('../service-catalog.yaml', import.meta.url));

/**
 * @typedef {{ kind: string, name: string, event?: string, version?: number, group?: string,
 *   to?: string[], from?: string[], flag?: string, since?: string }} Item
 * @typedef {{ name: string, owner_team: string, primary: string, backup: string,
 *   jira_component: string, produces?: Item[], consumes?: Item[] }} Entry
 * @typedef {{ version: number, repos: Entry[] }} Catalog
 * @typedef {{ repo: Entry, via: Item, passesOn: Node[] }} Consumer
 *   a repo that consumes the node's item (`via` is its consumes line) and what it passes it on in
 * @typedef {{ repo: Entry, item: Item, consumers: Consumer[] }} Node
 *   a produced item and its consumers
 */

/** @param {string} text */
export function readCatalog(text) {
  const catalog = /** @type {Catalog} */ (parse(text));
  if (catalog?.version !== 2) {
    throw new Error(
      `service-catalog.yaml version ${catalog?.version}: blast-radius.js needs version 2`,
    );
  }
  return catalog;
}

/**
 * Produced items matching `name`: the item of that name, or every major of an event.
 * @param {Catalog} catalog
 * @param {string} name
 * @returns {{ repo: Entry, item: Item }[]}
 */
export function findProduced(catalog, name) {
  return catalog.repos.flatMap((repo) =>
    (repo.produces ?? [])
      .filter((item) => item.name === name || (item.kind === 'event' && item.event === name))
      .map((item) => ({ repo, item })),
  );
}

/**
 * The tree below each matching item: its consumers, then whatever each consumer produces from it
 * and that item's consumers, and so on (each item once).
 * @param {Catalog} catalog
 * @param {string} name
 * @returns {Node[]}
 */
export function blastRadius(catalog, name) {
  const seen = new Set();
  /** @type {(repo: Entry, item: Item) => Node} */
  const node = (repo, item) => {
    seen.add(item.name);
    const consumers = catalog.repos
      .map((r) => ({
        repo: r,
        via: (r.consumes ?? []).find((c) => c.kind === item.kind && c.name === item.name),
      }))
      .filter((c) => c.via && c.repo.name !== repo.name)
      .sort((a, b) => a.repo.name.localeCompare(b.repo.name))
      .map(({ repo: r, via }) => ({
        repo: r,
        via: /** @type {Item} */ (via),
        passesOn: (r.produces ?? [])
          .filter((p) => (p.from ?? []).includes(item.name) && !seen.has(p.name))
          .map((p) => node(r, p)),
      }));
    return { repo, item, consumers };
  };
  return findProduced(catalog, name).map(({ repo, item }) => node(repo, item));
}

/**
 * Who has to be involved: the consuming repos and the items they pass the change on in, the
 * owning teams, and the outside systems that read any of those items.
 * @param {Node[]} nodes
 */
export function summarise(nodes) {
  /** @type {Set<string>} */ const repos = new Set();
  /** @type {Set<string>} */ const items = new Set();
  /** @type {Set<string>} */ const teams = new Set();
  /** @type {Set<string>} */ const external = new Set();
  /** @param {Node} n @param {boolean} root */
  const walk = (n, root) => {
    if (!root) items.add(n.item.name);
    for (const t of n.item.to ?? []) external.add(t);
    for (const c of n.consumers) {
      repos.add(c.repo.name);
      teams.add(c.repo.owner_team);
      c.passesOn.forEach((p) => walk(p, false));
    }
  };
  nodes.forEach((n) => walk(n, true));
  return { radius: [...repos, ...items], teams: [...teams], external: [...external] };
}

/** @param {Item} item */
function itemNotes(item) {
  const notes = [];
  if (item.flag) notes.push(`behind ${item.flag}`);
  if (item.since) notes.push(`from ${item.since}`);
  return notes.length ? ` (${notes.join(', ')})` : '';
}

/** @param {Consumer} c */
function consumerLine(c) {
  const group = c.via.group ? `, consumer group ${c.via.group}` : '';
  const since = c.via.since ? `, since ${c.via.since}` : '';
  return `${c.repo.name} (${c.repo.owner_team}; ${c.repo.primary}, backup ${c.repo.backup})${group}${since}`;
}

/**
 * @param {Node[]} nodes
 * @param {string} name
 */
export function formatText(nodes, name) {
  const producers = [...new Set(nodes.map((n) => n.repo.name))].join(', ');
  const lines = [`${name}, produced by ${producers}:`];
  /** @param {Node} n @param {string} indent */
  const consumersOf = (n, indent) => {
    if (n.consumers.length === 0 && !(n.item.to ?? []).length) {
      lines.push(`${indent}no consumers yet`);
    }
    for (const c of n.consumers) {
      lines.push(`${indent}${consumerLine(c)}`);
      for (const p of c.passesOn) {
        const to = p.item.to?.length ? `, read by ${p.item.to.join(', ')}` : '';
        lines.push(`${indent}  passes it on in ${p.item.name} (${p.item.kind})${to}`);
        if (p.consumers.length) consumersOf(p, `${indent}    `);
      }
    }
  };
  for (const n of nodes) {
    const to = n.item.to?.length ? `, read by ${n.item.to.join(', ')}` : '';
    lines.push(`  ${n.item.name}${itemNotes(n.item)}${to}`);
    consumersOf(n, '    ');
  }
  const { radius, teams, external } = summarise(nodes);
  lines.push('');
  lines.push(`Blast radius: ${radius.join(', ') || 'nobody'}`);
  lines.push(`Teams to involve: ${teams.join(', ') || 'none'}`);
  if (external.length) lines.push(`Outside the org: ${external.join(', ')}`);
  return lines.join('\n');
}

/**
 * @param {Node} n
 * @returns {Record<string, unknown>}
 */
function toJson(n) {
  return {
    name: n.item.name,
    kind: n.item.kind,
    producer: n.repo.name,
    ...(n.item.flag ? { flag: n.item.flag } : {}),
    ...(n.item.to ? { to: n.item.to } : {}),
    consumers: n.consumers.map((c) => ({
      repo: c.repo.name,
      team: c.repo.owner_team,
      jira_component: c.repo.jira_component,
      ...(c.via.group ? { group: c.via.group } : {}),
      ...(c.via.since ? { since: c.via.since } : {}),
      passes_on: c.passesOn.map(toJson),
    })),
  };
}

/**
 * @param {string[]} argv
 * @returns {{ name?: string, catalog: string, json: boolean }}
 */
export function parseArgs(argv) {
  /** @type {{ name?: string, catalog: string, json: boolean }} */
  const out = { catalog: DEFAULT_CATALOG, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--catalog') out.catalog = argv[++i] ?? out.catalog;
    else if (a === '--json') out.json = true;
    else out.name = a;
  }
  return out;
}

/**
 * @param {string[]} argv
 * @returns {{ code: number, out: string }}
 */
export function run(argv) {
  const args = parseArgs(argv);
  if (!args.name) {
    return {
      code: 2,
      out: 'usage: blast-radius.js <name> [--catalog service-catalog.yaml] [--json]',
    };
  }
  const catalog = readCatalog(readFileSync(args.catalog, 'utf8'));
  const nodes = blastRadius(catalog, args.name);
  if (nodes.length === 0) {
    const events = [
      ...new Set(
        catalog.repos.flatMap((r) => (r.produces ?? []).filter((i) => i.event).map((i) => i.event)),
      ),
    ];
    return {
      code: 2,
      out: `nothing in the catalog produces ${args.name} (events: ${events.join(', ')})`,
    };
  }
  if (args.json) {
    const json = { name: args.name, items: nodes.map(toJson), ...summarise(nodes) };
    return { code: 0, out: JSON.stringify(json, null, 2) };
  }
  return { code: 0, out: formatText(nodes, args.name) };
}

if (isMain(import.meta.url)) {
  const { code, out } = run(process.argv.slice(2));
  (code === 0 ? console.log : console.error)(out);
  process.exitCode = code;
}
