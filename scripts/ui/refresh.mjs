/**
 * Cross-window refresh.
 *
 * Every state change fans out from here, driven by the settings' own onChange.
 * The data layer never calls render() itself — that keeps "who repaints when"
 * in one readable place, and it is what makes a GM's Player-View toggle honest:
 * a change made in the Cockpit repaints the Player View through the identical
 * path a remote player's client uses.
 *
 * Deliberately imports no application class. Instances are found by a static
 * marker instead, so settings.mjs -> refresh.mjs -> apps/ never closes a cycle.
 */

/**
 * v14: ApplicationV2 instances live in foundry.applications.instances, a Map.
 * They never appear in ui.windows — checking there finds nothing and fails silently.
 */
function* ourInstances() {
    const instances = foundry.applications?.instances;
    if (!instances) return;
    for (const app of instances.values()) {
        if (app?.constructor?.RSR_APP === true) yield app;
    }
}

/** Re-render every open Situation Room window on this client. */
export function refreshAll() {
    for (const app of ourInstances()) {
        if (app.rendered) app.render();
    }
}

/** Count of open windows — used by the relay to decide whether a notification is worth showing. */
export function openCount() {
    let n = 0;
    for (const app of ourInstances()) if (app.rendered) n++;
    return n;
}
