// Kettu / Bunny "vendetta-compat" plugin body.
// This file's contents get wrapped by build.mjs into:
//   (function(vendetta){ <transpiled body> return { onLoad, onUnload }; })(vendetta)
// which is exactly what Kettu's legacy single-plugin installer expects at
// `<repoUrl>/index.js` (see src/core/vendetta/plugins.ts: evalPlugin).
//
// Port of Vencord's UserVoiceShow: adds a small badge to a user's profile
// badge tray when they're currently connected to a voice channel anywhere
// (any guild, or a DM/group call), even if it's not one you can see/join.
declare const vendetta: any;

const logger = vendetta.logger;
const { getAssetIDByName } = vendetta.ui.assets;
const { showToast } = vendetta.ui.toasts;

// TEMPORARY: toasts turned out to be unreadable for this — useBadges fires on
// every rendered avatar (message rows, member list, etc), not just when
// opening a profile, so they fired in a fast, overlapping stream. Instead we
// silently accumulate entries here and expose them on-demand via a
// `/uvsdebug` slash command (registered in registerDebugCommand below), which
// posts them as a local message you can read/scroll at your own pace.
// Remove all of this once the badge is confirmed working.
const debugLog: string[] = [];
const seenOnce = new Set<string>();
let hookCallBudget = 5;

function pushDebug(msg: string) {
    debugLog.push(msg);
    if (debugLog.length > 60) debugLog.shift();
}

function debugOnce(msg: string) {
    if (seenOnce.has(msg)) return;
    seenOnce.add(msg);
    pushDebug(msg);
}

function debugLimited(msg: string) {
    if (hookCallBudget <= 0) return;
    hookCallBudget--;
    pushDebug(msg + (hookCallBudget === 0 ? " (further hook logs suppressed)" : ""));
}

let unregisterDebugCommand: (() => void) | null = null;

function registerDebugCommand() {
    const messageUtil = vendetta.metro.findByProps("sendBotMessage");
    if (!messageUtil?.sendBotMessage || typeof vendetta.commands?.registerCommand !== "function") {
        logger?.warn("[UserVoiceShow] could not register /uvsdebug (messageUtil or registerCommand missing)");
        return;
    }

    unregisterDebugCommand = vendetta.commands.registerCommand({
        name: "uvsdebug",
        description: "Show UserVoiceShow's debug log",
        execute(_args: any[], ctx: any) {
            const content = debugLog.length ? debugLog.join("\n") : "(no debug entries yet — open someone's profile first)";
            messageUtil.sendBotMessage(ctx.channel.id, content);
        },
    });
}

const VoiceStateStore = vendetta.metro.findByStoreName("VoiceStateStore");

// useBadges is the same hook Kettu's own built-in "Badges" core plugin
// patches (src/core/plugins/badges/index.tsx) to inject entries into a
// user's profile badge tray, via `after("default", useBadgesModule, ...)`.
// We use the exact same mechanism here since it's known-working Kettu code,
// just reached through the vendetta-compat findByName instead of the
// internal findByNameLazy.
const useBadgesModule = vendetta.metro.findByName("useBadges", false);

const ICON_CANDIDATES = ["ic_call", "ic_call_24px", "Phone", "PhoneCall", "VoiceChannel"];

// Kettu's own Badges core plugin (src/core/plugins/badges/index.tsx) sets
// `icon: " _"` (a literal placeholder string, not a real asset id) on every
// badge it injects via this exact same mechanism, and that visibly works in
// the shipped app. A previous version of this plugin left `icon` as
// `undefined` when none of the ICON_CANDIDATES resolved via
// getAssetIDByName — which is the likely reason the badge silently failed to
// render even though the patch logic itself ran correctly (confirmed via
// debug toasts). Falling back to that same placeholder now.
const FALLBACK_ICON = " _";

function resolveIcon(): unknown {
    for (const name of ICON_CANDIDATES) {
        try {
            const id = getAssetIDByName?.(name);
            if (id != null) return id;
        } catch { }
    }
    return FALLBACK_ICON;
}

let cachedIcon: unknown;

function isUserInVoice(userId: string): boolean {
    try {
        // getAllVoiceStates() -> { [guildId]: { [userId]: VoiceState } }
        // DM/group calls are commonly bucketed under a special "@me" guild id.
        const allStates = VoiceStateStore?.getAllVoiceStates?.();
        if (allStates) {
            for (const guildId in allStates) {
                if (allStates[guildId]?.[userId]) return true;
            }
        }

        // Fallback for stores that only expose a per-user lookup.
        const single = VoiceStateStore?.getVoiceStateForUser?.(userId);
        if (single) return true;
    } catch (e) {
        logger?.error("[UserVoiceShow] failed to read voice state:", e);
    }
    return false;
}

let unpatchBadges: (() => void) | null = null;

function patchBadges() {
    if (!useBadgesModule || typeof useBadgesModule.default !== "function") {
        debugOnce(`useBadges NOT found (module=${!!useBadgesModule})`);
        return;
    }
    debugOnce("useBadges found, patch installed");

    cachedIcon = resolveIcon();
    debugOnce(`icon resolved: ${cachedIcon != null ? String(cachedIcon) : "none"}`);

    unpatchBadges = vendetta.patcher.after("default", useBadgesModule, (args: any[], result: any) => {
        const user = args[0];
        const userId = user?.userId ?? user?.user?.id ?? user?.id;

        // Most useful single piece of info: what fields the hook's argument
        // actually has, so we can confirm/fix how userId is extracted above.
        debugOnce(`user arg keys: ${user ? Object.keys(user).join(",") : "null/undefined"}`);

        debugLimited(`hook ran, userId=${userId ?? "?"}, resultType=${Array.isArray(result) ? "array" : typeof result}`);

        if (!userId || !Array.isArray(result)) return;

        const inVoice = isUserInVoice(userId);
        debugLimited(`inVoice=${inVoice} for ${userId}`);

        if (inVoice) {
            result.unshift({
                id: "user-voice-show.in-call",
                description: "In a voice call",
                icon: cachedIcon,
            });
        }
    });
}

function onLoad() {
    debugOnce(`VoiceStateStore found: ${!!VoiceStateStore}`);
    try {
        patchBadges();
    } catch (e) {
        logger?.error("[UserVoiceShow] failed to patch badges:", e);
        debugOnce(`patch threw: ${e}`);
    }

    try {
        registerDebugCommand();
    } catch (e) {
        logger?.error("[UserVoiceShow] failed to register /uvsdebug:", e);
    }

    showToast?.("UserVoiceShow loaded — run /uvsdebug after viewing a profile to see debug info");
}

function onUnload() {
    unpatchBadges?.();
    unpatchBadges = null;
    unregisterDebugCommand?.();
    unregisterDebugCommand = null;
    debugLog.length = 0;
    seenOnce.clear();
    hookCallBudget = 5;
}
