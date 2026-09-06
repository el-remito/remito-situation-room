/**
 * GM-executes-on-behalf socket relay.
 *
 * Foundry players cannot write world settings. Every remito-* sibling sidesteps
 * this by only ever having the GM write shared data, which works right up until
 * a player needs to spend a Force's Resources. This module is that missing piece,
 * and it ships in v1 with the gate closed.
 *
 * The reason it is here now rather than later: retrofitting a relay means touching
 * every mutation site. Because data/state.mjs is the only writer, routing through
 * this costs one branch in one file — but only if the funnel exists from the start.
 *
 * Imports nothing from state.mjs. state.mjs registers its operations into the
 * table below at load time, which is what keeps the two from forming a cycle.
 */

import { SOCKET } from '../constants.mjs';

const REQUEST_TIMEOUT_MS = 10_000;

/** op name -> async (payload) => void. Populated by data/state.mjs via registerOperations. */
const OPERATIONS = new Map();

/** requestId -> { resolve, reject, timer } for requests this client is awaiting. */
const pending = new Map();

/**
 * Called once by state.mjs. Keeping the table here rather than importing state.mjs
 * is what lets state.mjs import this module.
 */
export function registerOperations(ops) {
    for (const [name, fn] of Object.entries(ops)) OPERATIONS.set(name, fn);
}

/**
 * Exactly one GM must apply a relayed write, or a two-GM table doubles every edit.
 * game.users.activeGM is Foundry's own designated-GM election — same primary on
 * every client — so this is consistent without any coordination of our own.
 */
function isDesignatedGM() {
    const activeGM = game.users?.activeGM;
    if (activeGM) return activeGM.isSelf;
    return game.user?.isGM === true; // pre-election fallback; still GM-gated
}

export function gmIsAvailable() {
    return !!game.users?.activeGM;
}

/**
 * Perform a write. GMs apply it directly; players hand it to the designated GM
 * and await the acknowledgement.
 *
 * @param {string} op       an operation name registered by state.mjs
 * @param {object} payload  plain, serializable arguments
 * @returns {Promise<void>} resolves once the write has actually landed
 */
export async function requestWrite(op, payload = {}) {
    if (!OPERATIONS.has(op)) throw new Error(`${SOCKET} | unknown operation "${op}"`);

    if (game.user?.isGM) return OPERATIONS.get(op)(payload);

    if (!gmIsAvailable()) {
        ui.notifications?.warn(game.i18n.localize('RSR.notify.noGmForWrite'));
        throw new Error(`${SOCKET} | no active GM to apply "${op}"`);
    }

    const requestId = foundry.utils.randomID();
    const promise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(requestId);
            ui.notifications?.warn(game.i18n.localize('RSR.notify.relayTimeout'));
            reject(new Error(`${SOCKET} | relay timed out on "${op}"`));
        }, REQUEST_TIMEOUT_MS);
        pending.set(requestId, { resolve, reject, timer });
    });

    game.socket.emit(SOCKET, { action: 'write', op, payload, requestId, userId: game.user.id });
    return promise;
}

/** Registered once on ready, from the entry point. */
export function registerRelay() {
    game.socket.on(SOCKET, onMessage);
}

async function onMessage(message) {
    if (!message || typeof message !== 'object') return;

    if (message.action === 'write') {
        if (!isDesignatedGM()) return;              // one applier, always
        const handler = OPERATIONS.get(message.op);
        const ack = { action: 'ack', requestId: message.requestId, userId: message.userId };
        if (!handler) {
            game.socket.emit(SOCKET, { ...ack, ok: false, error: `unknown operation "${message.op}"` });
            return;
        }
        try {
            await handler(message.payload ?? {});
            game.socket.emit(SOCKET, { ...ack, ok: true });
        } catch (err) {
            console.error(`${SOCKET} | relayed "${message.op}" failed`, err);
            game.socket.emit(SOCKET, { ...ack, ok: false, error: err.message });
        }
        return;
    }

    if (message.action === 'ack') {
        // Acks are broadcast to everyone; ignore any that is not ours.
        if (message.userId !== game.user?.id) return;
        const entry = pending.get(message.requestId);
        if (!entry) return;
        clearTimeout(entry.timer);
        pending.delete(message.requestId);
        if (message.ok) entry.resolve();
        else entry.reject(new Error(message.error ?? 'relay failed'));
    }
}
