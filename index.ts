// Kettu / Bunny "vendetta-compat" plugin body.
// This file's contents get wrapped by build.mjs into:
//   (function(vendetta){ <transpiled body> return { onLoad, onUnload }; })(vendetta)
// which is exactly what Kettu's legacy single-plugin installer expects at
// `<repoUrl>/index.js` (see src/core/vendetta/plugins.ts: evalPlugin).
//
// Port of Vencord's UserVoiceShow. Shows Discord's own native voice-speaker
// icon next to a user's name when they're currently connected to a voice
// channel anywhere (any guild, or a DM/group call), even if it's not one you
// can see or join — both on their profile popup and in the member list.
declare const vendetta: any;

const logger = vendetta.logger;
const React = vendetta.metro.common.React;
const ReactNative = vendetta.metro.common.ReactNative;
const { findInReactTree } = vendetta.utils;

const VoiceStateStore = vendetta.metro.findByStoreName("VoiceStateStore");

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

// Discord's own native voice-speaker icon (found via Kettu's Settings ->
// Developer -> Asset Browser, confirmed to exist in this build), so this
// matches Discord's actual design language instead of a custom-drawn image.
const { getAssetIDByName } = vendetta.ui.assets;
const voiceIconAsset = getAssetIDByName("voice_bar_speaker_new");

function buildVoiceIndicator() {
    return React.createElement(ReactNative.Image, {
        key: "user-voice-show-icon",
        source: voiceIconAsset,
        style: { width: 14, height: 14, marginLeft: 4 },
    });
}

function appendVoiceIndicator(childrenHost: any): boolean {
    if (Array.isArray(childrenHost?.props?.children)) {
        childrenHost.props.children.push(buildVoiceIndicator());
        return true;
    }
    return false;
}

const unpatchers: Array<() => void> = [];

// --- Name icon (profile popup) -------------------------------------------
//
// Finds the outer `UserProfileContent` via `findByTypeName` (matches the
// *rendered element's* type name, not a module export key — works even for
// components that were never independently exported), patches its `.type`,
// then digs through that specific render's actual output with
// `findInReactTree` to locate `PrimaryInfo` -> `UserProfilePrimaryInfo` ->
// `Username` one level at a time, patching each newly-found element's
// `.type` in turn as it's discovered. Technique adapted from the published
// `PlatformIndicators` plugin (martinz64.github.io/vendetta-plugins/PlatformIndicators).
//
// NOTE: each of these patches the *element's* `.type` property (the render
// function React actually calls for that element), never `element.type`'s
// own "type" property.
function patchUsernameElement(usernameEl: any) {
    unpatchers.push(vendetta.patcher.after("type", usernameEl, (args: any[], ret: any) => {
        const userId = args[0]?.user?.id ?? args[0]?.userId;
        if (!userId || !isUserInVoice(userId)) return;
        try {
            appendVoiceIndicator(ret);
        } catch (e) {
            logger?.error("[UserVoiceShow] failed to append name icon:", e);
        }
    }));
}

function patchNameIcon() {
    const UserProfileContent = vendetta.metro.findByTypeName?.("UserProfileContent");
    if (!UserProfileContent) return;

    unpatchers.push(vendetta.patcher.after("type", UserProfileContent, (_args: any[], outer: any) => {
        const primaryInfo = findInReactTree(outer, (n: any) => n?.type?.name === "PrimaryInfo");
        if (!primaryInfo) return;

        unpatchers.push(vendetta.patcher.after("type", primaryInfo, (_a: any[], primaryInfoRet: any) => {
            const userProfilePrimaryInfo = findInReactTree(primaryInfoRet, (n: any) => n?.type?.name === "UserProfilePrimaryInfo");
            if (!userProfilePrimaryInfo) return;

            unpatchers.push(vendetta.patcher.after("type", userProfilePrimaryInfo, (_b: any[], infoRet: any) => {
                const usernameEl = findInReactTree(infoRet, (n: any) => n?.type?.name === "Username" || n?.type?.name === "DisplayName");
                if (usernameEl) patchUsernameElement(usernameEl);
            }));
        }));
    }));
}

