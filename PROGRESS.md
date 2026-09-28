# Progress

## Current milestone
**M8 — Polish** (M1–M7 complete as a first vertical slice).

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
  calendar presence, sessions (36 passing). Typecheck + ESLint clean. Production build verified.

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
- Procedural placeholder art; no sprite sheets yet. Emoji rendering depends on the OS font.
- Mobile works (pointer events, responsive panels) but is not yet designed for.

## Next actions
1. Visual QA pass across every interior; tune furniture and depth edge cases.
2. Refresh bootstrap on returning from admin; live binding updates.
3. Unlockable decor tied to team milestones; members suggesting artifacts for admin approval.
4. PostgresPersistence + Redis fan-out for multi-instance hubs.
5. Real calendar provider (Google) behind `CalendarProvider`.
6. Playwright smoke tests for the core loop (enter → knock → jump → party).
