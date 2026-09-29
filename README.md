# 🌲 Minglewood

**Your company, as a place.**

Minglewood is a spatial social layer for remote companies. Instead of a list of channels, your
organization becomes a warm, isometric pixel-art town that your coworkers actually inhabit: you can
see who's in the café, who's heads-down in the Quiet Grove, which team is gathered in the Launch
Lab, and when there's a birthday party in Lantern Hall. Conversations still happen in Discord —
Minglewood is the *place* around them.

> Presence without surveillance. No activity tracking, no productivity scores, no attendance
> reports. Ever. See [PRODUCT.md](PRODUCT.md).

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:5173>, type a name, and walk in. No accounts, databases, or Discord
credentials are needed — you arrive on your first day at **Northstar Labs**, a fictional
~35-person company whose simulated coworkers are already sitting in the café, pairing in the
Engineering Studio, and throwing Jonah a birthday party.

**Try multiplayer:** open a second browser (or a private window) and sign in as someone else —
you'll see each other move, wave and chat in realtime.

Requirements: Node 20+ (tested on Node 21). Port 5173 (web) and 8787 (API/realtime).

## Things to try in the first two minutes

1. **Watch your onboarding buddy.** Rosa walks over and welcomes you by name.
2. **Double-click Tidewater Café.** Step inside; the regulars say hi. Click someone to see who they are.
3. **Knock** on someone who's open to chat, or invite them for ☕ — they answer (and walk over).
4. **Ctrl+K → "Maya"** jumps you right next to her. No walking simulator.
5. **Stop by Lantern Hall** for the party; claim a party hat for your wardrobe.
6. **Click the Founders' Oak, the rocket by the Launch Lab, or the frames in HQ** — organizational memory.
7. Set yourself to **Focused** and notice knocks get held until you're free.
8. **Open your wardrobe** (avatar menu): 23 hairstyles, faces, hats (incl. hijab and turban), eyewear, patterned tops, a pet that follows you, something to hold, wheelchair and cane options, one-tap vibes, "Surprise me", and saved looks you can switch to from the menu.
9. **Decorate your team's room** — in a room your team owns, click *Decorate our space* (demo admins can decorate anywhere).
10. **Play with the world.** Toss a coin in the fountain, beat the arcade high score, change the
   jukebox track, stoke the fireplace, order a coffee (you'll carry it around), water the plants,
   flick a street lamp. Everyone in the scene sees the same result. Pet Biscuit, the town cat.
11. **High-five someone** (click them → 🙌): you walk over and hold up your hand; when they
   high-five back it lands for everyone. Throw a ✈️ paper plane, or 💃 dance (two dancers start a disco).
12. **Come back at dusk.** The town follows your clock: golden hour, lit windows, street lamps,
   fireflies and the lighthouse beam at night; seasonal weather (autumn leaves today). Preview with
   `?hour=21` or `?weather=rain|snow|leaves|petals`.
13. **Admin console** (avatar menu → Admin): room ↔ channel bindings, the Discord capability audit, and
   *Company memory* — commemorate a launch and watch it appear on the Launch Lab wall for everyone.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | API + realtime server (tsx watch, :8787) and Vite client (:5173, proxies `/api` and `/ws`) |
| `npm run build` | Production client build to `dist/client` |
| `npm start` | Production server; serves the built client and the API on one port |
| `npm test` | Vitest: world integrity, pathfinding, hub authority & privacy, serendipity, sessions |
| `npm run typecheck` / `npm run lint` | TypeScript strict / ESLint |
| `npm run check` | All of the above |
| `npm run reset-data` | Delete local persisted data (guest accounts, bindings, audit) |

## Hosting for many companies

Minglewood Cloud (built in Lovable) handles **Add to Discord**, installs, slash commands and per-company
world state; this repo is the realtime game server (Docker/Render). Every Discord server that adds
Minglewood gets its own world. See [docs/HOSTING.md](docs/HOSTING.md) for the architecture and the
go-live checklist.

## Discord

Minglewood runs fully in demo mode. To connect a real Discord server (OAuth sign-in, membership
verification, channel bindings, voice presence, and running as a Discord Activity), follow
[docs/DISCORD.md](docs/DISCORD.md) — it also documents exactly what Discord does and doesn't allow.

## Repository map

```
src/
  shared/      Pure TypeScript used by both sides: domain model, scene format, pathfinding,
               protocol (zod), presence semantics, serendipity rules, calendar abstraction,
               avatar catalog, seed org, world definitions (town + interiors)
  server/      Express + ws: auth (sessions, demo, Discord OAuth/Activity), OrgHub realtime,
               LifeSim (demo coworkers), providers (Discord, demo), store (repository + JSON file)
  client/      React UI + a custom Canvas2D isometric engine with procedurally generated pixel art
docs/          DISCORD.md
db/schema.sql  Target PostgreSQL schema
```

Read [ARCHITECTURE.md](ARCHITECTURE.md) for decisions and trade-offs, [PRODUCT.md](PRODUCT.md) for
the thesis and principles, and [PROGRESS.md](PROGRESS.md) for status and next steps.

Branding is centralized in `src/shared/brand.ts` — "Minglewood" is a working name.
