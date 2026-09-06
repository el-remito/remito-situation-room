/**
 * The Journal tab entry point.
 *
 * Verified against the live v14 install rather than assumed: JournalDirectory
 * (client/applications/sidebar/tabs/journal-directory.mjs) renders the shared
 * templates/sidebar/directory/header.hbs, whose
 *   <div class="header-actions action-buttons flexrow">
 * wraps .create-entry and .create-folder. We insert ahead of both.
 *
 * That div renders even when canCreateEntry is false, so a player without journal
 * creation rights still gets an empty container to inject into — which is what
 * makes this button reachable for players as well as the GM.
 *
 * Worth knowing: battle-decks asked for a Journal-tab button and had to settle for
 * the Actors tab, because it targeted Daggerheart's ItemBrowser.injectSidebarButton,
 * which only serves actors/items/compendium. This targets core markup instead.
 */

import { PREFIX } from '../constants.mjs';

const BUTTON_CLASS = `${PREFIX}-open-board`;
const ROW_CLASS = `${PREFIX}-open-row`;

/** v14 render hooks hand over an HTMLElement, but older shapes still pass jQuery. */
const asElement = (html) => (html instanceof HTMLElement ? html : html?.[0] ?? null);

function injectButton(app, html) {
    const root = asElement(html);
    if (!root) return;

    const actions = root.querySelector('.header-actions.action-buttons')
        ?? root.querySelector('.header-actions');
    if (!actions) return;

    // Re-injected on every render of the directory, so clear our own node first.
    root.querySelector(`.${ROW_CLASS}`)?.remove();

    const button = document.createElement('button');
    button.type = 'button';
    button.classList.add(BUTTON_CLASS);
    button.innerHTML = '<i class="fa-solid fa-tower-observation" inert></i>';
    button.append(
        Object.assign(document.createElement('span'), {
            textContent: game.i18n.localize('RSR.board.open')
        })
    );
    button.addEventListener('click', async () => {
        // Lazy: the board and its templates cost nothing until someone opens it.
        const { openBoard } = await import('../apps/situation-room.mjs');
        openBoard();
    });

    // Its own row, above Create Entry and Create Folder rather than beside them.
    // .directory-header is flexcol, so a sibling div before .header-actions becomes
    // a full row of its own — putting the button inside .header-actions (flexrow)
    // would only ever make it a third column.
    const row = document.createElement('div');
    row.classList.add('header-actions', 'action-buttons', 'flexrow', ROW_CLASS);
    row.append(button);
    actions.before(row);
}

export function registerSidebarButton() {
    Hooks.on('renderJournalDirectory', injectButton);
}
