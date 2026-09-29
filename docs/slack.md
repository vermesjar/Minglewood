# Slack

Minglewood's Slack integration sits behind the same provider seam as Discord (`CommunicationProvider` plus the shared
voice-presence sync). The world engine doesn't know which one is connected. What it does:

| | |
|---|---|
| **Sign in with Slack** | OpenID Connect. A Slack user is always the same member (by Slack user id). On first sign-in they join the member who already has the same verified email on another linked account, or they become a new member. Workspace owners and admins (read with the bot token), the installer, and `SLACK_ADMIN_USER_IDS` become Minglewood admins. |
| **Add to Slack** | Admin console → Slack → *Add to Slack* (OAuth v2) connects a workspace to this world. |
| **Huddles → rooms** | Bind a room to a channel (admin console → Rooms & channels → provider *Slack*). Anyone in that channel's huddle shows up in the room, the way Discord voice does. |
| **Status → status** | Calendar “In a meeting” → *In a meeting*. Do Not Disturb, headphones and “focus” → *Focused*. Vacation, lunch, sick, commuting → *Away*. 👋 or “say hi” → *Open to chat*. Anything else shows as a note. Status only applies while someone is around (in the world or in a huddle). |
| **/minglewood** | `who` · `where @maya` · `join @maya` · `wave @maya` · `knock @maya` · `room design` · `help`. Replies are private (ephemeral). |
| **Link previews** | Room links (`/?room=design`) and person links (`/?to=<member>`) unfurl with who's there and a “Walk in” button. |
| **Daily “who's around”** | Optional. Admin console → Slack picks the channel and hour (org timezone). |
| **Join in Slack** | A room bound to a channel shows **Join in Slack**, which opens that channel's huddle (`app.slack.com/huddle/{team}/{channel}`). |
| **Knocks as DMs** | Opt-in per person (profile → *When I'm not here, send knocks to me as a Slack DM*). Only applies while they aren't in the world. |

Code: `src/server/slack/*`, with tests in `src/server/slack/slack.test.ts`. The admin UI is `src/client/admin/SlackTab.tsx`.

## Try it without a workspace

```sh
SLACK_MOCK=true npm run dev             # no Slack app needed; nothing is sent to Slack
npm run slack:sim -- demo               # Maya = Slack user U1, Design Loft ↔ #design, Maya joins the huddle
```

Open http://localhost:5173 → **Walk in** (tick the admin box). Maya is sitting in the Design Loft and her Slack
status shows. Then try:

```sh
npm run slack:sim -- status U1 :spiral_calendar_pad: "In a meeting"
npm run slack:sim -- dnd U1 on
npm run slack:sim -- cmd U1 "where is maya"
npm run slack:sim -- leave U1
npm run slack:sim -- unfurl "http://localhost:5173/?room=design"
npm run slack:sim -- outbox             # every message, unfurl and DM Minglewood "sent"
```

In mock mode the admin console's Slack tab can **Connect** a pretend workspace (`T0MOCK`, channels `#design`,
`#cafe`, …) and bind rooms to it. `SLACK_MOCK` defaults the signing secret to `mock-signing-secret` and the
workspace to `T0MOCK`, and it is ignored in production. The `/api/slack/dev/*` routes the simulator uses only exist
in mock mode outside production.

## Setting up a real Slack app

**Slack only accepts HTTPS** redirect and request URLs. Use the deployed server (e.g. `https://minglewood.onrender.com`),
or a tunnel (`cloudflared tunnel --url http://localhost:5173`) for local work. Below, `HOST` means that origin with
no trailing slash. The admin console's Slack tab lists the exact URLs for your server, with Copy buttons.

### 1. Create the app from a manifest

https://api.slack.com/apps → **Create New App** → **From a manifest** → pick your workspace → paste the manifest
(replace `HOST`) → **Create**.

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
    bot:
      - channels:read
      - groups:read
      - channels:history
      - groups:history
      - users:read
      - users:read.email
      - dnd:read
      - chat:write
      - im:write
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

**Why each scope:**

| Scope | Used for |
|---|---|
| `openid`, `profile`, `email` (user) | Sign in with Slack: who you are, your name, and your email (for matching an existing member). |
| `channels:read`, `groups:read` | Listing public and private channels to bind rooms to. |
| `channels:history`, `groups:history` | The huddle message Slack posts in a channel. It's how we know which channel a huddle is in. We read no other message content. |
| `users:read`, `users:read.email` | Profile changes (status, huddle state), admin flags, and email matching. |
| `dnd:read` | Do Not Disturb → *Focused*. |
| `chat:write`, `im:write` | The daily post and knock DMs. |
| `commands` | `/minglewood`. |
| `links:read`, `links:write` | Previews for Minglewood links. |
| `team:read` | Workspace name when connecting. |

