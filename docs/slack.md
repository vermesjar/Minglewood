# Slack

Slack is Minglewood's second communication substrate, behind the same provider seam as Discord (`CommunicationProvider`,
the shared voice-presence sync, the per-space chat log). Minglewood is the *place*; Slack carries the *conversation*. The
world engine doesn't know which one is connected. This document records what Slack actually allows (checked against
`api.slack.com` in October 2026), what we built on it, and where we deliberately stop.

## Spaces are channels

Every space in the world is a Slack channel. In Slack a channel is both a conversation and a huddle, so each space has
**one** channel: the town is the workspace's default channel (**#general**, or **#all-<workspace>** in newer
workspaces), each room has a channel named after it. Slack is the book of
record: Minglewood mirrors and drives it, and stores no messages of its own.

| | |
|---|---|
| **Say something in a space → it's posted in its channel**, under your Slack name and picture (`chat.postMessage` with `username` / `icon_url`, scope `chat:write.customize`). Slack shows its small "APP" tag: no app may post *as* a person. Without the scope, the app posts `*Name*: text`. Typed `@mentions` are never linked, so nothing pings anyone. |
| **Post in the channel → it shows up in the space**, in the chat panel and as a speech bubble over the author if they're standing there. Mentions are shown by name; Slack's `<…>` escapes become words; attachments are noted. Thread replies stay in Slack (a reply "also sent to the channel" shows). |
| **Walk in → you see the channel's recent history** (the last 30 messages), loaded from Slack. |
| **Rename, archive or delete a channel in Slack → the space follows** (label updated / link removed). |
| **Join a huddle in Slack → you appear in its space**, sitting down, even if you never opened Minglewood — the way Discord voice works. If you were already walking around, your avatar walks over (Profile → *Voice follows me* turns that off). |
| **Walk into a space while you're in a huddle elsewhere → one click to switch.** Slack has no API that moves someone between huddles (Discord does, for voice), so the chat panel shows **🎧 Switch to the huddle in #café** instead of moving you. |
| **Join the huddle** — one click while a huddle is running: Slack's huddle link (`app.slack.com/huddle/{team}/{channel}`) launches the desktop app straight into it (or the web client). The world knows a huddle is running because its participants are in the room. With nobody in it yet, the button opens the channel, where the headphones button starts one (the huddle link answers "Server Error" until a huddle exists). |
| **Talk light (opt-in)** — Slack doesn't tell apps who's speaking, so members can let their own browser watch their mic *level* while in a huddle (🎙️ in the chat panel). Only "talking yes/no" leaves the page. |
| **Status ↔ status** — Slack → world: calendar "In a meeting" → *In a meeting*; Do Not Disturb, headphones, "focus" → *Focused*; vacation, lunch, sick, commuting → *Away*; 👋 or "say hi" → *Open to chat*; anything else shows as a note (only while someone is around). World → Slack: after a one-time grant (Profile → *Sync my status to Slack*, user scope `users.profile:write`), the status and note you set here become your Slack status — 👋 Open to chat, 🎧 Focused, 📅 In a meeting, 🚶 Stepped away, with your note as the text and the status's expiry — and *Available* clears it (with a note, 💬 the note). Only statuses you set yourself are mirrored (never a calendar's or Slack's own). The echo Slack sends back is recognised, so the two never fight. |
| **/minglewood** — `who` · `where @maya` · `join @maya` · `wave @maya` · `knock @maya` · `room design` · `help`. Replies are private (ephemeral). |
| **Link previews** — room links (`/?room=design`) and person links (`/?to=<member>`) unfurl with who's there and a "Walk in" button. |
| **Knocks as DMs** — opt-in per person (profile). Only while they aren't in the world. |
| **Daily "who's around"** — optional; Admin → Slack picks the channel and hour (org timezone). |
| Quiet rooms have no channels, on purpose. |

## Silent disco: who's hearing what

