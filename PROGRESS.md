# Progress

## Current milestone
**M8 — Polish** (M1–M7 complete; vertical slice plus live organizational memory and team-owned spaces).

## Completed
- **M1 Foundation** — TypeScript app (Vite/React client, Express/ws server, shared domain),
  design system, domain model + target Postgres schema, repository/persistence, signed sessions,
  demo auth, seed org (Northstar Labs, ~35 people, 6 departments, 9 teams).
- **M2 Living world** — Canvas2D isometric engine with procedural pixel art (terrain rasterizer,
  buildings from data specs, trees, props), depth sorting, camera pan/zoom, click-to-walk with
  A*, avatars (composable layers, walk/sit/wave poses), presence dots, building occupancy pills
  with faces, profile cards, ambient life (ducks, fountain, smoke, clouds, lighthouse).
- **M3 Interiors** — 8 interiors (HQ lobby, café, engineering, launch lab, Lantern Hall, Quiet
  Grove, arcade, design loft), iris transitions, seats, wall items, room panel, emotes, bubbles.
- **M4 Multiplayer** — authoritative OrgHub, scene-scoped subscriptions, path-based movement,
  presence sync, throttled per-viewer directory, reconnection, live profile broadcast.
- **M5 Social layer** — search/teleport (people, places, teams, projects, events), status + notes,
  knock/coffee with held knocks for focused people, serendipity with "Why?", event state and
  world decor, quests, onboarding buddy, guided tour, people directory.
- **M6 Admin** — org settings, rooms & bindings, teams, events, audit log, capability matrix.
- **M7 Discord** — OAuth (identify, guilds.members.read) with guild membership check, bot channel
  listing, voice-state gateway → room presence, deep-link join, Embedded App SDK Activity mode
  (authorize/authenticate via server exchange, proxy-aware transport, launch-channel → room).
- **Organizational memory, live**: admins commemorate moments onto room memory walls; broadcast
  to everyone with a "Go see it" note.
- **Team-owned spaces**: decorate mode with ghost preview, shared placement validation (doors and
  seats stay reachable), live updates, audit-logged.
- Robustness: arrival/transition logic independent of frame rendering (background tabs), startup
  retries during server restarts, UI-aware camera framing, x-ray silhouettes, quiet-room status
  restore, API rate limiting, live profile broadcast for new coworkers.
- Tests: world integrity, pathfinding, memory walls, decoration placement, hub authority/privacy/
  knocks/rewards/quiet rooms, Discord provider + voice presence (mocked HTTP), serendipity,
  calendar presence, sessions, and an end-to-end two-user HTTP+WebSocket test (38 passing). Typecheck + ESLint clean. Production build verified.

- **World polish (branch `world-polish`, in progress)** — toward an "AAA Habbo-equivalent" look:
  - *Movement*: held-key steering with continuous paths (server-validated), pixel-perfect zoom steps.
  - *Art pipeline*: gpt-image (masked edits on construction guides) → pixelize → anchors/footprints
    → manifest (`art/studio.py`, `art/ART_DIRECTION.md`); every furniture piece in 4 rotations;
    `npm run furniture:review` lints footprint centring, stray pixels, rotations, seat heights.
  - *Characters*: one template (frame) + add-on parts conformed to a standard, two body bases with a
    mesh warp, generated hair/hats/tops/pets, gated in every facing and pose over the roster, saved
    members and hundreds of random looks plus a pairwise sweep (`docs/characters.md`).
  - *Interiors*: all eight rooms rebuilt with generated art and composed into zones; per-object
    animations (espresso steam, koi, fireplace, clock, arcade screens…); seats per cushion with
    correct depth at every angle; furniture blocks walking; NPC staff (Juno the barista brews and
    hands over coffee; receptionist, arcade attendant, librarian).
  - *Seating* (2026-09-29): one system — each seat kind's 3D model (`art/seat-models.json`) gives its layers
    (near arm over you; from behind, the back) and your legs (thighs toward the camera to the front edge, shins to
    the floor), with per-drawing overrides where the art needs them; `scripts/seat-layers.ts --check` in the gate,
    `scripts/seat-shots.ts` to review every seat × facing (docs/furniture.md, "Seats").
  - *Town*: 76×76 valley — generated exteriors on exact footprints, props with finished art, organic
    lake shore, plaza, park; one world clock for day/night on every client.

## Important decisions
- Custom Canvas2D renderer over Phaser/PixiJS (see ARCHITECTURE.md).
- JSON-file persistence behind a repository for zero-setup dev; Postgres schema is the target.
- Presence is never persisted; audit log covers configuration only.
- Discord: no privileged intents; speaking indicators and auto-join are not possible and are
  documented rather than hacked around.
- API server on `API_PORT` (8787) in dev because tooling commonly injects `PORT`.

## Known limitations
- Discord flows are implemented against the documented API but not exercised against a live
  server in this environment (no credentials here). Demo provider covers the UX.
