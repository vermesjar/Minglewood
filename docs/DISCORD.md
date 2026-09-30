# Discord integration

Discord is Minglewood's first communication substrate. Minglewood is the *place*; Discord carries
the *conversation*. This document records what the platform actually allows (verified against
the current developer docs at `docs.discord.com/developers`, September 2026), what we built on
top of it, and where we deliberately stop.

## Spaces are channels

Every space in the world is its Discord channels. The town is the server's **#general** (and the
General voice channel); each building has its own text and voice channel. Discord is the book of
record: Minglewood mirrors and drives it, and stores no messages of its own.

- **Walk into a space → you're in its voice channel.** Discord never lets an app connect someone
  to voice, but once you are in *any* voice channel the bot can move you (Move Members). So: join
  voice once (the chat panel's **Join voice** button opens the space's channel in Discord), and
  from then on walking into the café moves you into the café's voice channel. It works the other
  way too: switch channels in Discord and your avatar walks into that space. Members can turn this
  off (Profile → *Voice follows me*).
- **Say something in a space → it's posted in its text channel**, under your name and Discord
  picture (a Minglewood webhook per channel). If the bot can't manage webhooks it posts as itself:
  `**Name**: text`.
- **Post in the channel → it shows up in the space**, in the chat panel and as a speech bubble over
  you if you're standing there. Mentions are shown by name and never ping anyone.
- **Walk in → you see the channel's recent history** (the last 30 messages), loaded from Discord.
- **Rename or delete a channel in Discord → the space follows** (label updated / link removed).
- Quiet rooms have no channels, on purpose.

Code: `src/server/providers/discord/bridge.ts` (chat, history, voice follow, channel sync),
`setup.ts` (matching and creating channels), `gateway.ts` (intents), the hub's per-space chat log
(`OrgHub.pushChat`), and `src/client/ui/ChatPanel.tsx`.

## Capability audit

| Want | Discord mechanism | Status in Minglewood |
| --- | --- | --- |
| Sign in, verify company membership | OAuth2 `identify` + `guilds.members.read`; `GET /users/@me/guilds/{guild}/member` (404 ⇒ not a member) | ✅ Implemented (`/api/auth/discord/*`) |
| Link spaces to channels | Bot token, `GET /guilds/{guild}/channels` (View Channels) | ✅ Admin → Spaces & channels: a voice and a text channel per space, the town included |
| Set up channels for every space | `POST /guilds/{guild}/channels` (Manage Channels) | ✅ Admin → Spaces & channels → *Link, and create what's missing* (matches by name first; creates a "Minglewood" category) |
| Who is in a voice channel (+ mute/video) | Gateway `GUILDS` + `GUILD_VOICE_STATES` (non-privileged) | ✅ People in a bound channel appear in the space, even if they never opened Minglewood |
| Voice follows you between spaces | `PATCH /guilds/{guild}/members/{user}` with `channel_id` (Move Members; works only for someone already in voice) | ✅ Walking in moves you; switching in Discord walks your avatar |
| Connect someone to voice from nothing | Not exposed (no API, no SDK command) | ❌ We deep-link for the first join: `https://discord.com/channels/{guild}/{channel}` |
| Chat from the world into the channel | Webhook per channel (Manage Webhooks), `POST /webhooks/{id}/{token}` with the member's name and avatar; `allowed_mentions: []` | ✅ |
| Chat from the channel into the world | Gateway `GUILD_MESSAGES` + **Message Content** (privileged — switch it on in the Developer Portal) | ✅ Without Message Content we see that a message happened but not its text; admin shows ❌ |
| History when you arrive | `GET /channels/{id}/messages` (Read Message History) | ✅ Last 30, in memory only |
| Online/idle status | `GUILD_PRESENCES` (privileged) | ❌ Intentionally not requested. Availability is something members choose to share. |
| Live speaking indicators | Needs `rpc.voice.read` (approved partners only) | ❌ Not available; UI shows "in voice" + mute. |
| Run inside Discord | Embedded App SDK Activities | ✅ Supported (see below) |

The same matrix is rendered live in **Admin → Discord**, and **Admin → Spaces & channels** checks the
bot's actual permissions in your server and links to re-grant anything missing.

### Bot permissions

`554781712` = View Channels, Read Message History, Send Messages, Embed Links, Manage Webhooks,
Connect, Move Members, Manage Channels. Servers that added the bot earlier keep the old permissions
until someone clicks **Add to Discord** again for the same server (that only updates permissions).

## Setup (and testing it on your own server)

1. Create an application at <https://discord.com/developers/applications> (or use the existing one).
2. **OAuth2** → copy Client ID and Client Secret into `.env` (`DISCORD_CLIENT_ID`,
   `DISCORD_CLIENT_SECRET`). Add the redirect `http://localhost:5173/api/auth/discord/callback`
   (or your `PUBLIC_URL` equivalent).
3. **Bot** → copy the token into `DISCORD_BOT_TOKEN`, and under *Privileged Gateway Intents* turn on
   **Message Content Intent** (leave Presence and Server Members off).
4. Put your server's id in `DISCORD_GUILD_ID` (Discord → Settings → Advanced → Developer Mode, then
   right-click the server → *Copy Server ID*) and your own user id in `DISCORD_ADMIN_USER_IDS`.
5. Restart `npm run dev`. The log should say *gateway ready — voice presence, channel chat and
   voice follow are live*. If it warns that Message Content is off, step 3 isn't saved yet.
6. Add (or re-add) the bot with the new permissions: **Admin → Discord → Add the bot**, or the
   Minglewood Cloud *Add to Discord* button. Then **Admin → Discord → Connect** your server.
7. **Admin → Spaces & channels → Link, and create what's missing.** Check the permissions list is
   all ✅.
8. Sign in with **Continue with Discord**. Join the town's voice channel once (chat panel →
   *Join voice*), then walk into the café: Discord moves you to the café's voice channel. Type in
   the world and watch it appear in `#tidewater-cafe`; post in Discord and watch it appear in the
   world.

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