A space has one voice (its channel's huddle), but the people in it can be on other calls — a table's huddle, a
one-on-one — or on none. Slack tells us every huddle anyone joins (`user_huddle_changed`, with the huddle's call id,
for channel *and* DM huddles), so the world can show it. A small badge by each name:

| Badge | Meaning |
|---|---|
| **Gold headphones** | On the room's own huddle. Everyone gold is talking together. |
| **Colored headphones** | On another huddle that someone else in this room is also on (a table). Same call, same color. |
| **Colored phone** | On a call with nobody in this room — talking to someone elsewhere. |
| **Grey, slashed** | In the room but on no call. Present, hearing nothing. |

What you can do about it:

- **Start a huddle with…** Tick people in the room panel (or *Huddle with Maya* on her card). Slack can't start a
  huddle for us, so this opens the right conversation in Slack — the DM for one person, a group DM of the people
  picked (with the app in it, `mpim:write`) for several, with a note saying where to click. The headphones button
  there starts it; Slack drops you from the room's huddle on its own, and the badges follow within a second.
- **Join** a colored huddle that's in a channel we know: one click, straight in (Slack's huddle link).
- **Ask to join** a huddle we can't link into (a DM huddle): everyone on that call gets a note in the world and a
  Slack DM; any of them can invite you from Slack's huddle window (*Invite people*). Slack has no invite API, so a
  walk-up into a private huddle always needs a yes from someone inside.
- The chat panel's button follows your own state: *Join the room's huddle* when you're grey, *Switch to the room's
  huddle* when you're colored.

The same model holds for Discord voice channels, with the channel as the call.

**The app has to be in a channel to hear it.** Slack only sends a channel's messages and huddle updates to apps that are
members. Minglewood joins public channels itself when a space is linked (`channels:join`) and when the one-click setup
runs; private channels need `/invite @Minglewood`. **Admin → Spaces & channels** shows which linked channels the app
isn't in yet, with a Join button or the invite instruction.

Code: `src/server/slack/bridge.ts` (chat, history, channel sync), `setup.ts` (matching, creating and joining channels;
the readiness check), `presence.ts` (huddles, statuses, the walk-over), `service.ts` (routing events to companies),
`routes.ts`, the hub's per-space chat log (`OrgHub.pushChat`), `src/client/ui/ChatPanel.tsx`, and the admin UI in
`src/client/admin/AdminConsole.tsx` (`SlackSetup`) and `SlackTab.tsx`.

## Capability audit

