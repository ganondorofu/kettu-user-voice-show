# kettu-user-voice-show

A [Kettu](https://github.com/C0C0B01/Kettu) port of Vencord's [UserVoiceShow](https://vencord.dev/plugins/UserVoiceShow) plugin. Adds a small badge to a user's profile badge tray when they're currently in a voice call — any guild, or a DM/group call — even if it's not one you can see or join.

## How it works

Kettu's own built-in **Badges** core plugin (`src/core/plugins/badges/index.tsx`) injects entries into a user's profile by patching the `useBadges` hook with `after("default", useBadgesModule, ...)`. This plugin uses that exact same, known-working mechanism (reached via the `vendetta`-compat `metro.findByName` / `patcher.after`) to prepend an "In a voice call" badge whenever `VoiceStateStore.getAllVoiceStates()` shows the profile's user connected somewhere.

## Status: unverified on-device

This has only been checked against a Node.js mock of the relevant Kettu/vendetta APIs (`findByName`, `patcher.after`, a fake `VoiceStateStore`) — the control flow and badge-array mutation behave correctly there, but two things depend on the real Discord mobile bundle and haven't been confirmed live:

- **Icon asset name** — it tries `ic_call`, `ic_call_24px`, `Phone`, `PhoneCall`, `VoiceChannel` in that order via `getAssetIDByName` and falls back to no icon if none resolve. If the badge shows up with no icon, that's why — open an issue/PR with the correct asset name if you find it.
- **`VoiceStateStore` shape** — it calls `getAllVoiceStates()` (a long-standing Discord internal API used by Vencord/BetterDiscord/Aliucord/Enmity plugins for the same purpose) and falls back to `getVoiceStateForUser(userId)`. If neither exists on this store in the current Discord build, the badge just never shows (fails closed, no crash).

If the badge doesn't appear, the rest of the app is unaffected — please report what you see (or check `logger` output) so this can be adjusted.

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
