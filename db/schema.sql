-- Minglewood — target relational schema (PostgreSQL).
--
-- The prototype persists through the `Persistence` interface (src/server/store) into a JSON file
-- so it runs with zero setup. This is the schema a `PostgresPersistence` implements. Every table
-- that holds tenant data carries org_id and is queried by it; provider-specific identifiers live
-- only in the *_external / binding tables, never on core domain rows.

create table organizations (
  id            text primary key,
  slug          text unique not null,
  name          text not null,
  tagline       text not null default '',
  timezone      text not null default 'UTC',
  founded_at    date,
  created_at    timestamptz not null default now()
);

create table departments (
  id            text primary key,
  org_id        text not null references organizations(id) on delete cascade,
  name          text not null,
  color         text not null,
  district_id   text
);

create table teams (
  id            text primary key,
  org_id        text not null references organizations(id) on delete cascade,
  department_id text not null references departments(id),
  name          text not null,
  emoji         text not null default '',
  home_room_id  text,
  blurb         text not null default ''
);

create table members (
  id              text primary key,
  org_id          text not null references organizations(id) on delete cascade,
  display_name    text not null,
  pronouns        text,
  title           text not null default '',
  department_id   text references departments(id),
  team_id         text references teams(id),
  manager_id      text references members(id),
  location        text not null default '',
  timezone        text not null default 'UTC',
  start_date      date not null,
  ask_me_about    text[] not null default '{}',
  interests       text[] not null default '{}',
  bio             text,
  role            text not null check (role in ('member','admin','owner')) default 'member',
  avatar          jsonb not null,               -- AvatarLoadout
  -- privacy settings are the member's, not the employer's
  location_visibility text not null default 'everyone' check (location_visibility in ('everyone','team','nobody')),
  knocks_while_focused boolean not null default false,
  created_at      timestamptz not null default now()
);
create index on members (org_id);

-- Cosmetic unlocks: earned by participation/tenure, never purchased.
create table member_items (
  member_id   text not null references members(id) on delete cascade,
  item_id     text not null,
  source      text not null,     -- 'event:ev-…', 'tenure:5y', 'launch:aurora'
  granted_at  timestamptz not null default now(),
  primary key (member_id, item_id)
);

-- Identity on external providers (Discord user id, later Slack/Teams).
create table external_identities (
  org_id       text not null references organizations(id) on delete cascade,
  provider     text not null,
  external_id  text not null,
  member_id    text not null references members(id) on delete cascade,
  username     text,
  linked_at    timestamptz not null default now(),
  primary key (org_id, provider, external_id)
);

create table provider_connections (
  id                    text primary key,
  org_id                text not null references organizations(id) on delete cascade,
  provider              text not null,
  external_workspace_id text not null,       -- Discord guild id
  display_name          text not null,
  connected_by          text references members(id),
  status                text not null default 'active',
  connected_at          timestamptz not null default now(),
  unique (provider, external_workspace_id)
);

-- World: scenes are JSON documents (the world-builder edits them); rooms are the social layer.
create table worlds (
  id          text primary key,
  org_id      text not null references organizations(id) on delete cascade,
  name        text not null,
  theme       text not null,
  version     int  not null default 1
);

create table scenes (
  id          text not null,
  world_id    text not null references worlds(id) on delete cascade,
  kind        text not null check (kind in ('outdoor','interior')),
  definition  jsonb not null,               -- SceneDef: tiles, objects, theme
  version     int  not null default 1,
  primary key (world_id, id)
);

create table rooms (
  id              text not null,
  org_id          text not null references organizations(id) on delete cascade,
  world_id        text not null references worlds(id) on delete cascade,
  building_object text not null,
  name            text not null,
  purpose         text not null,
  district_id     text,
  description     text not null default '',
  owner_team_id   text references teams(id),
  emoji           text not null default '',
  quiet           boolean not null default false,
  primary key (org_id, id)
);

create table room_bindings (
  id                  text primary key,
  org_id              text not null references organizations(id) on delete cascade,
  room_id             text not null,
  provider            text not null,
  kind                text not null check (kind in ('voice','text','stage','activity')),
  external_guild_id   text,
  external_channel_id text not null,
  label               text not null
);
create index on room_bindings (org_id, provider, external_channel_id);

create table events (
  id            text primary key,
  org_id        text not null references organizations(id) on delete cascade,
  title         text not null,
  kind          text not null,
  room_id       text not null,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  host_ids      text[] not null default '{}',
  description   text not null default '',
  reward_item   text,
  decor         text not null default 'none'
);
create index on events (org_id, starts_at);

-- Organizational memory: artifacts with provenance, placed in the world.
create table historical_artifacts (
  id               text primary key,
  org_id           text not null references organizations(id) on delete cascade,
  scene_id         text not null,
  object_id        text not null,
  title            text not null,
  story            text not null,
  kind             text not null,
  occurred_at      date not null,
  team_ids         text[] not null default '{}',
  contributor_ids  text[] not null default '{}',
  added_by         text references members(id),
  created_at       timestamptz not null default now()
);

-- Configuration audit only. There is deliberately NO table of member activity, sessions,
-- time-online, or presence history. Presence is live state held in the realtime tier.
create table audit_log (
  id         text primary key,
  org_id     text not null references organizations(id) on delete cascade,
  actor_id   text not null,
  action     text not null,
  target     text not null,
  detail     text,
  at         timestamptz not null default now()
);
create index on audit_log (org_id, at desc);