- Single-process realtime + JSON store (no horizontal scaling yet).
- Emoji rendering depends on the OS font.
- Mobile works (pointer events, responsive panels) but is not yet designed for.

## Next actions
1. Try the Discord flows against a real server (credentials needed) and tune copy/edge cases.
2. Unlockable decor tied to team milestones; members propose artifacts for admin approval.
3. `PostgresPersistence` + Redis fan-out for multi-instance hubs; per-visibility directory caching.
4. Real calendar provider (Google) behind `CalendarProvider`.
5. Browser-level smoke tests (Playwright) for enter → knock → jump → party.
6. Slack: finish the Minglewood Cloud side of Add to Slack (docs/HOSTING.md → Slack), then verify the bridge on a real workspace; company design packages / themes.

## Multi-tenant hosting (Discord) — Minglewood Cloud
- Control plane built in Lovable ("Minglewood Cloud"), live at https://minglewood-cloud.lovable.app:
  Add-to-Discord install flow, Ed25519-verified `/minglewood` + `/minglewood-activity` commands,
  tenants + per-org world state in Lovable Cloud Postgres (RLS, server-key API), `/setup` operator page.
- Game server: tenants synced from the cloud, each installed Discord server gets its own world
  (housewarming party + first memory-wall artifact), Discord sign-in routes by guild, managers become admins,
  world state persisted to the cloud. Dockerfile + render.yaml for deploy. Contract test mirrors the cloud API.
- Remaining (operator-only, needs secrets): Discord app, Lovable secrets + republish, Render deploy,
  register commands. See docs/HOSTING.md.
- 2026-09-29: LIVE end-to-end. Discord app configured, Minglewood Cloud secrets set, game server on
  https://minglewood.onrender.com. First install ("Minglewood Test") created its world within a minute; the
  installer signed in via Discord and landed as admin. Bot intentionally has only View Channels.

## Slack integration V1 (tag `slack-v1`, 2026-10-02)
Everything below this heading up to the end of the day's entries is V1: sign-in, Add to Slack, chat both ways, history,
one-click channel setup, huddles → rooms, silent-disco badges, huddle actions, status both ways, link previews,
/minglewood, knock DMs. Live on the Minglewood test workspace. Known limits are Slack's (no API to start/join/move
huddles, no audio) and are documented in docs/slack.md.

## Slack — spaces are their channels (2026-10-02)
- Slack now matches the Discord bridge: what's said in a space is posted to its channel under the speaker's Slack name and
  picture (`chat:write.customize`, with a bot fallback); channel messages show in the space and as a bubble over the
  author; history loads on arrival; renames/archives/deletions are followed; joining a huddle in Slack walks your avatar
  into that space (voice follows me). Slack can't move people between huddles, so the chat panel offers a one-click
  "Switch to the huddle in #…" instead — documented, not hacked around.
- One-click setup (Admin → Spaces & channels): a channel per space, #general for the town, matched by name or created,
  bound as text + huddle, and the app joins every public channel it links (Slack only sends events for channels the app
  is in; private ones need /invite). A readiness check shows granted scopes vs. needed and channel membership.
- Add to Slack from the landing page: a new company on Minglewood Cloud (game-server side done; the Lovable endpoints are
  specified in docs/HOSTING.md) or the server's SLACK_TEAM_ID workspace; the installer lands as admin. Workspace tokens
  are kept with the company's world state (`secrets`) so a Render redeploy keeps workspaces connected.
- Code: `src/server/slack/{bridge,setup,render,scopes}.ts`, `providers/spaces.ts` (shared name matching); 36 Slack tests
  + a cloud install test. Manifest and scope list: docs/slack.md.
- Live on the "Minglewood" test workspace (app A0C68T250BB) the same day. Fixes from the live run: Slack read methods
  take form-encoded calls only (JSON → invalid_arguments); the huddle link only works while a huddle runs (now used
  as `liveWebUrl` when someone's on it, else the channel); newer workspaces have #all-<workspace> (is_general).
- Silent disco (2026-10-02): every huddle carries its call id (DM huddles included), a badge by each name says who's
  hearing what (gold = room's huddle, a color per other call — headphones with someone here, a phone with someone
  elsewhere — grey = none), "start a huddle with…" opens the DM / group DM in Slack (`mpim:write`), "ask to join"
  nudges everyone on a call we can't link into. Slack can't start, join or move huddles for anyone — documented, not
  hacked around; Minglewood-hosted voice surfaced in Slack as a call block is the path to a true one-click world
  (decision pending).
- Status both ways (2026-10-02): Slack → world as before; world → Slack after a one-time per-person grant (Profile →
  Sync my status to Slack, user scope `users.profile:write`, token kept server-side): the status + note you set here
  become your Slack status (👋 🎧 📅 🚶 + text + expiry), Available clears it, the echo is recognised so neither side
  fights the other. Only self-set statuses are mirrored.
