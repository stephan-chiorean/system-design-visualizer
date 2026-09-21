#!/usr/bin/env node
/**
 * Validate design JSON against the v1 schema, without a browser.
 *
 * The designs in this app are written by agents, so the contract needs a check
 * that runs in CI or a terminal rather than only at render time.
 *
 *   node tools/validate.mjs                    # everything in designs/index.json
 *   node tools/validate.mjs path/to/design.json
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseDesign } from '../src/schema.js';
import { computeLayout } from '../src/layout.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : JSON.parse(readFileSync(join(root, 'designs/index.json'), 'utf8')).map((d) => join(root, 'designs', d.file));

let failed = 0;

for (const target of targets) {
  const path = resolve(target);
  console.log(`\n${path.replace(`${root}/`, '')}`);

  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.log(`  ✗ not valid JSON: ${error.message}`);
    failed++;
    continue;
  }

  const { design, errors, warnings } = parseDesign(raw);
  for (const error of errors) console.log(`  ✗ ${error}`);
  for (const warning of warnings) console.log(`  ! ${warning}`);

  if (!design) {
    failed++;
    continue;
  }

  // Authoring checks that are advice rather than schema violations.
  for (const flow of design.flows) {
    // steps run parallel to path: one per node, including the origin.
    if (flow.steps.length && flow.steps.length !== flow.path.length) {
      console.log(`  ! flow "${flow.label}" has ${flow.steps.length} steps for ${flow.path.length} path nodes`);
    }
    if (!flow.steps.length) {
      console.log(`  ! flow "${flow.label}" has no steps; the sidebar will fall back to node notes`);
    }
  }
  if (design.flows.length < 2) {
    console.log('  ! fewer than two flows — the flow player is the point of this renderer');
  }
  const undocumented = design.nodes.filter((n) => !n.notes).map((n) => n.id);
  if (undocumented.length) {
    console.log(`  ! nodes without notes: ${undocumented.join(', ')}`);
  }

  const layout = computeLayout(design);
  const broken = [...layout.positions.entries()].filter(([, p]) => ![p.x, p.y, p.z].every(Number.isFinite));
  if (broken.length) {
    console.log(`  ✗ non-finite layout positions: ${broken.map(([id]) => id).join(', ')}`);
    failed++;
    continue;
  }

  console.log(
    `  ✓ ${design.layers.length} layers · ${design.nodes.length} nodes · ` +
    `${design.edges.length} edges · ${design.flows.length} flows`
  );
}

console.log('');
process.exit(failed ? 1 : 0);
