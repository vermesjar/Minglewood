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
6. Slack integration (preferred over Discord going forward); company design packages / themes.

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
