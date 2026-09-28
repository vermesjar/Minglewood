# Discord integration

Discord is Minglewood's first communication substrate. Minglewood is the *place*; Discord carries
the *conversation*. This document records what the platform actually allows (verified against
the current developer docs at `docs.discord.com/developers`, September 2026), what we built on
top of it, and where we deliberately stop.

## Capability audit

| Want | Discord mechanism | Status in Minglewood |
| --- | --- | --- |
| Sign in, verify company membership | OAuth2 `identify` + `guilds.members.read`; `GET /users/@me/guilds/{guild}/member` (404 ⇒ not a member) | ✅ Implemented (`/api/auth/discord/*`) |
| List channels to bind to rooms | Bot token, `GET /guilds/{guild}/channels`; bot needs **View Channels** only | ✅ Admin → Rooms & channels |
| Who is in a voice channel (+ mute/video) | Gateway, intents `GUILDS` + `GUILD_VOICE_STATES` (both non-privileged). `GUILD_CREATE` carries initial `voice_states`, then `VOICE_STATE_UPDATE` | ✅ People in a bound channel appear in the room (`via: provider`), even if they never opened Minglewood |
| Online/idle status | `GUILD_PRESENCES` (privileged) | ❌ Intentionally not requested. Availability is something members choose to share in Minglewood. |
| Live speaking indicators | Embedded App SDK `SPEAKING_START/STOP` require `rpc.voice.read`, granted only to approved partners; bots only see speaking by joining voice | ❌ Not available. UI shows "in voice" + mute instead. Demo mode simulates speaking and labels it as such. |
| Put a user into a voice channel | No API moves a user into voice unless already connected; the Embedded App SDK has **no** join/select-voice command | ❌ Not possible. We deep-link: `https://discord.com/channels/{guild}/{channel}` opens the channel; the user clicks "Join Voice". |
| Embed video/voice streams in our world | Not exposed | ❌ Participants are represented as avatars; the call stays in Discord. |
| Run inside Discord | Embedded App SDK (`@discord/embedded-app-sdk`) Activities | ✅ Supported (see below) |
| Who's in this Activity | `getInstanceConnectedParticipants` + `ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE` (no scope) | ✅ Toast on join |
| Open links from inside the Activity | `openExternalLink` (no scope) | ✅ Used for "Join the conversation" |
| Rich presence ("Playing Minglewood in Café") | `setActivity` needs `rpc.activities.write` | ⏸ Not requested (keep scopes minimal). Easy to add later. |

The same matrix is rendered live in **Admin → Discord** from `DiscordProvider.capabilities`.

## Setup

1. Create an application at <https://discord.com/developers/applications>.
2. **OAuth2** → copy Client ID and Client Secret into `.env`
   (`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`). Add the redirect
   `http://localhost:5173/api/auth/discord/callback` (or your `PUBLIC_URL` equivalent).
3. **Bot** → reset/copy the token into `DISCORD_BOT_TOKEN`. No privileged intents are needed.
4. Restart `npm run dev`. Sign in to Minglewood as an admin (the demo admin works), open
   **Admin → Discord**, click *Add the bot to your server*, then *Find servers the bot is in* →
   *Connect*.
5. **Admin → Rooms & channels**: switch a room's provider to Discord and pick a voice channel.
6. Members can now use **Continue with Discord** on the sign-in page. Only members of the
   connected server are admitted. Anyone sitting in a bound voice channel shows up in that room.

Optional: `DISCORD_GUILD_ID` pre-connects a server; `DISCORD_ADMIN_USER_IDS` makes specific
Discord users admins on first sign-in.

## Running as a Discord Activity

1. In the Developer Portal: **Activities → Settings → enable**; **URL Mappings**: map `/` to your
   public tunnel host (e.g. `cloudflared tunnel --url http://localhost:5173`). Vite's dev server
   allows any host, and the client automatically routes API and WebSocket traffic through
   Discord's `/.proxy/` prefix when it detects the Activity launch parameters.
2. Launch the Activity from a voice channel. The client runs `authorize` (scopes `identify`,
   `guilds.members.read`), the server exchanges the code (the secret never leaves the server),
   verifies server membership, and returns the SDK access token plus a Minglewood bearer session
   (third-party cookies are unreliable inside the iframe).
3. If the voice channel the Activity was launched in is bound to a room, you arrive directly in
   that room — the Activity *is* the room.

## Architecture boundary

- `src/server/providers/types.ts` — `CommunicationProvider` interface and capability flags.
- `src/server/providers/discord/*` — REST client, OAuth, minimal voice-only gateway, provider.
- `src/server/providers/demo.ts` — the credential-free demo provider (honest about being a demo).
- `src/server/providers/voiceSync.ts` — maps provider voice state → world presence via
  `RoomBinding` and `ExternalIdentity`. The world engine never sees a Discord id.

Adding Slack or Teams means implementing `CommunicationProvider` (+ an identity flow and an
optional presence source) and allowing the new `ProviderKind` in bindings. No world code changes.

## Security notes

- Scopes: `identify`, `guilds.members.read`. Bot permission: `1024` (View Channels).
- User access tokens are used once to verify membership and discarded (except in Activity mode,
  where the SDK needs it client-side for `authenticate`).
- OAuth `state` is bound to an HttpOnly cookie; sessions are HMAC-signed and org-scoped.
