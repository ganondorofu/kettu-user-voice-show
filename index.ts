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

// Bump this on every meaningful change and check it via /uvsdebug's first
// line — GitHub raw/CDN propagation delay repeatedly made it unclear whether
// Kettu had actually fetched the latest build after reinstalling.
const PLUGIN_VERSION = "1.9.0";

const logger = vendetta.logger;
const { showToast } = vendetta.ui.toasts;
const React = vendetta.metro.common.React;
const ReactNative = vendetta.metro.common.ReactNative;
const { findInReactTree } = vendetta.utils;

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
let nameHookCallBudget = 5;

function pushDebug(msg: string) {
    debugLog.push(msg);
    if (debugLog.length > 60) debugLog.shift();
}

function debugOnce(msg: string) {
    if (seenOnce.has(msg)) return;
    seenOnce.add(msg);
    pushDebug(msg);
}

// Separate budget from debugLimitedName below — useBadges and DisplayName
// fire independently, and sharing one counter meant one could exhaust it
// before the other ever logged anything useful.
function debugLimited(msg: string) {
    if (hookCallBudget <= 0) return;
    hookCallBudget--;
    pushDebug(msg + (hookCallBudget === 0 ? " (further useBadges hook logs suppressed)" : ""));
}

function debugLimitedName(msg: string) {
    if (nameHookCallBudget <= 0) return;
    nameHookCallBudget--;
    pushDebug(msg + (nameHookCallBudget === 0 ? " (further DisplayName hook logs suppressed)" : ""));
}

let unregisterDebugCommand: (() => void) | null = null;
let unregisterSniffCommand: (() => void) | null = null;

// A real-DevTools-free way to find actual component names: patch the raw
// JSX-runtime functions themselves — the same underlying primitive
// `window.bunny.api.react.jsx.onJsxCreate` is built on (see
// src/lib/api/react/jsx.ts's `patchJsx`) — and just record every distinct
// `Component.name` that gets created while some screen is open. Query the
// results afterwards with `/uvssniff <filter>` instead of needing a live
// react-devtools connection (which failed to attach reliably on-device).
const seenComponentNames = new Set<string>();
let unpatchSniffer: (() => void) | null = null;

