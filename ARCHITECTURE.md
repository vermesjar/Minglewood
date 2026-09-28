# Architecture

## Shape of the system

```
 Browser / Discord Activity iframe
 ┌───────────────────────────────────────────────┐
 │ React UI (panels, cards, admin)                │
 │   ▲ store (useSyncExternalStore)               │
 │ Game controller ── WorldView (Canvas2D iso)    │
 │   │ REST (/api)          │ WebSocket (/ws)      │
 └───┼──────────────────────┼─────────────────────┘
     ▼                      ▼
 ┌───────────────────────────────────────────────┐
 │ Express routes: auth · api · admin             │
 │ OrgHub (per org): actors, scenes, presence,    │
 │   knocks, directory  ◄── LifeSim (demo only)   │
 │                      ◄── VoicePresenceSync     │
 │ Store (repository) ── Persistence (JSON | PG)  │
 │ CommunicationProvider: DiscordProvider · Demo  │
 └───────────────────────────────────────────────┘
```

Everything in `src/shared` is pure TypeScript with no I/O, imported by both client and server:
the scene format, pathfinding (so server and client compute identical paths/positions), the wire
protocol, presence semantics, serendipity rules and the seed organization.

## Key decisions

### Renderer: custom Canvas2D isometric engine (not Phaser/PixiJS)
Evaluated Phaser and PixiJS. Chose a small purpose-built Canvas2D engine because:
- **All art is procedural** for now: sprites are painted once into offscreen canvases
  (`engine/sprites/*`), crispened into pixel art (hard alpha + ink outline) and cached. The draw
  loop is just `drawImage` of cached sprites — well within Canvas2D's budget for our scale
  (hundreds of objects, dozens of avatars per scene).
- **Isometric depth ordering** is the hard part and neither library solves it for multi-tile
  footprints. `engine/depth.ts` topologically sorts static footprints once per scene and inserts
  moving actors after the last overlapping static behind them; an "x-ray" pass draws faint
  silhouettes of people hidden behind buildings.
- Crisp pixel art at any zoom (`imageSmoothingEnabled=false`, per-pixel terrain rasterization).
- No WebGL context requirements inside the Discord iframe; zero engine dependencies.
- The seam for a future move to WebGL or real art is `sprites/registry.ts` (sprite key → Sprite)
  and `WorldView` (the only renderer). Scene data and game logic don't know how things are drawn.

### Realtime: authoritative Node hub over WebSockets, scene-scoped
- One `OrgHub` per organization (tenancy boundary). A socket subscribes to exactly one scene and
  receives fine-grained events (joins, paths, emotes, bubbles) only for that scene.
- Org-wide awareness is a **coarse, throttled (1 Hz), per-viewer-filtered directory**: status and
  which room — never positions — and room is omitted unless the member's visibility setting
  allows that viewer to see it.
- Movement is **path-based**, not per-frame: the client proposes a path, the server validates it
  (contiguous, walkable, starts near the actor's current interpolated position), stamps a start
  time and broadcasts it. Every client interpolates with the same pure `positionAlong`. This is
  tiny on the wire and naturally smooth.
- All client messages pass zod validation and token-bucket rate limits before reaching the hub.
- Scaling path: shard hubs by org; for very large orgs, shard scenes and fan out the directory
  via Redis pub/sub. Workplace concurrency (dozens per scene, hundreds per org) doesn't need an
  MMO backend.

### Persistence: repository + pluggable persistence
`Store` is the only data API and is org-scoped on every call. Dev uses `JsonFilePersistence`
(zero setup, atomic writes). `db/schema.sql` is the Postgres target; a `PostgresPersistence` (or
a query-level repository) can replace it without touching routes or the hub. Seeded demo
coworkers and demo events are regenerated at boot so the demo always feels current.

Deliberately **not persisted**: presence, positions, session history. Presence is live state.

### Communication providers
`CommunicationProvider` (+ capability flags) isolates Discord. The world only knows
`RoomBinding { roomId, provider, externalChannelId }` and `ExternalIdentity`. Voice presence from
the Discord gateway is translated by `VoicePresenceSync` into ordinary actors (`via: 'provider'`).
See [docs/DISCORD.md](docs/DISCORD.md) for the verified capability matrix.

### Scenes as lived in
`livedScene(base, artifacts, decorations)` composes the authored scene with what the company has
added since: memory-wall artifacts (`shared/world/memory.ts`, fixed wall slots per room) and team
decorations (`shared/world/decor.ts`). The same composition feeds the server's walk grids and the
client's renderer, and `placementProblem` (shared) guarantees decorations never block the door or
a seat — validated on the server, previewed on the client.

### Calendar-derived presence
`shared/calendar.ts` defines `CalendarProvider` and `presenceFromCalendar`. The demo uses a
deterministic mock; Google/Outlook providers implement the same interface. Only busy blocks are
needed; titles are shown only if shared.

### World model
`Organization → World → District → Room (building + interior scene) → SceneObject`.
Scenes are plain JSON (`SceneDef`): a terrain grid plus objects with sprite keys, footprints and
**actions** (`enter`, `exit`, `sit`, `artifact`, `info`, `activity`, `link`). The town is authored
as code-that-emits-data (`northstarTown.ts`) so it can later be loaded from the DB and edited by
a visual world builder. Objects can carry `eventDecor` (appear only during events) and
`artifactId` (organizational memory with provenance).

### Auth & security
- HMAC-signed session tokens (HttpOnly cookie in the browser; bearer inside the Discord iframe).
- Every REST handler resolves the member through the session → org; admin routes check role.
- Discord OAuth with `state` cookie; minimal scopes; membership verified per sign-in.
- Configuration changes are audit-logged. Member activity is never logged.
- No secrets in git (`.env.example`); dev secret generated into gitignored `.data/`.

## Client structure

- `app/game.ts` — controller: socket ↔ world ↔ UI; what interactions *mean* (walk-then-sit,
  walk-to-door-then-enter, knock, jump-to-person, quests).
- `app/store.ts` — tiny external store; local-only memory (quests, greeted, dismissed) never leaves
  the browser.
- `engine/` — `WorldView` (loop, input, overlays), `ground.ts` (per-pixel terrain, walls),
  `depth.ts`, `effects.ts` (particles, ducks, clouds, lighthouse), `sprites/*`.
- `ui/` — top bar, sidebar (events, suggestions, places, quests), room panel (conversation
  binding, people, history), profile/object cards, search palette, people directory, wardrobe,
  profile & privacy, onboarding + tour. `admin/` — the admin console.

## Accessibility

The world is primary, never mandatory: every core action has a non-spatial equivalent (places
list, people directory, search, room panel people list, keyboard shortcuts, arrow-key movement).
Live region announcements, high-contrast mode, reduced motion (also respects the OS setting),
always-show-names option, scalable UI.

## Known trade-offs

- JSON persistence is single-process; move to Postgres before running more than one instance.
- Procedural art is a placeholder with a clean replacement seam.
- The hub computes per-viewer directories naively (O(members × viewers)); fine at hundreds,
  cache per visibility class before thousands.
