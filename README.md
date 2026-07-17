# kettu-user-voice-show

A [Kettu](https://github.com/C0C0B01/Kettu) port of Vencord's [UserVoiceShow](https://vencord.dev/plugins/UserVoiceShow) plugin. Shows a small "🔊" indicator when a user is currently in a voice call — any guild, or a DM/group call — even if it's not one you can see or join.

This ships **two independent indicators**, both active at once:

1. **In the member list**, next to the username (a "🔊" emoji, easy to read at a glance without needing to tap anything).
2. **In the profile's badge tray** (Kettu/Bunny-specific location, alongside Nitro/HypeSquad-style badges) — a small green circle icon; tapping/holding it shows the "In a voice call" label like any other badge.

## How it works

**Name icon** — `/uvssniff` (see below) found the real, live component names by recording everything actually rendered on-device, rather than guessing: `Username`, `UserProfilePrimaryInfo`, `UserTagAndPronouns`, etc — none of the names several published plugins use (`GuildMemberRow`, `UserRow`, `DisplayName`, ...) exist under those names in this Discord build. But even `findByProps("Username")` came back `null` on-device, despite `/uvssniff` proving a component whose function name is literally `Username` really renders — because `findByProps` searches *export key* names, which don't have to match the underlying function's own `.name` in bundled/minified code. `findByName("Username", false)` is the correct lookup instead (the same one that successfully found `useBadges`): called with `defaultExp: false` it returns the raw module rather than an auto-unwrapped `.default`, which gets patched directly — mirroring the `useBadges().default` patch that's confirmed working. A `Text("🔊")` element is spliced into its rendered output.

**Badge tray** — two patches, mirroring Kettu's own built-in **Badges** core plugin (`src/core/plugins/badges/index.tsx`):
1. `useBadges` — patched via `after("default", useBadgesModule, ...)` to prepend an "In a voice call" entry to a user's badge array. The entry's `icon` field is just an inert placeholder string (`"dummy"`).
2. `window.bunny.api.react.jsx.onJsxCreate("ProfileBadge" / "RenderedBadge" / "RenderBadge", ...)` — the piece that actually draws the icon, matched by `ret.props.id`. `window.bunny` is a true global (set by Kettu's core at `src/index.ts`), reachable even though this plugin otherwise only gets the sandboxed `vendetta` object. The image is a small (24×24, ~145 byte) green circle PNG embedded as a `data:` base64 URI, so it doesn't depend on finding a real Discord built-in asset name or fetching anything over the network.

**`/uvssniff [filter]`** — a from-scratch component-name finder, added after both several published-plugin component names *and* a live React DevTools connection (`ws://<pc-ip>:8097`, Settings → Developer → DevTools URL) failed to pin down the right target. It patches the raw JSX-runtime `jsx`/`jsxs` functions (the same underlying primitive `onJsxCreate` is built on) to record every distinct component name actually rendered — no devtools connection needed. Browse the screen you care about, then run e.g. `/uvssniff user` (or any substring, or no filter for everything seen) to get the real names as a local message.

## Status

The badge-tray indicator is confirmed working on-device. The `Username` name-icon patch now uses `findByName` (matching the `useBadges` lookup pattern that's confirmed working) instead of the `findByProps` lookup that came back empty for this specific component. Whether it actually fires and what shape its props are (`user`/`userId`, or just a plain string?) will show up in `/uvsdebug` as `Username (findByName) props keys: ...` the first time it renders.

**`/uvsdebug`'s and `/uvssniff`'s first line is the plugin version** (e.g. `UserVoiceShow v1.9.0`) — check this first after reinstalling, since GitHub raw/CDN propagation delay has repeatedly made it unclear whether Kettu actually fetched the latest build. If the version shown is stale, wait a bit and reinstall again before reporting a bug.

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
