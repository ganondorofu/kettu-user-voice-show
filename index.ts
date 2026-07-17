// Kettu / Bunny "vendetta-compat" plugin body.
// This file's contents get wrapped by build.mjs into:
//   (function(vendetta){ <transpiled body> return { onLoad, onUnload }; })(vendetta)
// which is exactly what Kettu's legacy single-plugin installer expects at
// `<repoUrl>/index.js` (see src/core/vendetta/plugins.ts: evalPlugin).
//
// Port of Vencord's UserVoiceShow. Shows a small green icon when a user is
// currently connected to a voice channel anywhere (any guild, or a DM/group
// call), even if it's not one you can see or join — in two places:
//   1. Next to their display name (profile popup).
//   2. In their profile's badge tray.
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

// Discord's own native voice-speaker icon (found via Kettu's Developer ->
// Asset Browser, confirmed to exist in this build), used for both
// indicators below instead of a custom-drawn image so it matches Discord's
// actual design language.
const { getAssetIDByName } = vendetta.ui.assets;
const voiceIconAsset = getAssetIDByName("voice_bar_speaker_new");

// The badge tray's ProfileBadge/RenderedBadge components were originally
// built to accept custom badges' remote `{ uri }` image sources (see Kettu's
// own Badges core plugin, which always wraps badge.url that way) — passing a
// bare bundled-asset number through as `source` there rendered nothing,
// even though passing that same bare number directly to a plain
// `ReactNative.Image` (as the name icon below does, and as Kettu's own
// AssetBrowser does) works fine. Resolving it to a real `{ uri }` object via
// RN's own `Image.resolveAssetSource` makes it a normal image source
// regardless of which shape the consuming component expects.
const voiceIconSource = (() => {
    try {
        const resolved = ReactNative.Image?.resolveAssetSource?.(voiceIconAsset);
        return resolved?.uri ? { uri: resolved.uri } : voiceIconAsset;
    } catch {
        return voiceIconAsset;
    }
})();

// --- Badge tray -------------------------------------------------------
//
// Mirrors Kettu's own built-in Badges core plugin
// (src/core/plugins/badges/index.tsx): patch `useBadges` to add a
// placeholder-icon entry to the badge array, then separately patch the JSX
// creation of the badge-rendering components to swap in the real image,
// matched by id. The `icon` field on a useBadges() entry is NOT what
// actually gets drawn — that swap is what does it, via
// `window.bunny.api.react.jsx.onJsxCreate` (a true global set by Kettu's
// core, reachable even though this plugin otherwise only gets the sandboxed
// `vendetta` object).
const bunnyGlobal = (globalThis as any).bunny;
const onJsxCreate: undefined | ((component: string, cb: (Component: any, ret: any) => any) => void) =
    bunnyGlobal?.api?.react?.jsx?.onJsxCreate;
const deleteJsxCreate: undefined | ((component: string, cb: (Component: any, ret: any) => any) => void) =
    bunnyGlobal?.api?.react?.jsx?.deleteJsxCreate;

const useBadgesModule = vendetta.metro.findByName("useBadges", false);
const BADGE_ICON_PLACEHOLDER = "dummy";
const badgeIdPrefix = "user-voice-show-";
const badgeProps = new Map<string, { id: string; source: unknown; label: string; }>();

let unpatchBadges: (() => void) | null = null;

const JSX_BADGE_COMPONENTS = ["ProfileBadge", "RenderedBadge", "RenderBadge"];

function jsxImageSwap(_component: any, ret: any) {
    if (!ret?.props?.id?.startsWith?.(badgeIdPrefix)) return;
    const cached = badgeProps.get(ret.props.id);
    if (!cached) return;
    ret.props.source = cached.source;
    ret.props.label = cached.label;
    ret.props.id = cached.id;
}

function patchJsxImageSwap() {
    if (!onJsxCreate) return;
    for (const name of JSX_BADGE_COMPONENTS) onJsxCreate(name, jsxImageSwap);
}

function unpatchJsxImageSwap() {
    if (!deleteJsxCreate) return;
    for (const name of JSX_BADGE_COMPONENTS) deleteJsxCreate(name, jsxImageSwap);
}

function patchBadges() {
    if (!useBadgesModule || typeof useBadgesModule.default !== "function") return;

    unpatchBadges = vendetta.patcher.after("default", useBadgesModule, (args: any[], result: any) => {
        const user = args[0];
        const userId = user?.userId ?? user?.user?.id ?? user?.id;
        if (!userId || !Array.isArray(result)) return;
        if (!isUserInVoice(userId)) return;

        const badgeId = `${badgeIdPrefix}${userId}`;
        badgeProps.set(badgeId, {
            id: badgeId,
            source: voiceIconSource,
            label: "In a voice call",
        });
        result.unshift({
            id: badgeId,
            description: "In a voice call",
            icon: BADGE_ICON_PLACEHOLDER,
        });
    });
}

