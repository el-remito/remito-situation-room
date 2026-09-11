#!/usr/bin/env node
/**
 * Every language file against English. `node tools/check-lang.mjs`
 *
 * tools/check.mjs reads lang/en.json and nothing else — passes 2 and 6 both name
 * that file outright — so a second language would ship with no validation at all.
 * These are the checks that stand in for the ones English gets for free by being
 * the file the code is written against.
 *
 *   1. parity      — same key set as English, neither missing nor extra
 *   2. nesting     — no key is a prefix of another (check.mjs pass 6, per file)
 *   3. placeholder — the {named} set per key matches English exactly
 *   4. markup      — the HTML tags match English, and every one of them closes
 *   5. residue     — long values still byte-identical to English
 *
 * English is canonical and is never checked against itself here.
 *
 * Why parity is load-bearing rather than tidy: scripts/i18n.mjs merges the world's
 * file over game.i18n.translations to make one language stick for the whole table.
 * A key missing from that file is not filled in from English — Foundry's own
 * fallback holds English only when the CLIENT asked for another language, so a
 * client running English in a pt-BR world has an empty _fallback and renders the
 * raw key. The merge has to be total, and this is what keeps it total.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const C = process.stdout.isTTY
    ? { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', off: '\x1b[0m' }
    : { red: '', green: '', dim: '', off: '' };

let failures = 0;

/** Caps the noise from a pass that has gone wholesale wrong — a stub file, say. */
const LIST_LIMIT = 12;

function report(title, problems) {
    if (problems.length === 0) {
        console.log(`  ${C.green}ok${C.off}    ${title}`);
        return;
    }
    failures += problems.length;
    console.log(`  ${C.red}FAIL${C.off}  ${title}`);
    for (const p of problems.slice(0, LIST_LIMIT)) console.log(`          ${p}`);
    if (problems.length > LIST_LIMIT) {
        console.log(`          ${C.dim}and ${problems.length - LIST_LIMIT} more${C.off}`);
    }
}

const load = (name) => JSON.parse(readFileSync(join(ROOT, 'lang', name), 'utf8'));

/** `{name}` as game.i18n.format reads it. Order is irrelevant, presence is not. */
const placeholders = (value) =>
    [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]).sort();

/** Tags, lowercased and sorted: `<p><strong>x</strong></p>` is `/p, /strong, p, strong`. */
const tags = (value) =>
    [...value.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g)]
        .map((m) => `${m[1]}${m[2].toLowerCase()}`)
        .sort();

/** Tags that never close. None appear in en.json today; the list is cheap insurance. */
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'wbr']);

function unbalanced(value) {
    const open = [];
    for (const m of value.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g)) {
        const [, closing, rawName, selfClosing] = m;
        const name = rawName.toLowerCase();
        if (VOID_TAGS.has(name) || selfClosing === '/') continue;
        if (!closing) { open.push(name); continue; }
        const was = open.pop();
        if (was !== name) return `</${name}> closes <${was ?? 'nothing'}>`;
    }
    return open.length ? `never closed: <${open.join('>, <')}>` : null;
}

/**
 * Below this, an identical string is almost certainly a real answer: the domain
 * nouns are deliberately kept in English ("Thread", "Cycle"), and short chrome
 * like a Font Awesome class is the same in every language. Above it, prose.
 */
const RESIDUE_MIN = 40;

const english = load('en.json');
const englishKeys = Object.keys(english);

const others = readdirSync(join(ROOT, 'lang'))
    .filter((f) => f.endsWith('.json') && f !== 'en.json')
    .sort();

console.log(`\nlanguage files vs. en.json (${englishKeys.length} keys)\n`);

if (others.length === 0) {
    console.log(`  ${C.dim}no other language files${C.off}\n`);
    process.exit(0);
}

for (const file of others) {
    const lang = file.replace(/\.json$/, '');
    const other = load(file);
    const otherKeys = Object.keys(other);
    console.log(`  ${C.dim}${lang}${C.off}`);

    // 1. the same keys, both directions
    {
        const have = new Set(otherKeys);
        const problems = [
            ...englishKeys.filter((k) => !have.has(k)).map((k) => `missing: ${k}`),
            ...otherKeys.filter((k) => !(k in english)).map((k) => `not in English: ${k}`)
        ];
        report(`${lang}: same keys as English (${otherKeys.length})`, problems);
    }

    // 2. no key is a prefix of another
    {
        const problems = [];
        const sorted = [...otherKeys].sort();
        for (let i = 0; i < sorted.length; i++) {
            for (let j = i + 1; j < sorted.length && sorted[j].startsWith(`${sorted[i]}.`); j++) {
                problems.push(`"${sorted[i]}" is a prefix of "${sorted[j]}" — one of them will not exist`);
            }
        }
        report(`${lang}: keys nest cleanly`, problems);
    }

    // 3. the same {placeholders}
    {
        /**
         * game.i18n.format substitutes by name. A translated placeholder throws
         * nothing — it renders as the literal text "{nome}" in the middle of a
         * sentence, which reads as a template bug rather than a translation one.
         */
        const problems = [];
        let checked = 0;
        for (const key of englishKeys) {
            if (!(key in other)) continue;
            const want = placeholders(english[key]);
            const got = placeholders(other[key]);
            if (want.length) checked++;
            if (want.join(',') !== got.join(',')) {
                problems.push(`${key}: English takes [${want.join(' ')}], this takes [${got.join(' ')}]`);
            }
        }
        report(`${lang}: placeholders match (${checked} keys carry one)`, problems);
    }

    // 4. the same markup, and it closes
    {
        /**
         * ~40 keys carry raw HTML, and the Help bodies are rendered unescaped —
         * {{{localize this.body}}} in templates/partials/help.hbs. A dropped </p>
         * there does not throw; it swallows the rest of the panel.
         */
        const problems = [];
        let checked = 0;
        for (const key of englishKeys) {
            if (!(key in other)) continue;
            const want = tags(english[key]);
            const got = tags(other[key]);
            if (want.length) checked++;
            if (want.join(',') !== got.join(',')) {
                problems.push(`${key}: tags differ — English has [${want.join(' ')}], this has [${got.join(' ')}]`);
                continue;
            }
            const broken = unbalanced(other[key]);
            if (broken) problems.push(`${key}: ${broken}`);
        }
        report(`${lang}: markup matches and closes (${checked} keys carry tags)`, problems);
    }

    // 5. nothing long left in English
    {
        const problems = [];
        for (const key of englishKeys) {
            if (!(key in other)) continue;
            const value = english[key];
            if (value.length >= RESIDUE_MIN && other[key] === value) {
                problems.push(`${key}: still English — "${value.slice(0, 60)}..."`);
            }
        }
        report(`${lang}: no untranslated prose (${RESIDUE_MIN}+ chars)`, problems);
    }

    console.log('');
}

console.log(
    failures === 0
        ? `  ${C.green}all languages clean${C.off}\n`
        : `  ${C.red}${failures} problem${failures === 1 ? '' : 's'}${C.off}\n`
);
process.exit(failures === 0 ? 0 : 1);