function patchComponentSniffer() {
    const jsxRuntime = vendetta.metro.findByProps("jsx", "jsxs");
    if (!jsxRuntime) {
        debugOnce("jsx runtime (findByProps('jsx','jsxs')) NOT found — /uvssniff unavailable");
        return;
    }

    const record = (args: any[]) => {
        const Component = args[0];
        const name = typeof Component === "function" ? Component.name
            : typeof Component === "string" ? `<${Component}>`
                : undefined;
        if (name) seenComponentNames.add(name);
    };

    const unpatchJsx = typeof jsxRuntime.jsx === "function" ? vendetta.patcher.after("jsx", jsxRuntime, record) : null;
    const unpatchJsxs = typeof jsxRuntime.jsxs === "function" ? vendetta.patcher.after("jsxs", jsxRuntime, record) : null;

    if (!unpatchJsx && !unpatchJsxs) {
        debugOnce("jsx runtime found but neither .jsx nor .jsxs is a function — /uvssniff unavailable");
        return;
    }
    debugOnce("component sniffer active — browse a screen, then run /uvssniff <filter>");

    unpatchSniffer = () => {
        unpatchJsx?.();
        unpatchJsxs?.();
    };
}

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
            const body = debugLog.length ? debugLog.join("\n") : "(no debug entries yet — open someone's profile / a member list first)";
            messageUtil.sendBotMessage(ctx.channel.id, `UserVoiceShow v${PLUGIN_VERSION}\n${body}`);
        },
    });

    unregisterSniffCommand = vendetta.commands.registerCommand({
        name: "uvssniff",
        description: "List rendered React component names matching a filter (case-insensitive substring)",
        options: [{ name: "filter", type: 3 /* STRING */, description: "e.g. member, row, user", required: false }],
        execute(args: any[], ctx: any) {
            const filter = (args[0]?.value ?? "").toString().toLowerCase();
            const names = [...seenComponentNames]
                .filter(n => !filter || n.toLowerCase().includes(filter))
                .sort();
            const body = names.length
                ? `${names.length} match(es) out of ${seenComponentNames.size} seen:\n${names.join(", ")}`
                : `No matches out of ${seenComponentNames.size} component names seen so far. Browse the screen you care about first, then retry.`;
            messageUtil.sendBotMessage(ctx.channel.id, `UserVoiceShow v${PLUGIN_VERSION} — /uvssniff ${filter || "(all)"}\n${body}`);
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

// A tiny (24x24, 145 byte) solid green circle PNG, embedded as a data: URI so
// this never depends on finding the right built-in Discord asset name or
// hosting/fetching an external image.
const VOICE_ICON_DATA_URI =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAWElEQVR4nO3Tyw0AIAhEQXqxK/uzTi1AJHxWI9FNuL45QXTDSquduy1RCGaNmxBvXIVE4yKCii+R3AA6PiEfeADI/wdHACTCxlGIGI8iqrgXMcW1WCiK2gA+FDGuAwEtHAAAAABJRU5ErkJggg==";

// Debug logs confirmed the badge-ARRAY patch works perfectly end to end
// (hook fires, inVoice detected, entry unshifted with a real `{ uri }` image
// source) — but nothing ever rendered. Comparing against a *working*
// published plugin that does the same kind of thing (`Global Badges`,
// plugins.obamabot.me/vendetta-plugins/globalBadges) revealed why: the
// `icon` field on a useBadges() entry is NOT what actually gets drawn.
// Both that plugin and Kettu's own built-in Badges core plugin
// (src/core/plugins/badges/index.tsx) push a throwaway placeholder there
// (`icon: "dummy"` / `icon: " _"`) and instead separately patch the JSX
// creation of the `ProfileBadge`/`RenderedBadge` (Kettu) or
// `ProfileBadge`/`RenderBadge` (Global Badges) components via
// `onJsxCreate`, swapping in the *real* `source`/`label` there by matching
// `ret.props.id`. That hook lives at `window.bunny.api.react.jsx.onJsxCreate`
// — a true global, not something passed into vendetta-compat plugins, but
// reachable anyway since it's just `window.bunny`, not scoped per-loader.
const bunnyGlobal = (globalThis as any).bunny;
const onJsxCreate: undefined | ((component: string, cb: (Component: any, ret: any) => any) => void) =
    bunnyGlobal?.api?.react?.jsx?.onJsxCreate;
const deleteJsxCreate: undefined | ((component: string, cb: (Component: any, ret: any) => any) => void) =
    bunnyGlobal?.api?.react?.jsx?.deleteJsxCreate;

const BADGE_ICON_PLACEHOLDER = "dummy";
const badgeIdPrefix = "user-voice-show-";
const badgeProps = new Map<string, { id: string; source: { uri: string; }; label: string; }>();

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
    if (!onJsxCreate) {
        debugOnce("window.bunny.api.react.jsx.onJsxCreate NOT available");
        return;
    }
    debugOnce("onJsxCreate available, registering image swap");

    // Names differ slightly between Kettu's own Badges plugin
    // ("ProfileBadge"/"RenderedBadge") and other third-party badge plugins
    // ("ProfileBadge"/"RenderBadge") — register all of them, extras are harmless.
    for (const name of JSX_BADGE_COMPONENTS) onJsxCreate(name, jsxImageSwap);
}

function unpatchJsxImageSwap() {
    if (!deleteJsxCreate) return;
    for (const name of JSX_BADGE_COMPONENTS) deleteJsxCreate(name, jsxImageSwap);
}

function patchBadges() {
    if (!useBadgesModule || typeof useBadgesModule.default !== "function") {
        debugOnce(`useBadges NOT found (module=${!!useBadgesModule})`);
        return;
    }
    debugOnce("useBadges found, patch installed");

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
        }
    });
}