| Want | Slack mechanism | Status in Minglewood |
| --- | --- | --- |
| Sign in, know who you are | Sign in with Slack (OpenID Connect: `openid profile email`) | ✅ A Slack user is always the same member; first sign-in joins a member with the same verified email |
| Add the app to a workspace | OAuth v2 (`oauth.v2.access`) → bot token | ✅ From the landing page (**Add to Slack**: a new company on Minglewood Cloud, or this server's workspace) or the admin console (connects to the admin's world) |
| List channels to link spaces to | `conversations.list` (`channels:read`, `groups:read`) | ✅ Admin → Spaces & channels |
| A channel for every space, in one click | `conversations.create` (`channels:manage`), `conversations.join` (`channels:join`) | ✅ Matches by name (#general is the town), creates what's missing, joins what it links |
| Who is in a huddle, and where | Events `user_huddle_changed` (`users:read`) + the channel's `huddle_thread` message (`channels:history`) | ✅ The huddle message isn't a formally documented API; verify on your workspace (Testing) |
| Chat from the world into the channel | `chat.postMessage` with `username`/`icon_url` (`chat:write`, `chat:write.customize`) | ✅ |
| Chat from the channel into the world | Events `message.channels` / `message.groups` | ✅ |
| History when you arrive | `conversations.history` (`channels:history`, `groups:history`) | ✅ Last 30, in memory only |
| Channels follow Slack | Events `channel_rename`, `channel_archive`, `channel_deleted` (and `group_*`) | ✅ |
| Move you between huddles as you walk | Not exposed (no API starts, joins or moves a huddle) | ❌ One-click "Switch to the huddle in #…" instead; joining in Slack walks your avatar over |
| Live speaking indicators | Not exposed | ❌ Opt-in talk light from your own mic level |
| Run inside Slack | No embedded-app surface like Discord Activities | ❌ Link previews and `/minglewood` fill that role |
| Online/idle presence | `users:read` + `presence_change` (RTM only) | ❌ Intentionally not used. Availability is something members choose to share. |

The same matrix is rendered live in **Admin → Slack**; **Admin → Spaces & channels** checks the scopes the workspace
actually granted and whether the app is in each linked channel.

## Try it without a workspace

```sh
SLACK_MOCK=true npm run dev             # no Slack app needed; nothing is sent to Slack
npm run slack:sim -- demo               # Maya = Slack user U1, Design Loft ↔ #design, Maya joins the huddle
```

Open http://localhost:5173 → **Walk in** (tick the admin box). Maya is sitting in the Design Loft and her Slack
status shows. Then try:

```sh
npm run slack:sim -- bind design C0DESIGN text          # #design is the Loft's conversation too
npm run slack:sim -- say U1 C0DESIGN "coffee anyone?"   # shows in the Loft; a bubble over Maya if she's there
npm run slack:sim -- history C0DESIGN                   # what the world posted there (as the speaker)
npm run slack:sim -- rename C0DESIGN design-crew        # the space's label follows
npm run slack:sim -- status U1 :spiral_calendar_pad: "In a meeting"
npm run slack:sim -- dnd U1 on
npm run slack:sim -- cmd U1 "where is maya"
npm run slack:sim -- leave U1
npm run slack:sim -- unfurl "http://localhost:5173/?room=design"
npm run slack:sim -- outbox             # every message, unfurl and DM Minglewood "sent"
```

In mock mode the admin console's Slack tab can **Connect** a pretend workspace (`T0MOCK`, channels `#design`,
`#cafe`, `#eng` the app isn't in yet, …), **Spaces & channels** runs the one-click setup against it, and the
readiness check reads pretend scopes (`POST /api/slack/dev/scopes` to take some away). `SLACK_MOCK` defaults the
signing secret to `mock-signing-secret` and the workspace to `T0MOCK`, and it is ignored in production. The
`/api/slack/dev/*` routes the simulator uses only exist in mock mode outside production.

## Setting up a real Slack app

**Slack only accepts HTTPS** redirect and request URLs. Use the deployed server (e.g. `https://minglewood.onrender.com`),
or a tunnel (`cloudflared tunnel --url http://localhost:5173`) for local work. Below, `HOST` means that origin with
no trailing slash. The admin console's Slack tab lists the exact URLs for your server, with Copy buttons.

### 1. Create the app from a manifest

https://api.slack.com/apps → **Create New App** → **From a manifest** → pick your workspace → paste the manifest
(replace `HOST`) → **Create**. For an existing app: **App Manifest** → paste → **Save changes**, then reinstall it
(OAuth & Permissions → *Reinstall*) so the new scopes are granted.

```yaml
display_information:
  name: Minglewood
  description: Your company, as a place.
  background_color: "#1f1d24"
features:
  bot_user:
    display_name: Minglewood
    always_online: true
  slash_commands:
    - command: /minglewood
      url: https://HOST/api/slack/commands
      description: Who's around, where someone is, join them, wave
      usage_hint: "who | where @someone | join @someone | wave @someone | knock @someone | room design"
      should_escape: true
  unfurl_domains:
    - HOST
oauth_config:
  redirect_urls:
    - https://HOST/api/slack/auth/callback
    - https://HOST/api/slack/install/callback
  scopes:
    user:
      - openid
      - profile
      - email
      - users.profile:write
    bot:
      - channels:read
      - groups:read
      - channels:history
      - groups:history
      - users:read
      - users:read.email
      - dnd:read
      - chat:write
      - chat:write.customize
      - channels:manage
      - channels:join
      - im:write
      - mpim:write
      - commands
      - links:read
      - links:write
      - team:read
settings:
  event_subscriptions:
    request_url: https://HOST/api/slack/events
    bot_events:
      - user_change
      - user_huddle_changed
      - dnd_updated_user
      - message.channels
      - message.groups
      - channel_rename
      - channel_archive
      - channel_deleted
      - channel_left
      - group_rename
      - group_archive
      - group_deleted
      - group_left
      - member_joined_channel
      - link_shared
      - app_uninstalled
      - tokens_revoked
  interactivity:
    is_enabled: true
    request_url: https://HOST/api/slack/interactions
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

Slack checks the Events request URL right away, so it will only verify once the server is running with
`SLACK_SIGNING_SECRET` set (step 2). If it fails at creation, finish step 2, then go to **Event Subscriptions** and
click **Retry**.

**Why each scope** (the server checks these against what the workspace granted, in Admin → Spaces & channels):

| Scope | Used for |
|---|---|
| `openid`, `profile`, `email` (user) | Sign in with Slack: who you are, your name, and your email (for matching an existing member). |
| `users.profile:write` (user) | "Sync my status to Slack": a person's own grant, so the world can set *their* Slack status. Their token is kept server-side with the world (never sent to clients). |
| `channels:read`, `groups:read` | Listing public and private channels to bind rooms to; following renames and archives. |
| `channels:history`, `groups:history` | A space's conversation and history from its channel, and the huddle message Slack posts in a channel (how we know which channel a huddle is in). |
| `users:read`, `users:read.email` | Names and pictures (so posts look like you), statuses, huddle state, admin flags, email matching. |
| `dnd:read` | Do Not Disturb → *Focused*. |
| `chat:write`, `chat:write.customize` | Posting what's said in a space to its channel, under the speaker's name and picture; the daily post; knock DMs. |
| `channels:manage` | The one-click "create a channel for every space". |
| `channels:join` | Joining the public channels spaces are linked to, so their messages and huddles reach the world. |
| `im:write` | Knock DMs; "ask to join" a huddle. |
| `mpim:write` | "Start a huddle with…": opens a group DM for the people at your table. |
| `commands` | `/minglewood`. |
| `links:read`, `links:write` | Previews for Minglewood links. |
| `team:read` | Workspace name when connecting. |

### 2. Give the server its secrets

Set these in `.env` locally, or in Render → the service → **Environment**. Never commit them.

| Variable | Where it comes from |
|---|---|
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Basic Information → App Credentials. |
| `SLACK_SIGNING_SECRET` | Basic Information → App Credentials → Signing Secret. It verifies every request Slack sends. |
| `SLACK_BOT_TOKEN` | Optional. OAuth & Permissions → **Install to Workspace** → *Bot User OAuth Token* (`xoxb-…`), for a single-workspace server. Not needed when workspaces are added with **Add to Slack** (their tokens are kept server-side, see below). |
| `SLACK_TEAM_ID` | Optional. Your workspace id (`T…`, the first id in `app.slack.com/client/T…/…`). Ties this server's single world to that workspace, so people can sign in before an admin connects anything, and lets **Add to Slack** on the landing page connect it. |
| `SLACK_ADMIN_USER_IDS` | Optional, comma-separated Slack user ids (`U…`) that become Minglewood admins. Workspace owners and admins, and whoever installs the app, already do. |
| `SLACK_REDIRECT_URI`, `SLACK_INSTALL_REDIRECT_URI`, `SLACK_STATUS_REDIRECT_URI` | Optional. They default to `PUBLIC_URL` + `/api/slack/auth/callback` and `/api/slack/install/callback`; the status grant lands on the install redirect too (no extra URL to register), unless you set its own. |

Restart. The startup line says `slack: configured`.

### 3. Connect and link

1. **Add to Slack.** From the landing page (*Running a team? Add Minglewood to your Slack workspace*): with Minglewood
   Cloud, a new workspace becomes its own company and the installer lands in it as admin; without it, the workspace in
   `SLACK_TEAM_ID` is connected. Or sign in as an admin and use **Admin → Slack → Add to Slack** to connect a workspace
   to the world you're in. (Single-workspace servers with `SLACK_BOT_TOKEN` can use **Connect using SLACK_BOT_TOKEN**.)
2. **Admin → Spaces & channels → Link, and create what's missing.** Each space gets a channel (matched by name, else
   created), bound as its conversation and its huddle, and the app joins every public channel it linked. Check that the
   scopes list is all ✅ and every linked channel says the app is in it; private channels need `/invite @Minglewood`.
3. Sign in with **Continue with Slack**, walk into the café, type something: it appears in `#cafe` under your name.
   Post in `#cafe` from Slack: it appears in the café, as a bubble over you if you're there. Start a huddle in `#cafe`:
   you (and anyone who joins) show up sitting in the café.
4. Optional: in the Slack tab, choose a channel and hour for the daily post.

### Where tokens live

- `SLACK_BOT_TOKEN` (env), like `DISCORD_BOT_TOKEN`.
- Tokens from **Add to Slack** are kept server-side: in `<DATA_DIR>/slack-tokens.json` (gitignored, file mode 600)
  *and* with the company's world state (`secrets` in the persisted org — on Minglewood Cloud, in Lovable Cloud Postgres
  behind RLS and the server key), so a redeploy on a host without a persistent disk (Render) keeps workspaces connected.
  They are never part of anything the client receives.

