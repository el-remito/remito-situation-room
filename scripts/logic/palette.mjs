/**
 * What a row's colour may be, and what it is turned into before anything stores
 * or prints it.
 *
 * Pure. No Foundry globals, no DOM. `node`-importable, and exercised by
 * tools/check-palette.mjs.
 *
 * A colour is one of three things:
 *
 *   ''          the default for the kind, which is a CSS class and not a colour
 *   a palette id   one of TAG_COLORS — resolved in the stylesheet, so it has a
 *                  light half and a dark half and reads on both grounds
 *   '#rrggbb'      the GM's own, canonicalised
 *
 * THE PALETTE IS NOT A LIMITATION THAT WENT AWAY. The nine ids are still the
 * right answer for almost every row, because each is a `light-dark()` PAIR: the
 * stylesheet has one value for a page that is white and another for a page that
 * is nearly black. A single hex cannot do that — it is one colour, printed as
 * typed on both themes — so a custom colour is the GM taking that responsibility.
 * The hint beside the field says so, and this file does not try to be clever
 * about it: no auto-lightening, no contrast correction. A GM who picks navy and
 * then reads the board on the dark theme should see navy, notice, and change it,
 * rather than watch the module quietly print something else.
 *
 * WHY EVERYTHING IS RE-EMITTED RATHER THAN VALIDATED. Before this file, the
 * whitelist WAS the escaping: a value that had to be one of nine known strings
 * could be dropped into a class attribute with nothing further asked of it. A
 * custom colour ends up in a `style` attribute instead, which is a far worse
 * place to put a string a user typed. So nothing typed is ever passed through.
 * The input is parsed into three integers and a new string is built from them —
 * `rgb(1,2,3)`, `#ABC` and `#aabbcc` all leave here as `#aabbcc`, and anything
 * that does not parse leaves as ''. There is no path by which a character the GM
 * typed reaches the attribute.
 */

import { TAG_COLORS } from '../constants.mjs';

/**
 * The radio value standing for "the one I typed". Not a colour and never stored:
 * the form carries it, `patchFrom` swaps it for the text beside it. It cannot
 * collide with a palette id — a TAG_COLORS entry named 'custom' would be caught
 * by check-palette.mjs.
 */
export const CUSTOM = 'custom';

/** One of the nine, which the stylesheet resolves per theme. */
export const isPaletteColor = (v) => TAG_COLORS.includes(v);

const clamp = (n) => Math.min(255, Math.max(0, n));
const hex2 = (n) => clamp(n).toString(16).padStart(2, '0');

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
// Alpha is accepted at the door and then dropped — see below.
const RGB = /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+\s*)?\)$/i;

/**
 * A GM's own colour, canonicalised to `#rrggbb`, or '' if it is not one.
 *
 * Both notations the GM might reach for are accepted — `#8a9099`, `#89a`,
 * `rgb(138, 144, 153)`, and the space-separated `rgb(138 144 153)` a browser's
 * own picker will hand back if it is pasted from devtools.
 *
 * ALPHA IS PARSED AND THROWN AWAY. A translucent name is legible on one of the
 * two theme grounds and muddy on the other, and worse, it changes meaning: half
 * the board's palette is built out of opacity already (a masked row, a sealed
 * line, a quiet chip), so a name at 40% would read as withheld rather than blue.
 * Accepting the notation and dropping the channel is friendlier than rejecting
 * a value that looks perfectly reasonable.
 */
export function parseCustomColor(value) {
    const v = String(value ?? '').trim();
    if (!v) return '';

    const hex = HEX.exec(v);
    if (hex) {
        const body = hex[1].toLowerCase();
        return body.length === 3
            ? `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`
            : `#${body}`;
    }

    const rgb = RGB.exec(v);
    if (rgb) {
        const [r, g, b] = rgb.slice(1, 4).map((n) => Number(n));
        if (![r, g, b].every(Number.isFinite)) return '';
        return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
    }

    return '';
}

/**
 * The one funnel every stored colour goes through: normalize calls it, and so
 * does anything that has a colour and does not know where it came from.
 */
export function normalizeColor(value) {
    const v = String(value ?? '').trim();
    if (!v) return '';
    if (isPaletteColor(v)) return v;
    return parseCustomColor(v);
}

/**
 * How to print a name in this colour: a class when the stylesheet owns it, an
 * inline custom property when the GM does.
 *
 * Returns both halves rather than a string of markup, because the two callers
 * that need it build their markup very differently — one is a Handlebars
 * context, the other is a sentence assembled in JS.
 *
 * `style` is safe to interpolate unquoted-adjacent because `colour` here has
 * already been through normalizeColor: it is '#' and six hex digits or nothing.
 */
export function tagStyle(color, kind) {
    if (isPaletteColor(color)) return { cls: `rsr-tag-${color}`, style: '' };
    const custom = parseCustomColor(color);
    if (custom) return { cls: 'rsr-tag-custom', style: `--rsr-tag-ink: ${custom}` };
    return { cls: `rsr-tag-kind-${kind}`, style: '' };
}
