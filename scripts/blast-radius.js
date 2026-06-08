#!/usr/bin/env node
// Blast radius of a change, from service-catalog.yaml (BTWL-495): who consumes an event, API,
// file, library or workflow, and what those consumers produce in turn, so the PR author knows
// which teams to involve before changing a contract.
//
//   node scripts/blast-radius.js <name> [--catalog service-catalog.yaml] [--json]
//
// <name> is anything a catalog entry produces (order.shipped.v1, btwl-billing-service,
// @btwl/pricing, finance-export, ci-node.yml) or an event name for all of its majors (OrderShipped).
// Exits 2 when nothing in the catalog has that name.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { isMain } from './lib/actions.js';

const DEFAULT_CATALOG = fileURLToPath(new URL('../service-catalog.yaml', import.meta.url));

/**
 * @typedef {{ kind: string, name: string, event?: string, version?: number, group?: string,
 *   to?: string[], flag?: string, since?: string }} Item
 * @typedef {{ name: string, owner_team: string, primary: string, backup: string,
 *   jira_component: string, produces?: Item[], consumes?: Item[] }} Entry
 * @typedef {{ version: number, repos: Entry[] }} Catalog
 * @typedef {{ repo: Entry, via: Item, depth: number, item: Item }} Hit
 *   one consumer of `item` (a consumer's `via` is its consumes line)
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
 * Everyone downstream of `name`: the consumers of each matching item, then the consumers of
 * whatever those consumers produce, once each.
 * @param {Catalog} catalog
 * @param {string} name
 */
export function blastRadius(catalog, name) {
  const roots = findProduced(catalog, name);
  /** @type {Hit[]} */
  const hits = [];
  const seenItems = new Set(roots.map((r) => r.item.name));
  const seenRepos = new Set(roots.map((r) => r.repo.name));
  /** @type {{ item: Item, depth: number }[]} */
  const queue = roots.map((r) => ({ item: r.item, depth: 0 }));
  while (queue.length > 0) {
    const { item, depth } = /** @type {{ item: Item, depth: number }} */ (queue.shift());
    for (const repo of catalog.repos) {
      const via = (repo.consumes ?? []).find((c) => c.kind === item.kind && c.name === item.name);
      if (!via || seenRepos.has(repo.name)) continue;
      seenRepos.add(repo.name);
      hits.push({ repo, via, depth, item });
      for (const next of repo.produces ?? []) {
        if (seenItems.has(next.name)) continue;
        seenItems.add(next.name);
        queue.push({ item: next, depth: depth + 1 });
      }
    }
  }
  return { roots, hits };
}

/**
 * @param {ReturnType<typeof blastRadius>} radius
 * @param {string} name
 */
export function formatText({ roots, hits }, name) {
  const producers = [...new Set(roots.map((r) => r.repo.name))].join(', ');
  const lines = [`${name}, produced by ${producers}:`];
  for (const { item } of roots) {
    const consumers = hits.filter((h) => h.item.name === item.name);
    if (consumers.length === 0) continue;
    lines.push(`  ${item.name}`);
    for (const h of consumers) lines.push(`    ${describe(h)}`);
  }
  const downstream = hits.filter((h) => h.depth > 0);
  if (downstream.length > 0) {
    lines.push('  further down:');
    for (const h of downstream) lines.push(`    ${h.item.name} -> ${describe(h)}`);
  }
  const repos = hits.map((h) => h.repo);
  lines.push('');
  lines.push(`Blast radius: ${repos.map((r) => r.name).join(', ') || 'nobody'}`);
  lines.push(
    `Teams to involve: ${[...new Set(repos.map((r) => r.owner_team))].join(', ') || 'none'}`,
  );
  return lines.join('\n');
}

/** @param {Hit} h */
function describe(h) {
  const group = h.via.group ? `, consumer group ${h.via.group}` : '';
  const since = h.via.since ? `, since ${h.via.since}` : '';
  return `${h.repo.name} (${h.repo.owner_team}; ${h.repo.primary}, backup ${h.repo.backup})${group}${since}`;
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
  const radius = blastRadius(catalog, args.name);
  if (radius.roots.length === 0) {
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
    const json = {
      name: args.name,
      producers: [...new Set(radius.roots.map((r) => r.repo.name))],
      consumers: radius.hits.map((h) => ({
        repo: h.repo.name,
        team: h.repo.owner_team,
        jira_component: h.repo.jira_component,
        of: h.item.name,
        ...(h.via.group ? { group: h.via.group } : {}),
      })),
    };
    return { code: 0, out: JSON.stringify(json, null, 2) };
  }
  return { code: 0, out: formatText(radius, args.name) };
}

if (isMain(import.meta.url)) {
  const { code, out } = run(process.argv.slice(2));
  (code === 0 ? console.log : console.error)(out);
  process.exitCode = code;
}
