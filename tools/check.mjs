#!/usr/bin/env node
/**
 * Static passes. `node tools/check.mjs`
 *
 * There is no linter and no test runner in this family, so these are the checks
 * that stand in for one. Every pass here catches a mistake that is invisible until
 * Foundry is running, and then fails silently rather than loudly:
 *
 *   0. parse        — every source parses (a syntax error is a blank window)
 *   1. imports      — every relative import specifier resolves to a real file
 *   2. i18n         — every RSR.* key used exists, and every key defined is used
 *   3. data-action  — every data-action in a template has a registered handler
 *   4. naming       — UI words live only in lang/en.json (Thread/node, Cycle/turn)
 *   5. funnels      — game.settings only in settings.mjs, game.socket only in relay.mjs
 *   6. i18n shape   — no key is a prefix of another (Foundry expands the flat file)
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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

// ── 0. every source parses ───────────────────────────────────────────────────
{
    /**
     * With no linter and no build step, a syntax error surfaces only when Foundry
     * loads the module — as a blank window and a console trace. `node --check`
     * parses without executing, so files full of Foundry globals still pass.
     */
    const problems = [];
    for (const file of sources) {
        const run = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
        if (run.status !== 0) {
            const detail = (run.stderr || '').split('\n').find((l) => l.includes('Error')) ?? 'parse failed';
            problems.push(`${rel(file)}: ${detail.trim()}`);
        }
    }
    report(`sources parse (${sources.length} files)`, problems);
}

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
        'RSR.plot.lifecycle.', 'RSR.asset.modifier.', 'RSR.visibility.',
        'RSR.settings.visibility.', 'RSR.editor.tone.', 'RSR.asset.condition.',
        'RSR.asset.effectScale.'];

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
        // Two words are split the same way: the code word and the UI word are
        // different, and the UI word lives in exactly one file. Prose in comments is
        // how the rule gets explained, so only quoted strings count.
        //
        //   node  -> "Thread"      turn -> "Cycle"
        //
        // Both directions are checked. A UI word appearing in code means a string was
        // built where it should have been localized; a code word reaching a user means
        // the split was forgotten in the other direction.
        const UI_WORDS = [
            { word: 'Thread', pattern: /['"]([^'"\n]*\bThreads?\b[^'"\n]*)['"]/g },
            { word: 'Cycle', pattern: /['"]([^'"\n]*\bCycles?\b[^'"\n]*)['"]/g }
        ];
        const CODE_WORDS = [
            { word: 'Node', ui: 'Thread', pattern: /['"]([^'"\n]*\bNodes?\b[^'"\n]*)['"]/g },
            { word: 'Turn', ui: 'Cycle', pattern: /['"]([^'"\n]*\bTurns?\b[^'"\n]*)['"]/g }
        ];

        for (const { word, pattern } of UI_WORDS) {
            for (const m of body.matchAll(pattern)) {
                if (m[1].startsWith('RSR.')) continue;            // an i18n key, not prose
                problems.push(`${rel(file)}: literal "${word}" in a string — belongs in lang/en.json`);
            }
        }
        for (const { word, ui, pattern } of CODE_WORDS) {
            for (const m of body.matchAll(pattern)) {
                if (/^[A-Za-z0-9_.]+$/.test(m[1])) continue;      // an identifier or key
                problems.push(`${rel(file)}: user-visible "${word}" in a string — should read ${ui}`);
            }
        }
    }
    report('naming rule: UI words only in lang, code words never user-visible', problems);
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

// ── 6. no i18n key may be a prefix of another ────────────────────────────────
{
    /**
     * Foundry runs expandObject() over the flat language file, turning "a.b.c" into
     * nested objects. So a file holding BOTH "RSR.asset.modifier" and
     * "RSR.asset.modifier.costReduction" cannot represent both: one is a string,
     * the other needs that same slot to be an object. Whichever loses is simply
     * absent at runtime, and localize() then renders the raw key — which looks like
     * a typo in a template rather than a collision in the file.
     *
     * Verified against helpers/localization.mjs:368 (expandObject on load) and :436
     * (getProperty on read).
     */
    const keys = Object.keys(JSON.parse(read(join(ROOT, 'lang', 'en.json'))));
    const problems = [];
    const sorted = [...keys].sort();
    for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length && sorted[j].startsWith(`${sorted[i]}.`); j++) {
            problems.push(`"${sorted[i]}" is a prefix of "${sorted[j]}" — one of them will not exist`);
        }
    }
    report(`i18n keys nest cleanly (${keys.length} keys)`, problems);
}

// ── summary ──────────────────────────────────────────────────────────────────
console.log(
    failures === 0
        ? `\n  ${C.green}all passes clean${C.off}\n`
        : `\n  ${C.red}${failures} problem${failures === 1 ? '' : 's'}${C.off}\n`
);
process.exit(failures === 0 ? 0 : 1);
