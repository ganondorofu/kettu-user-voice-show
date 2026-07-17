# kettu-user-voice-show

A [Kettu](https://github.com/C0C0B01/Kettu) port of Vencord's [UserVoiceShow](https://vencord.dev/plugins/UserVoiceShow) plugin. Adds a small badge to a user's profile badge tray when they're currently in a voice call — any guild, or a DM/group call — even if it's not one you can see or join.

## How it works

Kettu's own built-in **Badges** core plugin (`src/core/plugins/badges/index.tsx`) injects entries into a user's profile by patching the `useBadges` hook with `after("default", useBadgesModule, ...)`. This plugin uses that exact same, known-working mechanism (reached via the `vendetta`-compat `metro.findByName` / `patcher.after`) to prepend an "In a voice call" badge whenever `VoiceStateStore.getAllVoiceStates()` shows the profile's user connected somewhere.

## Status: badge logic confirmed working, icon rendering unverified

On-device debug logs (via `/uvsdebug`) confirmed the actual detection/patch logic works end to end: `VoiceStateStore` resolves, the `useBadges` hook fires for the right user, `inVoice` correctly comes back `true`, and the badge entry gets unshifted into the array. But with `icon: " _"` (the literal placeholder Kettu's own Badges core plugin uses internally) nothing visibly rendered.

The likely reason: that core plugin's *actual* pixels don't come from the `icon` field in the `useBadges` array at all — they come from a separate, internal-only patch on `ProfileBadge`/`RenderedBadge`'s JSX creation (`onJsxCreate`, see `src/core/plugins/badges/index.tsx`) that swaps in a real `source: { uri }`. That API isn't reachable from external (`vendetta`-compat) plugins, so `" _"` alone is just an inert placeholder with nothing behind it.

To work around this without needing that internal API, the badge's `icon` now falls back to a small (24×24, ~145 byte) green circle PNG embedded directly as a `data:` URI (`{ uri: "data:image/png;base64,..." }`) — a plain image source that shouldn't depend on Discord's own bundled asset names or any network fetch. Still unverified whether the badge tray's icon renderer actually accepts a `{ uri }` data-URI object; if it doesn't, the badge should still just fail to render silently rather than crash.

If it still doesn't appear, run **`/uvsdebug`** in any channel after opening someone's profile — it posts a local (only-you-can-see-it) message with the accumulated internal log, and report back what it says.

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