### 2. Give the server its secrets

Set these in `.env` locally, or in Render → the service → **Environment**. Never commit them.

| Variable | Where it comes from |
|---|---|
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Basic Information → App Credentials. |
| `SLACK_SIGNING_SECRET` | Basic Information → App Credentials → Signing Secret. It verifies every request Slack sends. |
| `SLACK_BOT_TOKEN` | OAuth & Permissions → **Install to Workspace** → *Bot User OAuth Token* (`xoxb-…`). Recommended on Render, see below. |
| `SLACK_TEAM_ID` | Your workspace id (`T…`, the first id in `app.slack.com/client/T…/…`). It ties this server's world to that workspace, so people can sign in before an admin connects anything. |
| `SLACK_ADMIN_USER_IDS` | Optional, comma-separated Slack user ids (`U…`) that become Minglewood admins. Workspace owners and admins already do. |
| `SLACK_REDIRECT_URI`, `SLACK_INSTALL_REDIRECT_URI` | Optional. They default to `PUBLIC_URL` + `/api/slack/auth/callback` and `/api/slack/install/callback`. |

Restart. The startup line says `slack: configured`.

### 3. Connect and bind

1. The landing page now shows **Continue with Slack**. Sign in. This works for the workspace in `SLACK_TEAM_ID`, or
   for any workspace an admin has connected; anyone else sees “Minglewood isn't connected to that Slack workspace”.
2. Go to the admin console → **Slack**. Either use **Connect using SLACK_BOT_TOKEN** (single workspace), or
   **Add to Slack** (the OAuth install, which stores that workspace's token on the server).
3. In **Rooms & channels**, set a room's provider to *Slack* and pick its channel.
4. **Invite the app to each bound channel** (`/invite @Minglewood` in the channel). Slack only sends a channel's
   huddle messages to apps that are in the channel.
5. Optional: in the Slack tab, choose a channel and hour for the daily post (invite the app there too).

### Where tokens live

- `SLACK_BOT_TOKEN` (env), like `DISCORD_BOT_TOKEN`.
- Tokens from **Add to Slack** are written to `<DATA_DIR>/slack-tokens.json` (gitignored, file mode 600). They are
  never put in the org data the client sees. Render's disk is not persistent, so on Render use the env token (or add
  a persistent disk) until workspace tokens move into Minglewood Cloud.

## What Slack does and doesn't let us do

- **Huddle → channel is inferred.** `user_huddle_changed` says someone is in a huddle, but not where. Slack also
  posts a huddle message in the channel (subtype `huddle_thread`, with a `room` listing participants) and updates it
  as people join and leave. We join the two by the huddle's call id. The huddle message is not a formally
  documented API, so verify it with a real workspace (steps under Testing). Huddles in DMs and group DMs have no
  channel, so they never place anyone in a room.
- **No speaking indicators** and **no auto-join**: Slack exposes neither. **Join in Slack** opens the huddle and you
  click Join.
- **No embedded app** like Discord Activities. Link previews and `/minglewood` fill that role.
- **Status only applies while someone is around.** A Slack status never makes someone look present.
- **The daily post is tracked in memory.** A server restart during the chosen hour can post twice.
- **Actions from Slack need a linked account.** `wave` and `knock` from `/minglewood`, and knock DMs, need the person
  to have signed in with Slack once. `who`, `where`, `join` and `room` work for anyone in the workspace.

## Security

- Every request from Slack (events, commands, interactions) is checked with HMAC-SHA256 over the raw body using the
  signing secret, with a 5-minute replay window and a timing-safe compare (`src/server/slack/verify.ts`). Unsigned or
  stale requests get a 401.
- Sign-in and install both use a `state` cookie (HttpOnly, SameSite=Lax). Sign-in also checks the OpenID `nonce`.
  The install requires a signed-in Minglewood admin, and a workspace already connected to another world is refused.
- `/api/slack/dev/*` exists only with `SLACK_MOCK` outside production.

## Testing

- `npx vitest run src/server/slack` covers signatures (valid, tampered, stale, missing), status mapping, the OAuth v2
  install and OpenID sign-in exchanges (including a bad nonce), the HTTP transport (form vs JSON, bearer, 429 retry),
  and end-to-end signed requests into a running server: URL verification, huddles in and out, statuses and DND,
  `/minglewood`, link previews, and knock DMs.
- Checking against a real workspace: bind a room to a channel, invite the app, start a huddle there. You should appear
  in the room within a second or two. If you don't, check the server log. Also check that the Events page in the
  Slack app shows `message.channels` deliveries when the huddle starts.
