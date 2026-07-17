# kettu-user-voice-show

A [Kettu](https://github.com/C0C0B01/Kettu) port of Vencord's [UserVoiceShow](https://vencord.dev/plugins/UserVoiceShow) plugin. Shows Discord's own native voice-speaker icon when a user is currently in a voice call — any guild, or a DM/group call — even if it's not one you can see or join.

This ships **three independent indicators**, all active at once:

1. **Next to the display name** on the profile popup.
2. **In the member list** (guild sidebar and DM list — wherever Vencord's own UserVoiceShow shows it).
3. **In the profile's badge tray** (Kettu/Bunny-specific location, alongside Nitro/HypeSquad-style badges) — tapping/holding it shows the "In a voice call" label like any other badge.

## How it works

**Name icon** — finds the outer `UserProfileContent` via `findByTypeName` (matches the *rendered element's* type name, not a module export key — works even for components that were never independently exported), patches its `.type`, then digs through that specific render's actual output with `findInReactTree` to locate `PrimaryInfo` → `UserProfilePrimaryInfo` → `Username` one level at a time, patching each newly-found element's `.type` in turn as it's discovered. Technique adapted from the published `PlatformIndicators` plugin (martinz64.github.io/vendetta-plugins/PlatformIndicators).

**Member list** — `findByProps("GuildMemberRow")`/`findByProps("UserRow")`/`findByName(...)` all either came back empty or found something that never actually fired once patched. `findByTypeNameAll("UserRow")` (the same *rendered-element-name* search that worked for the profile screen, plural — returns every module whose rendered component is named "UserRow", since there can be more than one across the bundle) is used instead, patching each match's `.type` and splicing the icon into whichever row container looks like a horizontal row (falls back to just appending to the render's children). Same technique `PlatformIndicators` uses for its own member-list icons.

**Badge tray** — two patches, mirroring Kettu's own built-in **Badges** core plugin (`src/core/plugins/badges/index.tsx`):
1. `useBadges` — patched via `after("default", useBadgesModule, ...)` to prepend an "In a voice call" entry to a user's badge array. The entry's `icon` field is just an inert placeholder string (`"dummy"`).
2. `window.bunny.api.react.jsx.onJsxCreate("ProfileBadge" / "RenderedBadge" / "RenderBadge", ...)` — the piece that actually draws the icon, matched by `ret.props.id`. `window.bunny` is a true global (set by Kettu's core at `src/index.ts`), reachable even though this plugin otherwise only gets the sandboxed `vendetta` object.

All three indicators use Discord's own built-in `voice_bar_speaker_new` asset (found via Kettu's Settings → Developer → Asset Browser, which lists every asset name actually available at runtime), resolved with `getAssetIDByName` — so it matches Discord's own design language instead of a custom-drawn image. The badge tray specifically needs it resolved to a real `{ uri }` object via `ReactNative.Image.resolveAssetSource` first — the badge-rendering components were built for custom badges' remote URLs and don't render a bare bundled-asset number, even though a bare number works fine passed directly to a plain `Image` (as the name/member-list icons do).

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
