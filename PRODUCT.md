# Product

## Thesis

Remote work solved flexibility but quietly removed the systems that made companies feel alive:
ambient awareness, accidental encounters, informal mentoring, celebrations, team identity, a sense
of *somewhere*. Chat and video tools tell you how to communicate once you already know who, why
and where. They don't create the environment in which relationships form.

**A remote company should feel like a place populated by people, not a collection of channels.**

Minglewood turns an organization's existing communication infrastructure (Discord first) into a
world employees inhabit together. Discord carries the conversation; Minglewood is the place,
the presence, the discovery, the identity and — over years — the history.

## Principles (used to settle ambiguous decisions)

1. **Humanity over productivity theater.** Strengthen relationships; never measure people.
2. **Presence without surveillance.** Current state only, user-controlled, never recorded.
3. **Serendipity without interruption.** Knock before you interrupt; focus is respected.
4. **Place over lists** — when place aids understanding. Lists remain for speed and access.
5. **Delight without friction.** Jump to anyone; double-click to enter. Not a walking simulator.
6. **Identity without hierarchy.** Avatars express personality and belonging, not rank.
7. **History creates belonging.** Launches, awards, offsites become artifacts in the world.
8. **Integrate before replacing.** Use Discord's voice/video; don't rebuild it.
9. **Desktop first, architecture responsive.**

## What exists in this prototype

- A lakeside company town (HQ, café, engineering studio, design loft, launch lab, event hall,
  quiet grove, arcade) with eight distinct interiors, ~35 simulated coworkers with personalities,
  schedules, chatter, and a mock calendar.
- Presence states (open to chat, available, focused, in a meeting, away) with notes; quiet rooms
  auto-focus; per-member location visibility (everyone / team / nobody).
- **Knock** (chat) and **coffee invite** with Join / In a few minutes / Not now; knocks to focused
  people are held until they're free.
- Waves and emotes, ephemeral speech bubbles (disabled in quiet rooms).
- Onboarding: welcome, avatar, guided town tour, a buddy who walks over to greet you, optional
  first-week quests (no deadlines, no scores).
- Serendipity suggestions that are deterministic, explainable ("Why?"), and dismissible.
- Events that transform the world (bunting, balloons, banners, confetti) and grant keepsakes.
- Organizational memory: artifacts with provenance (Founders' Oak, the 1,000th-customer bench,
  Aurora rocket, Lisbon offsite photo, trophy case, time capsule…) — and admins can
  **commemorate new moments**, which appear on a room's memory wall for everyone, live, with a
  town-wide note. Worlds visibly accumulate history.
- **Team-owned spaces**: members of the team that owns a room can decorate it (plants, lamps,
  beanbags, armchairs, an arcade cabinet…). Placement is validated so doors and seats are never
  blocked, and everyone sees changes live.
- Search/teleport to people, places, teams, projects and events; accessible people directory.
- Admin: org settings, room ↔ channel bindings, Discord connection, events, audit log.
- A deep, inclusive wardrobe: faces, 23 hairstyles with two-tone tips, headwear including hijab and
  turban, eyewear, patterned outfits, held items, pet buddies, wheelchair and cane, any color, one-tap
  vibes and saved looks for the "vibe of the day". Special items are earned, never sold.
- Realtime multiplayer; Discord OAuth, membership verification, voice presence, Activity mode.

## Things we will not build

Productivity scores, time-at-desk, keystroke/activity monitoring, manager attendance dashboards,
rankings of "most active", engagement scores derived from individuals, streak mechanics, paid
cosmetics. The data model has no place to put them: presence is never persisted, and the audit
log records configuration changes only.

## Metrics that matter (future, aggregate-only)

Time from joining → first meaningful coworker interaction; cross-team interactions; spontaneous
conversations started spatially; event participation; recurring use of team/social spaces. North
star: *meaningful human connections created per employee per week* — measured in aggregate, with
privacy-preserving methods, never per person.

## Next horizons

- Team-owned, decoratable spaces; unlockable furniture and trophies; the visual world builder.
- Artifact authoring flow ("our launch adds a rocket") and an anniversary timeline.
- Real calendar providers; Slack/Teams providers behind the same interface.
- AI as a *guide*, not the product: "Where does billing hang out?", intelligent introductions,
  personalized tours, "What happened during Project Apollo?" grounded in artifacts.
