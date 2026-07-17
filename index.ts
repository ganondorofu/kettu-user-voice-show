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

// A tiny (24x24, 145 byte) solid green circle PNG, embedded as a data: URI so
// this never depends on finding the right built-in Discord asset name or
// hosting/fetching an external image. Debug logs confirmed the badge-array
// patch itself works correctly (hook runs, inVoice detected, entry unshifted)
// with `icon: " _"` — the literal placeholder Kettu's own Badges core plugin
// uses — but nothing visibly rendered. That placeholder isn't a real image
// source; the core plugin's *actual* pixels come from a separate internal-
// only onJsxCreate patch on ProfileBadge/RenderedBadge that isn't reachable
// from this vendetta-compat plugin. Passing a real `{ uri }` image source
// directly should render regardless of that.
const VOICE_ICON_DATA_URI =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAWElEQVR4nO3Tyw0AIAhEQXqxK/uzTi1AJHxWI9FNuL45QXTDSquduy1RCGaNmxBvXIVE4yKCii+R3AA6PiEfeADI/wdHACTCxlGIGI8iqrgXMcW1WCiK2gA+FDGuAwEtHAAAAABJRU5ErkJggg==";

function resolveIcon(): unknown {
    for (const name of ICON_CANDIDATES) {
        try {
            const id = getAssetIDByName?.(name);
            if (id != null) return id;
        } catch { }
    }
    return { uri: VOICE_ICON_DATA_URI };
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

        // Only spend the limited debug budget on calls that actually have a
        // userId — useBadges also fires many times with no user data yet
        // (loading placeholders), and those were burning the budget before a
        // real profile was ever opened, hiding the inVoice=... line entirely.
        if (!userId || !Array.isArray(result)) return;

        debugLimited(`hook ran, userId=${userId}, resultType=array`);

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
