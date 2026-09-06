#!/usr/bin/env node
/**
 * Static passes. `node tools/check.mjs`
 *
 * There is no linter and no test runner in this family, so these are the checks
 * that stand in for one. All four catch mistakes that are invisible until Foundry
 * is running and then fail silently rather than loudly:
 *
 *   1. imports      — every relative import specifier resolves to a real file
 *   2. i18n         — every RSR.* key used exists, and every key defined is used
 *   3. data-action  — every data-action in a template has a registered handler
 *   4. naming       — "Thread" appears only in lang/en.json; no user-visible "Node"
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const C = process.stdout.isTTY
    ? { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' }
    : { red: '', green: '', dim: '', bold: '', off: '' };

let failures = 0;
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');

function walk(dir, test, out = []) {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, test, out);
        else if (test(name)) out.push(full);
    }
    return out;
}

function report(title, problems) {
    if (problems.length === 0) {
        console.log(`  ${C.green}ok${C.off}    ${title}`);
        return;
    }
    failures += problems.length;
    console.log(`  ${C.red}FAIL${C.off}  ${title}`);
    for (const p of problems) console.log(`          ${p}`);
}

const sources = [
    ...walk(join(ROOT, 'scripts'), (n) => n.endsWith('.mjs')),
    join(ROOT, 'situation-room.mjs')
].filter(existsSync);
const templates = walk(join(ROOT, 'templates'), (n) => n.endsWith('.hbs'));
const read = (f) => readFileSync(f, 'utf8');

console.log(`\n  ${C.bold}remito-situation-room${C.off} ${C.dim}static passes${C.off}\n`);

// ── 1. import specifiers resolve ─────────────────────────────────────────────
{
    const problems = [];
    for (const file of sources) {
        const body = read(file);
        for (const m of body.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
            const target = resolve(dirname(file), m[1]);
            if (!existsSync(target)) problems.push(`${rel(file)} -> ${m[1]}`);
        }
    }
    report(`import specifiers resolve (${sources.length} files)`, problems);
}

// ── 2. i18n keys ─────────────────────────────────────────────────────────────
{
    const langPath = join(ROOT, 'lang', 'en.json');
    const defined = new Set(Object.keys(JSON.parse(read(langPath))));
    const used = new Set();

    // Keys reached through a variant suffix (RSR.help.x.body.gm) or an enum value
    // are assembled at render time, so a prefix here spares a false positive.
    const DYNAMIC_PREFIXES = ['RSR.help.', 'RSR.thread.mode.', 'RSR.thread.status.',
        'RSR.plot.lifecycle.', 'RSR.asset.modifier.', 'RSR.visibility.'];

    for (const file of [...sources, ...templates]) {
        for (const m of read(file).matchAll(/['"](RSR\.[A-Za-z0-9_.]+)['"]/g)) used.add(m[1]);
    }

    // A namespace passed as a prefix — enumOptions(LIFECYCLE, 'RSR.plot.lifecycle')
    // builds 'RSR.plot.lifecycle.active' at render time. Legitimate as long as it
    // actually prefixes real keys; a typo'd prefix still fails.
    const isLivePrefix = (k) => [...defined].some((d) => d.startsWith(`${k}.`));

    const missing = [...used].filter((k) => !defined.has(k) && !isLivePrefix(k)).sort();
    const unused = [...defined]
        .filter((k) => !used.has(k) && !DYNAMIC_PREFIXES.some((p) => k.startsWith(p)))
        .sort();

    report(`i18n keys used are defined (${used.size} used)`,
        missing.map((k) => `missing from lang/en.json: ${k}`));
    report(`i18n keys defined are used (${defined.size} defined)`,
        unused.map((k) => `defined but never used: ${k}`));
}

// ── 3. data-action handlers ──────────────────────────────────────────────────
{
    const registered = new Set();
    for (const file of sources) {
        // The `actions: { ... }` block of a DEFAULT_OPTIONS declaration.
        for (const block of read(file).matchAll(/actions:\s*\{([\s\S]*?)\n\s*\}/g)) {
            for (const m of block[1].matchAll(/^\s*([A-Za-z0-9_]+)\s*:/gm)) registered.add(m[1]);
        }
    }
    const problems = [];
    for (const file of templates) {
        for (const m of read(file).matchAll(/data-action=["']([A-Za-z0-9_]+)["']/g)) {
            if (!registered.has(m[1])) problems.push(`${rel(file)}: data-action="${m[1]}" has no handler`);
        }
    }
    report(`data-action handlers registered (${registered.size} actions)`, problems);
}

// ── 4. the naming rule ───────────────────────────────────────────────────────
{
    /**
     * Comments are where the rule gets explained, so they must not trip it. Strip
     * block comments, Handlebars comments and line comments before scanning —
     * leaving the `//` of a URL alone, which needs the preceding `:` guard.
     */
    const stripComments = (src) => src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\{\{!--[\s\S]*?--\}\}/g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

    const problems = [];
    for (const file of [...sources, ...templates]) {
        const body = stripComments(read(file));
        // "Thread" as a user-facing word must live only in lang/en.json. Prose in
        // comments is how the rule gets explained, so only quoted strings count.
        for (const m of body.matchAll(/['"]([^'"\n]*\bThreads?\b[^'"\n]*)['"]/g)) {
            if (!m[1].startsWith('RSR.')) problems.push(`${rel(file)}: literal "Thread" in a string — belongs in lang/en.json`);
        }
        // The inverse: "Node" must never reach a user. Identifiers are fine.
        for (const m of body.matchAll(/['"]([^'"\n]*\bNodes?\b[^'"\n]*)['"]/g)) {
            if (/^[A-Za-z0-9_.]+$/.test(m[1])) continue;          // an identifier or key
            problems.push(`${rel(file)}: user-visible "Node" in a string — should read Thread`);
        }
    }
    report('naming rule: Thread only in lang, Node never user-visible', problems);
}

// ── 5. the single-funnel invariants ──────────────────────────────────────────
{
    /**
     * These are the two rules the architecture rests on. Both are the kind that
     * decay quietly: one convenient `game.settings.get` in a UI file is invisible
     * until a player triggers it and the relay never sees the write.
     */
    const funnels = [
        { pattern: /\bgame\.settings\./, owner: 'scripts/settings.mjs',
          rule: 'game.settings is touched only in settings.mjs' },
        { pattern: /\bgame\.socket\./, owner: 'scripts/data/relay.mjs',
          rule: 'game.socket is touched only in relay.mjs' }
    ];

    const problems = [];
    for (const { pattern, owner, rule } of funnels) {
        for (const file of sources) {
            if (rel(file) === owner) continue;
            // Comments explain the rules, so they must not trip them.
            const body = read(file)
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/(^|[^:])\/\/.*$/gm, '$1');
            if (pattern.test(body)) problems.push(`${rel(file)}: ${rule}`);
        }
    }
    report('single-funnel invariants (settings, socket)', problems);
}

// ── summary ──────────────────────────────────────────────────────────────────
console.log(
    failures === 0
        ? `\n  ${C.green}all passes clean${C.off}\n`
        : `\n  ${C.red}${failures} problem${failures === 1 ? '' : 's'}${C.off}\n`
);
process.exit(failures === 0 ? 0 : 1);