// Places a small "🔊" indicator in the member list row, next to the
// username — closer to where Vencord's own UserVoiceShow shows it than the
// profile-only badge tray above.
//
// An earlier version of this patched `findByProps("DisplayName")`'s
// `DisplayName` export directly via `after`, but on-device logs showed the
// patched function simply never got called (zero hook fires despite the
// module being found) — almost certainly because whatever renders it holds
// its own destructured reference to the *original* function captured before
// this plugin loaded, the same class of bug behind an earlier issue where
// this plugin's sibling project couldn't intercept the user's own outgoing
// messages via a similarly-late property patch.
//
// This uses a different, sturdier target instead: `GuildMemberRow`, patched
// via `after("type", ...)` rather than a bare named export — `.type` here is
// the actual function React invokes to render each element (same category of
// patch that worked for the badge tray's `useBadges` `.default` and the
// message-long-press action sheet's `.default`, both confirmed working
// on-device), so it should be substituted consistently for every render
// rather than only for callers that still hold the pre-patch reference.
// Technique adapted from the published `PlatformIndicators` plugin
// (martinz64.github.io/vendetta-plugins/PlatformIndicators), which does the
// same kind of per-row icon injection into `GuildMemberRow`.
let unpatchMemberRow: (() => void) | null = null;

function buildVoiceIndicator() {
    return React.createElement(
        ReactNative.Text,
        { key: "user-voice-show-member-row-icon", style: { fontSize: 12, marginLeft: 4 } },
        "🔊",
    );
}

function injectIntoMemberRow(ret: any): boolean {
    // PlatformIndicators finds the row container by its flex-row style and
    // splices a new element in at index 2.
    const row = findInReactTree(ret, (node: any) => node?.props?.style?.flexDirection === "row" && Array.isArray(node?.props?.children));
    if (row) {
        row.props.children.splice(2, 0, buildVoiceIndicator());
        return true;
    }

    // Fallback: any children array at all.
    const container = findInReactTree(ret, (node: any) => Array.isArray(node?.props?.children) && node.props.children.length > 0);
    if (container) {
        container.props.children.push(buildVoiceIndicator());
        return true;
    }

    return false;
}

// `findByProps("GuildMemberRow")` (and UserRow/MemberListItem/etc) all came
// back empty on-device — those export names don't exist in this build.
// `/uvssniff` (a from-scratch component-name sniffer, see
// patchComponentSniffer below) found the *real* names instead by recording
// every component actually rendered while browsing: profile-related
// component names came back as `UserProfilePrimaryInfo`, `Username`,
// `UserTagAndPronouns`, etc — no "Row"/"Member"-named component appeared
// (that sniff was taken while viewing a profile, not the member-list
// sidebar specifically, so a per-row component may still exist and just
// wasn't observed yet).
//
// `Username` is the most promising target — but `findByProps("Username")`
// came back null on-device, even though `/uvssniff` proved a component whose
// *function name* (`Component.name`) is literally "Username" really is being
// rendered. That means it isn't re-exported under a module property called
// "Username" — `findByProps` searches export *key* names, which don't have
// to match the underlying function's `.name`, especially in bundled/minified
// code. `findByName` is the right tool here instead: it's the exact same
// lookup (`metro.findByName`) that successfully found `useBadges` earlier —
// called with `defaultExp: false` so it returns the raw module (not an
// auto-unwrapped `.default`), letting us patch `.default` on it directly,
// mirroring the useBadges patch that's confirmed working on-device.
const MEMBER_ROW_CANDIDATES = ["Username", "GuildMemberRow", "UserRow", "MemberListItem", "GuildMember", "UserListItem"];

