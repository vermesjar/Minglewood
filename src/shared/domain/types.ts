/**
 * Core domain model. Deliberately provider-agnostic: nothing here knows about Discord.
 * Provider-specific identifiers live in `ExternalIdentity` / `RoomBinding` / `ProviderConnection`.
 *
 * Hierarchy: Organization → World → District → Building → Room(scene) → WorldObject
 */

export type Id = string;

export interface Organization {
  id: Id;
  slug: string;
  name: string;
  tagline: string;
  timezone: string;
  foundedAt: string; // ISO date
  worldId: Id;
}

export interface Department {
  id: Id;
  orgId: Id;
  name: string;
  color: string;
  districtId?: Id;
}

export interface Team {
  id: Id;
  orgId: Id;
  departmentId: Id;
  name: string;
  emoji: string;
  /** The room this team calls home, if any. Teams can own and decorate spaces. */
  homeRoomId?: Id;
  blurb: string;
}

export type OrgRole = 'member' | 'admin' | 'owner';

export interface Member {
  id: Id;
  orgId: Id;
  displayName: string;
  pronouns?: string;
  title: string;
  departmentId: Id;
  teamId: Id;
  managerId?: Id;
  location: string;
  timezone: string;
  startDate: string; // ISO date
  askMeAbout: string[];
  interests: string[];
  bio?: string;
  role: OrgRole;
  avatar: AvatarLoadout;
  /** Unlocked cosmetic item ids (event rewards, tenure, team swag). Never purchasable. */
  unlockedItems: string[];
  /** Saved looks to switch between. */
  outfits?: SavedOutfit[];
  /** True for seeded demo coworkers driven by the life simulator. */
  simulated?: boolean;
  settings: MemberSettings;
}

export interface MemberSettings {
  /** Who can see which room I'm in. Status is always visible; location is opt-in-able. */
  locationVisibility: 'everyone' | 'team' | 'nobody';
  /** Allow knocks while Focused. Default false: focus means focus. */
  knocksWhileFocused: boolean;
  reducedMotion?: boolean;
}

export interface ExternalIdentity {
  provider: ProviderKind;
  externalId: string;
  memberId: Id;
  username?: string;
  linkedAt: string;
}

/* ---------------------------------------------------------------- presence */

/**
 * Presence is expressive, user-controlled and ephemeral. We store the *current* state only —
 * never a history of it. No durations, no "time online", no activity scores.
 */
export type PresenceStatus =
  | 'available'
  | 'open' // open to chat
  | 'focused'
  | 'meeting'
  | 'away'
  | 'offline';

export interface PresenceState {
  memberId: Id;
  status: PresenceStatus;
  /** A short, human note: "grabbing coffee", "deep in the migration". */
  note?: string;
  /** Where they are, if they share it. Undefined = not shared or not in world. */
  sceneId?: Id;
  /** Where the status came from — manual, calendar, or inferred from a provider. */
  source: 'manual' | 'calendar' | 'provider' | 'default';
  /** Present in a provider's voice context (e.g. a Discord voice channel). */
  voice?: { providerChannelId: string; muted?: boolean; video?: boolean };
  until?: string; // ISO — e.g. meeting end
}

/* ---------------------------------------------------------------- avatars */

/**
 * A composable look. The first ten fields are the original core; the rest were added later and
 * are optional so older saved avatars stay valid (see `normalizeLoadout`).
 */
export interface AvatarLoadout {
  skin: string;
  hair: string;
  hairColor: string;
  top: string;
  topColor: string;
  bottom: string;
  bottomColor: string;
  shoes: string;
  shoesColor: string;
  /** Pins, clips and small extras. */
  accessory: string;
  hairHighlight?: string; // hex, or '' for none
  eyes?: string;
  eyeColor?: string;
  brows?: string;
  mouth?: string;
  facialHair?: string;
  faceDetail?: string;
  headwear?: string;
  headwearColor?: string;
  eyewear?: string;
  neck?: string;
  neckColor?: string;
  topAccent?: string;
  topPattern?: string;
  held?: string;
  heldColor?: string;
  pet?: string;
  petColor?: string;
  mobility?: string;
}

/** A saved look people can switch to — "vibe of the day". */
export interface SavedOutfit {
  id: string;
  name: string;
  loadout: AvatarLoadout;
}

/* ---------------------------------------------------------------- world */

export interface World {
  id: Id;
  orgId: Id;
  name: string;
  theme: 'lakeside';
  outdoorSceneId: Id;
  districts: District[];
}

export interface District {
  id: Id;
  name: string;
  description: string;
  departmentIds: Id[];
}

export type RoomPurpose = 'hq' | 'social' | 'team' | 'project' | 'event' | 'focus' | 'recreation';

/** A Building is an outdoor object that leads to one Room (interior scene). */
export interface Room {
  id: Id; // == interior scene id
  buildingObjectId: Id;
  name: string;
  purpose: RoomPurpose;
  districtId?: Id;
  description: string;
  ownerTeamId?: Id;
  emoji: string;
  /** Quiet rooms dampen interaction: knocks are held, bubbles are muted. */
  quiet?: boolean;
}

/** Binds a Minglewood room to a context on a communication provider. */
export interface RoomBinding {
  id: Id;
  orgId: Id;
  roomId: Id;
  provider: ProviderKind;
  kind: 'voice' | 'text' | 'stage' | 'activity';
  externalGuildId?: string;
  externalChannelId: string;
  label: string;
}

export type ProviderKind = 'discord' | 'demo';

export interface ProviderConnection {
  id: Id;
  orgId: Id;
  provider: ProviderKind;
  externalWorkspaceId: string; // Discord guild id
  displayName: string;
  connectedAt: string;
  connectedBy: Id;
  status: 'active' | 'error' | 'disconnected';
}

/* ---------------------------------------------------------------- events & memory */

export interface OrgEvent {
  id: Id;
  orgId: Id;
  title: string;
  kind: 'birthday' | 'launch' | 'allhands' | 'social' | 'anniversary' | 'demo-day';
  roomId: Id;
  startsAt: string;
  endsAt: string;
  hostIds: Id[];
  description: string;
  /** Cosmetic reward available to attendees (e.g. a party hat). Participation, not performance. */
  rewardItemId?: string;
  /** Visual transformation applied to the world while active. */
  decor: 'balloons' | 'launch' | 'stage' | 'none';
}

/**
 * Organizational memory: artifacts are placed in the world and carry provenance.
 * They are append-mostly; over years a world visibly accumulates them.
 */
export interface HistoricalArtifact {
  id: Id;
  orgId: Id;
  sceneId: Id;
  objectId: Id; // the WorldObject that renders it
  title: string;
  story: string;
  kind: 'launch' | 'award' | 'offsite' | 'milestone' | 'tenure' | 'tradition';
  occurredAt: string;
  teamIds: Id[];
  contributorIds: Id[];
  addedBy?: Id;
  /** Where it hangs on a room's memory wall (artifacts added after the world was authored). */
  placement?: { wall: 'left' | 'right'; at: number };
}

export interface AuditEntry {
  id: Id;
  orgId: Id;
  actorId: Id;
  action: string;
  target: string;
  at: string;
  detail?: string;
}