## What Slack does and doesn't let us do

- **Huddle → channel is inferred.** `user_huddle_changed` says someone is in a huddle, but not where. Slack also
  posts a huddle message in the channel (subtype `huddle_thread`, with a `room` listing participants) and updates it
  as people join and leave. We join the two by the huddle's call id. The huddle message is not a formally
  documented API, so verify it with a real workspace (steps under Testing). Huddles in DMs and group DMs have no
  channel, so they never place anyone in a room.
- **No moving between huddles, no speaking indicators, no auto-join**: Slack exposes none of these. **Switch to the
  huddle** / **Join the huddle** open the huddle and you click Join.
- **Posts from the world carry Slack's "APP" tag.** Only a user token could post *as* a person, and taking people's
  tokens is not something we do.
- **The app must be in the channel.** Public channels are joined for you; private ones need an `/invite`.
- **No embedded app** like Discord Activities. Link previews and `/minglewood` fill that role.
- **Status only applies while someone is around.** A Slack status never makes someone look present.
- **The daily post is tracked in memory.** A server restart during the chosen hour can post twice.
- **Actions from Slack need a linked account.** `wave` and `knock` from `/minglewood`, and knock DMs, need the person
  to have signed in with Slack once. `who`, `where`, `join` and `room` work for anyone in the workspace.