// --- Name icon ----------------------------------------------------------
//
// Finds the outer `UserProfileContent` via `findByTypeName` (matches the
// *rendered element's* type name, not a module export key — works even for
// components that were never independently exported), patches its `.type`,
// then digs through that specific render's actual output with
// `findInReactTree` to locate `PrimaryInfo` -> `UserProfilePrimaryInfo` ->
// `Username` one level at a time, patching each newly-found element's
// `.type` in turn as it's discovered. Technique adapted from the published
// `PlatformIndicators` plugin (martinz64.github.io/vendetta-plugins/PlatformIndicators).
function buildVoiceIndicator() {
    return React.createElement(ReactNative.Image, {
        key: "user-voice-show-username-icon",
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

const memberRowUnpatchers: Array<() => void> = [];

// NOTE: each of these patches the *element's* `.type` property (the render
// function React actually calls for that element), never `element.type`'s
// own "type" property.
function patchUsernameElement(usernameEl: any) {
    memberRowUnpatchers.push(vendetta.patcher.after("type", usernameEl, (args: any[], ret: any) => {
        const userId = args[0]?.user?.id ?? args[0]?.userId;
        if (!userId || !isUserInVoice(userId)) return;
        try {
            appendVoiceIndicator(ret);
        } catch (e) {
            logger?.error("[UserVoiceShow] failed to append name icon:", e);
        }
    }));
}

let unpatchNameIcon: (() => void) | null = null;

function patchNameIcon() {
    const UserProfileContent = vendetta.metro.findByTypeName?.("UserProfileContent");
    if (!UserProfileContent) return;

    memberRowUnpatchers.push(vendetta.patcher.after("type", UserProfileContent, (_args: any[], outer: any) => {
        const primaryInfo = findInReactTree(outer, (n: any) => n?.type?.name === "PrimaryInfo");
        if (!primaryInfo) return;

        memberRowUnpatchers.push(vendetta.patcher.after("type", primaryInfo, (_a: any[], primaryInfoRet: any) => {
            const userProfilePrimaryInfo = findInReactTree(primaryInfoRet, (n: any) => n?.type?.name === "UserProfilePrimaryInfo");
            if (!userProfilePrimaryInfo) return;

            memberRowUnpatchers.push(vendetta.patcher.after("type", userProfilePrimaryInfo, (_b: any[], infoRet: any) => {
                const usernameEl = findInReactTree(infoRet, (n: any) => n?.type?.name === "Username" || n?.type?.name === "DisplayName");
                if (usernameEl) patchUsernameElement(usernameEl);
            }));
        }));
    }));

    unpatchNameIcon = () => memberRowUnpatchers.splice(0).forEach(u => u());
}

// --- Member list (guild sidebar, DM list, etc) --------------------------
//
// `findByProps("GuildMemberRow")`/`findByProps("UserRow")`/`findByName(...)`
// all either came back empty or found something that never actually fired
// when patched — those export names/lookups don't correspond to what's
// really rendered in this build. `findByTypeName` succeeded for the profile
// screen's `UserProfileContent` (it matches by the *rendered element's* type
// name rather than a module export key), so the member list uses the same
// kind of search: `findByTypeNameAll("UserRow")` returns *every* module
// exporting a component whose rendered name is "UserRow" (there can be more
// than one across a bundle), and each one gets patched — covering the guild
// member sidebar and DM list regardless of which module actually backs the
// screen currently open. Technique adapted from `PlatformIndicators`, which
// does the same `findByTypeNameAll("UserRow")` sweep for its own member-list
// icons.
let unpatchMemberList: (() => void) | null = null;

function injectIntoRow(ret: any): boolean {
    const row = findInReactTree(ret, (n: any) => n?.props?.style?.flexDirection === "row" && Array.isArray(n?.props?.children));
    if (row) {
        row.props.children.splice(2, 0, buildVoiceIndicator());
        return true;
    }
    return appendVoiceIndicator(ret);
}

function patchMemberList() {
    const userRows: any[] = vendetta.metro.findByTypeNameAll?.("UserRow") ?? [];
    const unpatchers = userRows.map(userRow => vendetta.patcher.after("type", userRow, (args: any[], ret: any) => {
        const userId = args[0]?.user?.id ?? args[0]?.userId;
        if (!userId || !isUserInVoice(userId)) return;
        try {
            injectIntoRow(ret);
        } catch (e) {
            logger?.error("[UserVoiceShow] failed to append member-list icon:", e);
        }
    }));

    unpatchMemberList = () => unpatchers.forEach(u => u());
}

function onLoad() {
    try {
        patchJsxImageSwap();
        patchBadges();
    } catch (e) {
        logger?.error("[UserVoiceShow] failed to patch badge tray:", e);
    }

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
    unpatchBadges?.();
    unpatchBadges = null;
    unpatchJsxImageSwap();
    badgeProps.clear();
    unpatchNameIcon?.();
    unpatchNameIcon = null;
    unpatchMemberList?.();
    unpatchMemberList = null;
}
