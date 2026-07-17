# kettu-user-voice-show

A [Kettu](https://github.com/C0C0B01/Kettu) port of Vencord's [UserVoiceShow](https://vencord.dev/plugins/UserVoiceShow) plugin. Shows Discord's own native voice-speaker icon when a user is currently in a voice call — any guild, or a DM/group call — even if it's not one you can see or join.

Two indicators, both active at once:

1. **Next to the display name** on the profile popup.
2. **In the member list** (guild sidebar and DM list — wherever Vencord's own UserVoiceShow shows it).

## How it works

**Name icon** — finds the outer `UserProfileContent` via `findByTypeName` (matches the *rendered element's* type name, not a module export key — works even for components that were never independently exported), patches its `.type`, then digs through that specific render's actual output with `findInReactTree` to locate `PrimaryInfo` → `UserProfilePrimaryInfo` → `Username` one level at a time, patching each newly-found element's `.type` in turn as it's discovered. Technique adapted from the published `PlatformIndicators` plugin (martinz64.github.io/vendetta-plugins/PlatformIndicators).

**Member list** — `findByProps("GuildMemberRow")`/`findByProps("UserRow")`/`findByName(...)` all either came back empty or found something that never actually fired once patched. `findByTypeNameAll("UserRow")` (the same *rendered-element-name* search that worked for the profile screen, plural — returns every module whose rendered component is named "UserRow", since there can be more than one across the bundle) is used instead, patching each match's `.type`. Two row shapes are handled, since `PlatformIndicators` itself has two separate patches for this same reason: Discord's redesigned "TabsV2" list rows carry their content in `props.label` (a nested element, not a children array) and get that wrapped in a new row with the icon appended; older/classic rows carry a normal `props.children` array and get the icon spliced into whichever child looks like a horizontal row container.

Both indicators use Discord's own built-in `voice_bar_speaker_new` asset (found via Kettu's Settings → Developer → Asset Browser, which lists every asset name actually available at runtime), resolved with `getAssetIDByName` — so it matches Discord's own design language instead of a custom-drawn image.

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
