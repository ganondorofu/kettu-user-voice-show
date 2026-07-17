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

// A small (32x32, ~215 byte) green circle with a white phone-handset glyph,
// embedded as a data: URI so this never depends on finding a real Discord
// built-in asset name or fetching anything over the network. Used for both
// indicators below.
const VOICE_ICON_DATA_URI =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAnElEQVR4nNXU2w2AMAxD0e7SrdiPOWEAkjSp7QCR+onu6UOM8beZ53FF65WoFLMbhxFoGIKw4yWEKp5GMCLWpACsXXoTIpjHvAKYCGW4BZAZF9AdfyDU9+0tGSD7LQxA4hAAOXYYwIpvAZjxMoAdn9V/gTTuAaJB4jAAjZsAC9G2ew8hf3ifBKwQ8riFkD26Dsh2mIGgxKsYSVQ5N4ra2OCoOm9aAAAAAElFTkSuQmCC";

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
const badgeProps = new Map<string, { id: string; source: { uri: string; }; label: string; }>();

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
            source: { uri: VOICE_ICON_DATA_URI },
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
        source: { uri: VOICE_ICON_DATA_URI },
        style: { width: 12, height: 12, marginLeft: 4, borderRadius: 6 },
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
}

function onUnload() {
    unpatchBadges?.();
    unpatchBadges = null;
    unpatchJsxImageSwap();
    badgeProps.clear();
    unpatchNameIcon?.();
    unpatchNameIcon = null;
}