## Security

- Every request from Slack (events, commands, interactions) is checked with HMAC-SHA256 over the raw body using the
  signing secret, with a 5-minute replay window and a timing-safe compare (`src/server/slack/verify.ts`). Unsigned or
  stale requests get a 401.
- Sign-in and both installs use a `state` cookie (HttpOnly, SameSite=Lax). Sign-in also checks the OpenID `nonce`.
  The admin-console install requires a signed-in Minglewood admin; the landing-page install only ever creates a new
  company (Minglewood Cloud) or connects the one workspace the server was configured for (`SLACK_TEAM_ID`), never an
  existing company it isn't tied to. A workspace already connected to another world is refused.
- Bridged posts never link mentions (`link_names: false`), so nothing said in the world pings anyone in Slack.
- `/api/slack/dev/*` exists only with `SLACK_MOCK` outside production.

## Testing

- `node --no-maglev node_modules/vitest/vitest.mjs run src/server/slack --pool=threads` covers signatures, status
  mapping, the OAuth exchanges, the HTTP transport, message rendering, the bridge (posting as the speaker, the
  customize fallback, joining channels, mirroring with mentions and bubbles, echo suppression, history, renames and
  archives, the huddle walk-over), the one-click setup and readiness, and end-to-end signed requests into a running
  server: URL verification, huddles, statuses, `/minglewood`, link previews, knock DMs, chat both ways, renames, the
  admin setup, and Add to Slack. `src/server/cloud/tenants.test.ts` covers a Slack install creating a company.
- Checking against a real workspace: run the one-click setup, then start a huddle in a linked channel. You should
  appear in the room within a second or two. Post in the channel and watch it appear in the space; say something in
  the space and watch it appear in the channel under your name. If something doesn't, check the server log, and the
  Events page in the Slack app for `message.channels` deliveries.
