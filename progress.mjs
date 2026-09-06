#!/usr/bin/env node
/**
 * Renders PROGRESS.md as a milestone dashboard.
 *   node progress.mjs          all milestones
 *   node progress.mjs M3       just one
 *   node progress.mjs --todo   only what is not done yet
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const C = process.stdout.isTTY
  ? { dim: '\x1b[2m', gold: '\x1b[33m', green: '\x1b[32m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { dim: '', gold: '', green: '', bold: '', off: '' };

const args = process.argv.slice(2);
const only = args.find(a => !a.startsWith('--'))?.toUpperCase();
const todoOnly = args.includes('--todo');

// Parse "## M1 — Title" headings and their "- [ ] item" children.
const milestones = [];
for (const line of readFileSync(join(HERE, 'PROGRESS.md'), 'utf8').split(/\r?\n/)) {
  const head = line.match(/^##\s+(.+)$/);
  if (head) { milestones.push({ title: head[1].trim(), items: [] }); continue; }
  const item = line.match(/^- \[([ xX])\]\s+(.+)$/);
  if (item && milestones.length) {
    milestones.at(-1).items.push({ done: item[1] !== ' ', text: item[2].trim() });
  }
}

const bar = (done, total, width = 24) => {
  const filled = total ? Math.round((done / total) * width) : 0;
  return `${C.gold}${'\u2593'.repeat(filled)}${C.dim}${'\u2591'.repeat(width - filled)}${C.off}`;
};

let allDone = 0, allTotal = 0;
const shown = milestones.filter(m => !only || m.title.toUpperCase().startsWith(only));

console.log(`\n  ${C.bold}Remito Situation Room${C.off}\n`);
for (const m of milestones) {
  const done = m.items.filter(i => i.done).length;
  allDone += done; allTotal += m.items.length;
  if (!shown.includes(m)) continue;

  const complete = done === m.items.length && m.items.length > 0;
  const tick = complete ? `${C.green}\u2713${C.off}` : ' ';
  console.log(`  ${tick} ${bar(done, m.items.length)}  ${done}/${m.items.length}  ${m.title}`);

  // Detail only when a single milestone was asked for, or it is the one in flight.
  const inFlight = done > 0 && !complete;
  if (only || (inFlight && !todoOnly) || (todoOnly && !complete)) {
    for (const i of m.items) {
      if (todoOnly && i.done) continue;
      const mark = i.done ? `${C.green}\u2713${C.off}` : `${C.dim}\u25e6${C.off}`;
      const text = i.done ? `${C.dim}${i.text}${C.off}` : i.text;
      console.log(`      ${mark} ${text}`);
    }
    console.log('');
  }
}
console.log(`\n  ${bar(allDone, allTotal, 40)}  ${C.bold}${allDone}/${allTotal}${C.off} overall\n`);