function findMemberRowComponent(): { label: string; target: any; prop: string; } | null {
    for (const name of MEMBER_ROW_CANDIDATES) {
        try {
            const byName = vendetta.metro.findByName(name, false);
            if (byName && typeof byName.default === "function") {
                debugOnce(`findByName("${name}", false) -> module with .default function, patching .default`);
                return { label: `${name} (findByName)`, target: byName, prop: "default" };
            }
            if (byName) {
                debugOnce(`findByName("${name}", false) -> found but no .default (keys=${Object.keys(byName).slice(0, 8).join(",")})`);
            } else {
                debugOnce(`findByName("${name}", false) -> null`);
            }
        } catch (e) {
            debugOnce(`findByName("${name}") threw: ${e}`);
        }

        try {
            const mod = vendetta.metro.findByProps(name);
            const exported = mod?.[name];
            if (exported == null) {
                debugOnce(`findByProps("${name}") -> ${mod ? `module found but no .${name} (keys=${Object.keys(mod).slice(0, 8).join(",")})` : "null"}`);
                continue;
            }
            if (typeof exported === "object" && typeof exported.type === "function") {
                debugOnce(`findByProps("${name}") -> object with .type, patching .type`);
                return { label: name, target: exported, prop: "type" };
            }
            if (typeof exported === "function") {
                debugOnce(`findByProps("${name}") -> bare function, patching "${name}" on its module directly`);
                return { label: name, target: mod, prop: name };
            }
            debugOnce(`findByProps("${name}") -> found but unrecognized shape (${typeof exported})`);
        } catch (e) {
            debugOnce(`findByProps("${name}") threw: ${e}`);
        }
    }
    return null;
}

function patchMemberRow() {
    const found = findMemberRowComponent();
    if (!found) {
        debugOnce("No member-row component found from any candidate — member-list indicator unavailable (badge tray still applies)");
        return;
    }
    debugOnce(`${found.label} found, patching`);

    unpatchMemberRow = vendetta.patcher.after(found.prop, found.target, (args: any[], ret: any) => {
        // Log the raw prop shape once — "Username" in particular might not
        // receive a `user`/`userId` prop directly (could just be a string),
        // in which case this whole approach needs rethinking once we see it.
        debugOnce(`${found.label} props keys: ${args[0] ? Object.keys(args[0]).join(",") : "null/undefined"}`);

        const user = args[0]?.user;
        const userId = user?.id ?? args[0]?.userId;
        if (!userId) {
            debugLimitedName(`${found.label} ran but no user/userId prop found`);
            return;
        }

        debugLimitedName(`${found.label} ran, userId=${userId}`);

        if (!isUserInVoice(userId)) return;

        try {
            const appended = injectIntoMemberRow(ret);
            debugLimitedName(`icon inject ${appended ? "succeeded" : "found no children array"} for ${userId}`);
        } catch (e) {
            debugLimitedName(`icon inject threw: ${e}`);
        }
    });
}

function onLoad() {
    debugOnce(`VoiceStateStore found: ${!!VoiceStateStore}`);
    try {
        patchJsxImageSwap();
    } catch (e) {
        logger?.error("[UserVoiceShow] failed to patch JSX image swap:", e);
        debugOnce(`jsx patch threw: ${e}`);
    }

    try {
        patchBadges();
    } catch (e) {
        logger?.error("[UserVoiceShow] failed to patch badges:", e);
        debugOnce(`patch threw: ${e}`);
    }

    try {
        patchMemberRow();
    } catch (e) {
        logger?.error("[UserVoiceShow] failed to patch GuildMemberRow:", e);
        debugOnce(`GuildMemberRow patch threw: ${e}`);
    }

    try {
        patchComponentSniffer();
    } catch (e) {
        logger?.error("[UserVoiceShow] failed to patch component sniffer:", e);
        debugOnce(`sniffer patch threw: ${e}`);
    }

    try {
        registerDebugCommand();
    } catch (e) {
        logger?.error("[UserVoiceShow] failed to register /uvsdebug:", e);
    }

    showToast?.(`UserVoiceShow v${PLUGIN_VERSION} loaded — run /uvsdebug after viewing a profile/member list to see debug info`);
}

function onUnload() {
    unpatchBadges?.();
    unpatchBadges = null;
    unpatchJsxImageSwap();
    badgeProps.clear();
    unpatchMemberRow?.();
    unpatchMemberRow = null;
    unpatchSniffer?.();
    unpatchSniffer = null;
    seenComponentNames.clear();
    unregisterDebugCommand?.();
    unregisterDebugCommand = null;
    unregisterSniffCommand?.();
    unregisterSniffCommand = null;
    debugLog.length = 0;
    seenOnce.clear();
    hookCallBudget = 5;
    nameHookCallBudget = 5;
}
