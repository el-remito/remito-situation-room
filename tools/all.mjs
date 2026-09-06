#!/usr/bin/env node
/**
 * Everything that can be checked without launching Foundry. `node tools/all.mjs`
 *
 * This is the whole automated safety net: the static passes, plus one suite per
 * pure logic module. It says nothing about whether the UI works — that needs a
 * world, a reload, and a second browser logged in as a player.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const suites = [
    'check.mjs',
    ...readdirSync(HERE).filter((f) => f.startsWith('check-') && f.endsWith('.mjs')).sort()
];

let failed = 0;
for (const suite of suites) {
    const run = spawnSync(process.execPath, [join(HERE, suite)], { stdio: 'inherit' });
    if (run.status !== 0) failed++;
}

console.log(failed === 0
    ? `\n  ${suites.length} suites, all green\n`
    : `\n  ${failed} of ${suites.length} suites FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
