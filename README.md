# kettu-user-voice-show

A [Kettu](https://github.com/C0C0B01/Kettu) port of Vencord's [UserVoiceShow](https://vencord.dev/plugins/UserVoiceShow) plugin. Shows a small "🔊" indicator when a user is currently in a voice call — any guild, or a DM/group call — even if it's not one you can see or join.

This ships **two independent indicators**, both active at once:

1. **In the member list**, next to the username (a "🔊" emoji, easy to read at a glance without needing to tap anything).
2. **In the profile's badge tray** (Kettu/Bunny-specific location, alongside Nitro/HypeSquad-style badges) — a small green circle icon; tapping/holding it shows the "In a voice call" label like any other badge.

## How it works

**Name icon** — neither `findByProps("Username")` nor `findByName("Username", false)` could locate it on-device, even though `/uvssniff` (see below) proved a component whose function name is literally `Username` really renders — because it's evidently never independently registered as a top-level module export at all (just a local/inlined function used inside some other module), and both of those lookups search the module registry's exports. The published `PlatformIndicators` plugin (martinz64.github.io/vendetta-plugins/PlatformIndicators) solves the same problem a different way for its own profile-screen icon: no module-registry lookup for the inner pieces at all. It finds the outer `UserProfileContent` via `findByTypeName` (a different search — matches the *rendered element's* type name, not an export key), patches its `.type`, then digs through *that specific render's actual output* with `findInReactTree` to locate `PrimaryInfo` → `UserProfilePrimaryInfo` → `DisplayName` one level at a time, patching each newly-found element's `.type` in turn as it's discovered. Since each target comes from a real render's output rather than a registry search, it works even for components that were never separately exported. This plugin follows the identical chain, swapping the last step for `Username` (or `DisplayName`, tried as a fallback) since that's what `/uvssniff` confirmed this build actually calls it, and `UserProfilePrimaryInfo` itself was independently confirmed to render here too. A `Text("🔊")` element is pushed into the found element's rendered children.

**Badge tray** — two patches, mirroring Kettu's own built-in **Badges** core plugin (`src/core/plugins/badges/index.tsx`):
1. `useBadges` — patched via `after("default", useBadgesModule, ...)` to prepend an "In a voice call" entry to a user's badge array. The entry's `icon` field is just an inert placeholder string (`"dummy"`).
2. `window.bunny.api.react.jsx.onJsxCreate("ProfileBadge" / "RenderedBadge" / "RenderBadge", ...)` — the piece that actually draws the icon, matched by `ret.props.id`. `window.bunny` is a true global (set by Kettu's core at `src/index.ts`), reachable even though this plugin otherwise only gets the sandboxed `vendetta` object. The image is a small (24×24, ~145 byte) green circle PNG embedded as a `data:` base64 URI, so it doesn't depend on finding a real Discord built-in asset name or fetching anything over the network.

**`/uvssniff [filter]`** — a from-scratch component-name finder, added after both several published-plugin component names *and* a live React DevTools connection (`ws://<pc-ip>:8097`, Settings → Developer → DevTools URL) failed to pin down the right target. It patches the raw JSX-runtime `jsx`/`jsxs` functions (the same underlying primitive `onJsxCreate` is built on) to record every distinct component name actually rendered — no devtools connection needed. Browse the screen you care about, then run e.g. `/uvssniff user` (or any substring, or no filter for everything seen) to get the real names as a local message.

## Status

The badge-tray indicator is confirmed working on-device. The name-icon patch (the `UserProfileContent` → `PrimaryInfo` → `UserProfilePrimaryInfo` → `Username` chain) is checked against a faithful Node.js mock of the full 4-level nested patch chain and behaves correctly there, but hasn't been confirmed live yet. `/uvsdebug` will show which step of the chain (if any) fails to find its target, or `Username.type ran, userId=...` if it makes it all the way through.

**`/uvsdebug`'s and `/uvssniff`'s first line is the plugin version** (e.g. `UserVoiceShow v2.1.0`) — check this first after reinstalling, since GitHub raw/CDN propagation delay has repeatedly made it unclear whether Kettu actually fetched the latest build. If the version shown is stale, wait a bit and reinstall again before reporting a bug.

## Building

```bash
npm install
npm run build
```

Transpiles `index.ts` and wraps it into `index.js` as a single JS expression consumed by Kettu's single-plugin installer (see [kettu-anti-bracket-freeze](https://github.com/ganondorofu/kettu-anti-bracket-freeze) for the full explanation of this format). The build script also (re)computes `manifest.json`'s `hash` field.

## Installing in Kettu

1. Push this repo to GitHub so `manifest.json` and `index.js` are served at the root, e.g.
   `https://raw.githubusercontent.com/ganondorofu/kettu-user-voice-show/master/`
2. In Kettu, go to Plugins → install/add a plugin, and paste that base URL **with a trailing slash**.
3. Enable **UserVoiceShow**.

## License

MIT