// --- Member list (guild sidebar, DM list, etc) --------------------------
//
// `findByProps("GuildMemberRow")`/`findByProps("UserRow")`/`findByName(...)`
// all either came back empty or found something that never actually fired
// when patched — those export names/lookups don't correspond to what's
// really rendered in this build. `findByTypeNameAll("UserRow")` (the same
// *rendered-element-name* search that worked for the profile screen, plural
// — returns every module whose rendered component is named "UserRow", since
// there can be more than one across the bundle) is used instead, patching
// each match's `.type` and splicing the icon into whichever row container
// looks like a horizontal row (falls back to just appending to the render's
// children). Same technique `PlatformIndicators` uses for its own
// member-list icons.
// PlatformIndicators actually has *two* separate UserRow patches: an older
// one for a classic row tree (children array, matched here below) and a
// newer one for Discord's "TabsV2" redesigned list rows, where the row's
// content lives at `ret.props.label` (itself a nested element) rather than
// a typical children array — there, it wraps `props.label` in a new row
// containing the original label plus the icon, instead of touching
// `props.children` at all. Both are tried here since which one applies
// depends on whether this build's member list uses the redesigned UI.
const VOICE_ICON_KEY = "user-voice-show-icon";

// Guards against adding the icon twice to the same render — belt-and-braces
// alongside the reference-dedupe in patchMemberList below, in case two
// distinct UserRow implementations legitimately both fire for what's
// visually the same row (e.g. one wrapping the other).
function alreadyHasIcon(node: any): boolean {
    if (!node) return false;
    if (node.key === VOICE_ICON_KEY) return true;
    const children = node.props?.children;
    if (Array.isArray(children)) return children.some(alreadyHasIcon);
    return alreadyHasIcon(node.props?.label);
}

function injectIntoRow(ret: any): boolean {
    if (alreadyHasIcon(ret)) return false;

    if (ret?.props && "label" in ret.props) {
        ret.props.label = React.createElement(
            ReactNative.View,
            { style: { flexDirection: "row", alignItems: "center" } },
            ret.props.label,
            buildVoiceIndicator(),
        );
        return true;
    }

    const row = findInReactTree(ret, (n: any) => n?.props?.style?.flexDirection === "row" && Array.isArray(n?.props?.children));
    if (row) {
        row.props.children.splice(2, 0, buildVoiceIndicator());
        return true;
    }
    return appendVoiceIndicator(ret);
}

function patchMemberList() {
    // findByTypeNameAll can return the same underlying component object more
    // than once (aliased under multiple module ids) — patching it twice
    // would wrap it twice, firing the injection callback (and so adding the
    // icon) twice per actual render. Dedupe by reference first.
    const userRows: any[] = [...new Set<any>(vendetta.metro.findByTypeNameAll?.("UserRow") ?? [])];
    for (const userRow of userRows) {
        unpatchers.push(vendetta.patcher.after("type", userRow, (args: any[], ret: any) => {
            const userId = args[0]?.user?.id ?? args[0]?.userId;
            if (!userId || !isUserInVoice(userId)) return;
            try {
                injectIntoRow(ret);
            } catch (e) {
                logger?.error("[UserVoiceShow] failed to append member-list icon:", e);
            }
        }));
    }
}

function onLoad() {
    try {
        patchNameIcon();
    } catch (e) {
        logger?.error("[UserVoiceShow] failed to patch name icon:", e);
    }

    try {
        patchMemberList();
    } catch (e) {
        logger?.error("[UserVoiceShow] failed to patch member list:", e);
    }
}

function onUnload() {
    unpatchers.splice(0).forEach(u => u());
}
