# kettu-user-voice-show

A [Kettu](https://github.com/C0C0B01/Kettu) port of Vencord's [UserVoiceShow](https://vencord.dev/plugins/UserVoiceShow) plugin. Adds a small badge to a user's profile badge tray when they're currently in a voice call — any guild, or a DM/group call — even if it's not one you can see or join.

## How it works

Two patches, both mirroring known-working badge plugins:

1. `useBadges` — patched via `after("default", useBadgesModule, ...)` (the same hook Kettu's own built-in **Badges** core plugin uses, `src/core/plugins/badges/index.tsx`) to prepend an "In a voice call" entry to a user's badge array whenever `VoiceStateStore.getAllVoiceStates()` shows them connected somewhere. The entry's `icon` field is just an inert placeholder string (`"dummy"`) — on-device debug logs confirmed this part works end to end (`inVoice=true`, entry unshifted), but by itself it renders nothing.
2. `window.bunny.api.react.jsx.onJsxCreate("ProfileBadge" / "RenderedBadge" / "RenderBadge", ...)` — the piece that actually draws the icon. Both Kettu's Badges plugin and a separate published plugin doing the same kind of thing (`Global Badges`) turn out to swap in the *real* `source`/`label` here, matched by `ret.props.id`, rather than through the `useBadges` array's `icon` field at all. `window.bunny` is a true global (set by Kettu's core at `src/index.ts`), so it's reachable even though this plugin otherwise only gets the sandboxed `vendetta` object — that's what earlier versions of this plugin were missing, which is why the badge silently never appeared despite the detection logic being correct.

The image itself is a small (24×24, ~145 byte) green circle PNG embedded as a `data:` base64 URI, so it doesn't depend on finding a real Discord built-in asset name or fetching anything over the network.

If the badge still doesn't appear, run **`/uvsdebug`** in any channel after opening someone's profile — it posts a local (only-you-can-see-it) message with the accumulated internal log, and report back what it says.

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
