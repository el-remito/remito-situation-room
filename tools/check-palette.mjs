#!/usr/bin/env node
/**
 * logic/palette.mjs — what a colour may be. `node tools/check-palette.mjs`
 *
 * This suite carries more weight than its size suggests. Until a GM could type
 * their own colour, the whitelist WAS the escaping: a value that had to be one
 * of nine known strings could be dropped into a class attribute and forgotten
 * about. A custom colour lands in a `style` attribute instead, so the guarantee
 * has to be made a different way — nothing typed is ever passed through, the
 * input is parsed into three integers and a fresh string is built from them.
 *
 * Which means the interesting cases here are not "does #abc work". They are the
 * ones where something that is nearly a colour, or a colour with something after
 * it, has to come out as the empty string.
 */

import {
    CUSTOM, isPaletteColor, parseCustomColor, normalizeColor, tagStyle
} from '../scripts/logic/palette.mjs';
import { TAG_COLORS } from '../scripts/constants.mjs';

let fail = 0;
const eq = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

console.log('\npalette.mjs\n');

// ── the nine ─────────────────────────────────────────────────────────────────
eq('every palette id is one', TAG_COLORS.every(isPaletteColor), true);
eq('and the sentinel is not one of them', TAG_COLORS.includes(CUSTOM), false);
eq('nor is the empty string', isPaletteColor(''), false);
eq('an id passes through normalize unchanged', normalizeColor('moss'), 'moss');

// ── hex ──────────────────────────────────────────────────────────────────────
eq('six digits are kept', parseCustomColor('#8a9099'), '#8a9099');
eq('and lowercased', parseCustomColor('#8A9099'), '#8a9099');
eq('three digits are expanded', parseCustomColor('#89a'), '#8899aa');
eq('surrounding space is not a problem', parseCustomColor('  #89a  '), '#8899aa');
eq('a missing hash is not a colour', parseCustomColor('8a9099'), '');
eq('nor are four digits', parseCustomColor('#8a90'), '');
eq('nor eight, alpha or not', parseCustomColor('#8a9099ff'), '');
eq('nor a digit that is not one', parseCustomColor('#8a90zz'), '');

// ── rgb ──────────────────────────────────────────────────────────────────────
eq('rgb() becomes hex', parseCustomColor('rgb(138, 144, 153)'), '#8a9099');
eq('spaces instead of commas work too', parseCustomColor('rgb(138 144 153)'), '#8a9099');
eq('rgba drops the alpha', parseCustomColor('rgba(138, 144, 153, 0.5)'), '#8a9099');
eq('and the slash form drops it as well', parseCustomColor('rgb(138 144 153 / 0.5)'), '#8a9099');
eq('a channel over 255 is clamped rather than refused',
    parseCustomColor('rgb(999, 0, 0)'), '#ff0000');
eq('black survives, which a truthiness bug would eat',
    parseCustomColor('rgb(0,0,0)'), '#000000');
eq('two channels is not a colour', parseCustomColor('rgb(1, 2)'), '');
eq('nor are percentages, which would silently mean something else',
    parseCustomColor('rgb(50%, 50%, 50%)'), '');

// ── the whole point: nothing typed reaches an attribute ──────────────────────
// Each of these is a real thing to try in a style attribute, and each has a
// prefix that parses. The test is that the WHOLE string has to parse or nothing
// comes out — a parser that read as far as it could would hand back "#8a9099"
// from the first of these and the attacker would learn nothing, but the fourth
// is where a lenient parser starts writing markup for someone else.
eq('trailing CSS is refused, not trimmed',
    parseCustomColor('#8a9099; background: url(x)'), '');
eq('so is a closing quote', parseCustomColor('#8a9099" onload="x'), '');
eq('so is an expression', parseCustomColor('expression(alert(1))'), '');
eq('so is a url', parseCustomColor('url(javascript:alert(1))'), '');
eq('so is a var() that would read someone else’s property',
    parseCustomColor('var(--rsr-gold)'), '');
eq('a named CSS colour is refused too — one notation in, one out',
    parseCustomColor('rebeccapurple'), '');
eq('and normalize agrees with all of that',
    ['#8a9099; x', 'url(x)', '<script>'].map(normalizeColor), ['', '', '']);

// ── how it is printed ────────────────────────────────────────────────────────
eq('a palette id is a class and no style',
    tagStyle('moss', 'force'), { cls: 'rsr-tag-moss', style: '' });
eq('a custom colour is a class and an inline ink',
    tagStyle('#8a9099', 'force'),
    { cls: 'rsr-tag-custom', style: '--rsr-tag-ink: #8a9099' });
eq('an unparseable colour falls back to the kind, not to nothing',
    tagStyle('url(x)', 'asset'), { cls: 'rsr-tag-kind-asset', style: '' });
eq('and so does the empty string, which is the ordinary case',
    tagStyle('', 'node'), { cls: 'rsr-tag-kind-node', style: '' });

// The style string is built here and interpolated into an attribute by the
// caller. If it could ever contain a quote, that caller would be writing markup
// for whoever typed it.
const risky = ['"', "'", '<', '>', ';', '\\'];
eq('no built style can carry a character that would end the attribute',
    ['#8a9099', '#89a', 'rgb(1 2 3)', 'moss', 'url(x)', '']
        .map((v) => tagStyle(v, 'plot').style)
        .every((style) => !risky.some((c) => style.includes(c))),
    true);

console.log(fail === 0 ? '\n  all passed\n' : `\n  ${fail} FAILED\n`);
process.exit(fail === 0 ? 0 : 1);
