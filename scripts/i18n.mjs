/**
 * THE ONLY place `game.i18n.translations` is written.
 *
 * Foundry chooses a language per CLIENT, from core.language. That is the right
 * default for a personal preference and the wrong one for a shared board: a
 * table of five could read the same Plot in five languages, and the GM would
 * have no way to settle it. So the world holds the answer (SETTINGS.LANGUAGE)
 * and this file makes every client obey it.
 *
 * The mechanism is a merge, not a language switch. Verified against the
 * installed client, client/helpers/localization.mjs:226-237 — setLanguage()
 * loads only the client's own language into `translations`, and puts English in
 * a SEPARATE `_fallback`. `translations` is therefore never a blend of the two,
 * and merging our chosen file over it wins outright in all four combinations of
 * client language and world language. localize() reads that object first
 * (:435-445), and format() and the {{localize}} helper both go through
 * localize(), so one merge covers every surface.
 *
 * WHEN it happens is as load-bearing as what it does, and is why this file has
 * two halves. client/game.mjs fires the `init` hook at :652 and only THEN, at
 * :663, awaits i18n.initialize() — which ends in setLanguage() assigning a
 * brand new object to `translations` (localization.mjs:234). Anything merged
 * during `init` goes into the object that assignment throws away, and loses
 * every time: our one small local file always resolves before Foundry has
 * finished fetching core, the system and every other module's language.
 *
 * So the fetch starts at `init`, where it is free, and the merge waits for
 * `i18nInit` (localization.mjs:104) — the first hook that runs after the new
 * object exists. By then the bytes have long since landed.
 *
 * Unconditional by design. Skipping the work when the client already asked for
 * the world's language would save one small request and cost a branch that is
 * wrong the moment a third language ships.
 */

import { MODULE_ID, LANGUAGES } from './constants.mjs';
import { getLanguage } from './settings.mjs';

/** The in-flight fetch, started at `init`. */
let fetching = null;

/** The merge, started at `i18nInit`. What languageReady() waits on. */
let applied = null;

/**
 * Start downloading the world's language file.
 *
 * Called from `init`, after registerSettings() — the setting has to exist before
 * it can be read. Nothing is written here; see the header.
 */
export function startLanguageLoad() {
    const file = LANGUAGES[getLanguage()] ?? LANGUAGES.en;
    fetching = foundry.utils.fetchJsonWithTimeout(`modules/${MODULE_ID}/${file}`);
    // applyWorldLanguage() is what reports a failure. Park a handler now so a
    // rejection between the two never surfaces as an unhandled one.
    fetching.catch(() => {});
    return fetching;
}

/**
 * Merge the downloaded file over Foundry's freshly built table.
 *
 * Called from `i18nInit`. Falls back to starting its own fetch, so the file is
 * still correct if the two are ever called out of order.
 */
export function applyWorldLanguage() {
    applied = (async () => {
        const json = await (fetching ?? startLanguageLoad());
        // The file is flat dotted keys; Foundry stores translations expanded.
        foundry.utils.mergeObject(
            game.i18n.translations,
            foundry.utils.expandObject(json),
            { inplace: true }
        );
    })().catch((err) => {
        // A failed load leaves whatever Foundry already had, which is English.
        // Worth a console line, not worth stopping the module for.
        console.error(`${MODULE_ID} | Could not load the world language.`, err);
    });
    return applied;
}

/** Resolves once the merge has landed. Safe to call before either of the above. */
export const languageReady = () => applied ?? Promise.resolve();
