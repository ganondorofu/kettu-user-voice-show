# kettu-user-voice-show

A [Kettu](https://github.com/C0C0B01/Kettu) port of Vencord's [UserVoiceShow](https://vencord.dev/plugins/UserVoiceShow) plugin. Shows a small green indicator when a user is currently in a voice call — any guild, or a DM/group call — even if it's not one you can see or join.

This ships **two independent indicators**, both active at once:

1. **Next to the display name** (profile popout, message headers, etc — matches where Vencord's own UserVoiceShow shows it).
2. **In the profile's badge tray** (Kettu/Bunny-specific location, alongside Nitro/HypeSquad-style badges) — kept as a fallback in case the name-icon patch doesn't apply to a given screen.

## How it works

**Name icon** — mirrors a real, published plugin that does the same kind of per-name decoration (`PlatformIndicators`, martinz64.github.io/vendetta-plugins/PlatformIndicators): find the module exporting a `DisplayName` component via `findByProps`, patch it with `after`, and push a small `Image` element into the rendered tree's children.

**Badge tray** — two patches, mirroring Kettu's own built-in **Badges** core plugin (`src/core/plugins/badges/index.tsx`):
1. `useBadges` — patched via `after("default", useBadgesModule, ...)` to prepend an "In a voice call" entry to a user's badge array. The entry's `icon` field is just an inert placeholder string (`"dummy"`) — on-device debug logs confirmed this part works end to end, but by itself renders nothing.
2. `window.bunny.api.react.jsx.onJsxCreate("ProfileBadge" / "RenderedBadge" / "RenderBadge", ...)` — the piece that actually draws the icon, matched by `ret.props.id`. `window.bunny` is a true global (set by Kettu's core at `src/index.ts`), reachable even though this plugin otherwise only gets the sandboxed `vendetta` object.

The image itself is a small (24×24, ~145 byte) green circle PNG embedded as a `data:` base64 URI, so it doesn't depend on finding a real Discord built-in asset name or fetching anything over the network.

## Status

The badge-tray indicator is confirmed working on-device. The name-icon indicator is new and only checked against a Node.js mock of `findByProps("DisplayName")` + `patcher.after` — the nested `children` path it pushes into is copied from PlatformIndicators' real (working) code, but this Discord build's exact component structure hasn't been confirmed live yet.

If either indicator doesn't appear, run **`/uvsdebug`** in any channel after opening someone's profile — it posts a local (only-you-can-see-it) message with the accumulated internal log, and report back what it says.

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
