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

const VoiceStateStore = vendetta.metro.findByStoreName("VoiceStateStore");

// useBadges is the same hook Kettu's own built-in "Badges" core plugin
// patches (src/core/plugins/badges/index.tsx) to inject entries into a
// user's profile badge tray, via `after("default", useBadgesModule, ...)`.
// We use the exact same mechanism here since it's known-working Kettu code,
// just reached through the vendetta-compat findByName instead of the
// internal findByNameLazy.
const useBadgesModule = vendetta.metro.findByName("useBadges", false);

const ICON_CANDIDATES = ["ic_call", "ic_call_24px", "Phone", "PhoneCall", "VoiceChannel"];

function resolveIcon(): unknown {
    for (const name of ICON_CANDIDATES) {
        try {
            const id = getAssetIDByName?.(name);
            if (id != null) return id;
        } catch { }
    }
    return undefined;
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
        logger?.warn("[UserVoiceShow] could not find useBadges module, badge won't show");
        return;
    }

    cachedIcon = resolveIcon();

    unpatchBadges = vendetta.patcher.after("default", useBadgesModule, (args: any[], result: any[]) => {
        const user = args[0];
        const userId = user?.userId ?? user?.user?.id;
        if (!userId || !Array.isArray(result)) return;

        if (isUserInVoice(userId)) {
            result.unshift({
                id: "user-voice-show.in-call",
                description: "In a voice call",
                icon: cachedIcon,
            });
        }
    });
}

function onLoad() {
    try {
        patchBadges();
    } catch (e) {
        logger?.error("[UserVoiceShow] failed to patch badges:", e);
    }
}

function onUnload() {
    unpatchBadges?.();
    unpatchBadges = null;
}
