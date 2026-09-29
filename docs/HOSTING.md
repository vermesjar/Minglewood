# Hosting Minglewood for many companies

Minglewood runs as two pieces:

```
                 ┌──────────────────────────────── Minglewood Cloud (Lovable) ───────────────┐
 Company admin → │ Landing page · "Add to Discord" · install callback · /welcome · /setup     │
 Discord ──────→ │ /api/public/discord-interactions  (slash commands, signature-verified)     │
                 │ /api/public/tenants · /api/public/org-state  (server-key protected)        │
                 │ Lovable Cloud Postgres: organizations · org_state · install_events (RLS)   │
                 └───────────────────────────────▲───────────────────────────────────────────┘
                                                 │ tenants + world state (x-minglewood-key)
                 ┌───────────────────────────────┴──── Game server (this repo, Docker) ───────┐
 Employees ────→ │ The world (web + Discord Activity) · WebSocket realtime · Discord sign-in │
 Discord ──────→ │ Gateway (voice presence for every installed server)                        │
                 └────────────────────────────────────────────────────────────────────────────┘
```

- **Minglewood Cloud** is the control plane, built in Lovable. It owns *installs* (which Discord
  servers added Minglewood), slash commands, and durable per-company world state in Lovable Cloud
  Postgres. Lovable project: “Minglewood Cloud”.
- **The game server** (this repo) renders every company's world, runs realtime presence over
  WebSockets and keeps a Discord gateway connection for voice presence. It needs a host that allows
  long-lived processes (Render, Fly.io, Railway, a VM). `render.yaml` + `Dockerfile` are included.

Why split: Lovable hosts web apps and short-lived server routes beautifully, but a realtime world
needs persistent WebSocket connections and a gateway bot — so those stay on the game server.

## What happens when a company adds Minglewood

1. An admin clicks **Add to Discord** on Minglewood Cloud → Discord's bot-install screen (only
   *View Channels* permission + slash commands).
2. Discord redirects back to `/api/public/discord-install-callback`; Minglewood Cloud creates the
   company (`organizations` row) and shows `/welcome` with **Open your world**.
3. Within a minute (or instantly on first sign-in) the game server sees the new tenant and creates
   its world: the same lakeside town, rooms named after the company, a **housewarming party** in
   the Event Hall, and the first artifact on the HQ memory wall — *We moved into Minglewood*.
4. Employees type **/minglewood** in Discord (or open the link) → **Enter your company town** →
   Discord sign-in. The server checks which of their Discord servers has Minglewood installed and
   drops them into that world. **Server owners and people with Manage Server become Minglewood
   admins automatically**, as does whoever installed it.
5. An admin opens **Admin → Rooms & channels** and binds the Café to their hangout voice channel,
   the Project Room to a project channel, etc. From then on, anyone sitting in a bound Discord
   voice channel appears in that room.
6. **/minglewood-activity** in a voice channel opens Minglewood inside Discord as an Activity; if
   that voice channel is bound to a room, you arrive in that room.

## Go-live checklist

Only the operator can do these steps (they involve creating accounts and handling secrets).

### 1. Create the Discord application
<https://discord.com/developers/applications> → **New Application** (“Minglewood”).
- **OAuth2**: copy *Client ID* and *Client Secret*. Add two redirects:
  - `https://<cloud-site>/api/public/discord-install-callback` (installs)
  - `https://<game-server>/api/auth/discord/callback` (employee sign-in)
- **Bot**: *Reset Token* → copy it. No privileged intents are needed.
- **General Information**: copy the *Public Key*. Set **Interactions Endpoint URL** to
  `https://<cloud-site>/api/public/discord-interactions` (Discord pings it to verify — the endpoint
  must be deployed with the public key configured first).
- **Activities** (optional, for in-Discord mode): enable Activities, and under **URL Mappings**
  map `/` → `<game-server host>`.

### 2. Configure Minglewood Cloud (Lovable → project → Settings → Secrets)
`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`,
`MINGLEWOOD_SERVER_KEY` (a long random string — generate with
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`),
`GAME_SERVER_URL`, `SITE_URL`. Publish the project, open `/setup` to confirm every secret shows
as configured, then click **Register slash commands**.

### 3. Deploy the game server (Render)
Push this repo to GitHub → Render → **New → Blueprint** → pick the repo (uses `render.yaml`).
Fill in: `PUBLIC_URL`, `DISCORD_REDIRECT_URI`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`,
`DISCORD_BOT_TOKEN`, `CONTROL_PLANE_URL` (= `https://<cloud-site>/api/public`),
`MINGLEWOOD_SERVER_KEY` (same value as in the cloud), `INSTALL_URL` (= `https://<cloud-site>`).
On boot the log says `cloud: connected`.

### 4. Try it
Add Minglewood to a test server from the cloud landing page → **Open your world** → sign in with
Discord → you're the admin of a brand-new world with a housewarming party going on.

## Security model

- Discord installs are bound to an HttpOnly `state` cookie; interactions are Ed25519-verified.
- Minglewood Cloud tables have RLS on with no public policies; only server-side code with the
  service role reads/writes. The game server authenticates with `x-minglewood-key`.
- Sign-in scopes: `identify guilds guilds.members.read`; the user's access token is used to find
  their servers and nickname, then discarded (Activity mode hands it back to the SDK, as required).
- Each company is its own org (`t-<tenant uuid>`); sessions are org-scoped and signed.
- Presence is never persisted — `org_state` holds the world (rooms, bindings, members' profiles and
  avatars, artifacts, decorations), not activity.

## Slack and Microsoft Teams next

The same pattern extends: a **Slack app install** (OAuth v2 with `team.id`) creates the
organization in Minglewood Cloud; sign-in uses *Sign in with Slack* (OpenID) and routes by team id;
huddles/channels bind to rooms through a `SlackProvider` implementing `CommunicationProvider`.
Nothing in the world engine changes — tenants just gain a `slack_team_id` beside
`discord_guild_id`.
