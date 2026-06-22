#!/usr/bin/env node
// Checks service-catalog.yaml against service-catalog.schema.json (BTWL-497). Every problem is an
// error annotation on the catalog line it is about, starting with the repo's name, and the check
// fails. make ci runs it, so every PR in this repo is checked by ci-node.yml.
//
//   node scripts/catalog-check.js [service-catalog.yaml] [--schema service-catalog.schema.json]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { LineCounter, isMap, isSeq, parseDocument } from 'yaml';

import { errorCommand, isMain } from './lib/actions.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * @typedef {{ repo: string, path: string, line?: number, message: string }} Problem
 */

/**
 * Line (1-based) of the node at `path` (JSON pointer segments) in the YAML document.
 * @param {import('yaml').Document} doc
 * @param {LineCounter} lines
 * @param {string[]} path
 */
function lineOf(doc, lines, path) {
  /** @type {unknown} */
  let node = doc.contents;
  let line;
  for (const key of path) {
    if (isMap(node)) {
      const pair = node.items.find((p) => /** @type {any} */ (p.key)?.value === key);
      if (!pair) break;
      node = pair.value;
      const at = /** @type {any} */ (pair.key)?.range?.[0];
      if (at !== undefined) line = lines.linePos(at).line;
    } else if (isSeq(node)) {
      node = node.items[Number(key)];
      const at = /** @type {any} */ (node)?.range?.[0];
      if (at !== undefined) line = lines.linePos(at).line;
    } else {
      break;
    }
  }
  return line;
}

/**
 * Problems in the catalog text, each with the repo it is about.
 * @param {string} text the catalog (YAML)
 * @param {object} schema
 * @returns {Problem[]}
 */
export function check(text, schema) {
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines });
  if (doc.errors.length > 0) {
    return doc.errors.map((e) => ({
      repo: 'service-catalog.yaml',
      path: '',
      line: e.linePos?.[0]?.line,
      message: e.message,
    }));
  }
  const data = /** @type {{ repos?: { name?: string }[] }} */ (doc.toJS());
  const ajv = new Ajv2020({ allErrors: true });
  const validate = ajv.compile(schema);
  const valid = validate(structuredClone(data));
  if (valid) return [];
  /** @type {Problem[]} */
  const problems = [];
  for (const e of validate.errors ?? []) {
    // "if" errors repeat what its "then" already said.
    if (e.keyword === 'if') continue;
    const path = e.instancePath.split('/').slice(1);
    const index = path[0] === 'repos' && path[1] !== undefined ? Number(path[1]) : undefined;
    const repo =
      index === undefined
        ? 'service-catalog.yaml'
        : (data.repos?.[index]?.name ?? `repos[${index}] (no name)`);
    const where = (index === undefined ? path : path.slice(2)).join('.');
    const detail =
      e.keyword === 'required'
        ? `missing ${e.params.missingProperty}`
        : e.keyword === 'additionalProperties'
          ? `unknown field ${e.params.additionalProperty}`
          : e.keyword === 'enum'
            ? `${e.message}: ${e.params.allowedValues.join(', ')}`
            : e.message;
    problems.push({
      repo,
      path: e.instancePath,
      line: lineOf(doc, lines, path),
      message: `${repo}: ${where ? `${where} ` : ''}${detail}`,
    });
  }
  return problems;
}

/**
 * @param {string[]} argv
 * @returns {{ code: number, out: string[] }}
 */
export function run(argv) {
  let catalog = `${ROOT}service-catalog.yaml`;
  let schemaPath = `${ROOT}service-catalog.schema.json`;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--schema') schemaPath = argv[++i] ?? schemaPath;
    else catalog = /** @type {string} */ (argv[i]);
  }
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const problems = check(readFileSync(catalog, 'utf8'), schema);
  if (problems.length === 0) {
    return { code: 0, out: ['service-catalog.yaml: matches service-catalog.schema.json'] };
  }
  return {
    code: 1,
    out: problems.map((p) =>
      errorCommand(p.message, { file: 'service-catalog.yaml', line: p.line, title: 'catalog' }),
    ),
  };
}

if (isMain(import.meta.url)) {
  const { code, out } = run(process.argv.slice(2));
  for (const line of out) console.log(line);
  process.exitCode = code;
}
