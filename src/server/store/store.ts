/**
 * Repository for organization data.
 *
 * All reads/writes are org-scoped (`orgId` is the first argument everywhere) so tenancy is
 * enforced at the data boundary, not sprinkled through handlers. The dev implementation keeps
 * state in memory and persists to a JSON file; `db/schema.sql` describes the Postgres target,
 * and a `PostgresPersistence` can implement `Persistence` without touching callers.
 */
import { randomUUID } from 'node:crypto';
import type {
  AuditEntry,
  AvatarLoadout,
  Department,
  ExternalIdentity,
  HistoricalArtifact,
  Member,
  OrgEvent,
  Organization,
  ProviderConnection,
  Room,
  RoomBinding,
  Team,
  World,
} from '@shared/domain/types';
import type { Decoration } from '@shared/world/decor';
import {
  buildSeed,
  DEMO_BINDINGS,
  DEPARTMENTS,
  ORGANIZATION,
  ROOMS,
  TEAMS,
  WORLD,
  type SimProfile,
} from '@shared/seed/northstar';

export interface OrgData {
  org: Organization;
  world: World;
  departments: Department[];
  teams: Team[];
  rooms: Room[];
  members: Map<string, Member>;
  identities: ExternalIdentity[];
  bindings: RoomBinding[];
  connections: ProviderConnection[];
  events: OrgEvent[];
  artifacts: HistoricalArtifact[];
  decorations: Decoration[];
  audit: AuditEntry[];
  sim: Record<string, SimProfile>;
}

/** What survives a restart. Seeded demo coworkers & demo events are regenerated at boot. */
export interface PersistedOrg {
  org: Organization;
  rooms: Room[];
  members: Member[]; // non-simulated only
  identities: ExternalIdentity[];
  bindings: RoomBinding[];
  connections: ProviderConnection[];
  customEvents: OrgEvent[];
  customArtifacts?: HistoricalArtifact[];
  decorations?: Decoration[];
  audit: AuditEntry[];
}

export interface Persistence {
  load(): Promise<Record<string, PersistedOrg>>;
  save(data: Record<string, PersistedOrg>): Promise<void>;
}

export class Store {
  private orgs = new Map<string, OrgData>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly persistence: Persistence) {}

  async init(now = new Date()): Promise<void> {
    const persisted = await this.persistence.load();
    const seed = buildSeed(now);
    const saved = persisted[ORGANIZATION.id];
    const members = new Map<string, Member>(seed.members.map((m) => [m.id, m]));
    for (const m of saved?.members ?? []) members.set(m.id, m);
    this.orgs.set(ORGANIZATION.id, {
      org: saved?.org ?? { ...ORGANIZATION },
      world: WORLD,
      departments: DEPARTMENTS,
      teams: TEAMS,
      rooms: saved?.rooms ?? ROOMS.map((r) => ({ ...r })),
      members,
      identities: saved?.identities ?? [],
      bindings: saved?.bindings ?? DEMO_BINDINGS.map((b) => ({ ...b })),
      connections: saved?.connections ?? [],
      events: [...seed.events, ...(saved?.customEvents ?? [])],
      artifacts: [...seed.artifacts, ...(saved?.customArtifacts ?? [])],
      decorations: saved?.decorations ?? [],
      audit: saved?.audit ?? [],
      sim: seed.sim,
    });
  }

  orgIds(): string[] {
    return [...this.orgs.keys()];
  }

  get(orgId: string): OrgData {
    const d = this.orgs.get(orgId);
    if (!d) throw new Error(`Unknown org ${orgId}`);
    return d;
  }

  member(orgId: string, memberId: string): Member | undefined {
    return this.orgs.get(orgId)?.members.get(memberId);
  }

  members(orgId: string): Member[] {
    return [...this.get(orgId).members.values()];
  }

  createMember(orgId: string, fields: Omit<Member, 'id' | 'orgId'>): Member {
    const m: Member = { ...fields, id: `m-${randomUUID().slice(0, 8)}`, orgId };
    this.get(orgId).members.set(m.id, m);
    this.scheduleSave();
    return m;
  }

  updateMember(orgId: string, memberId: string, patch: Partial<Omit<Member, 'id' | 'orgId'>>): Member {
    const m = this.member(orgId, memberId);
    if (!m) throw new Error('member not found');
    Object.assign(m, patch);
    this.scheduleSave();
    return m;
  }

  setAvatar(orgId: string, memberId: string, avatar: AvatarLoadout): Member {
    return this.updateMember(orgId, memberId, { avatar });
  }

  grantItem(orgId: string, memberId: string, itemId: string): boolean {
    const m = this.member(orgId, memberId);
    if (!m || m.unlockedItems.includes(itemId)) return false;
    m.unlockedItems = [...m.unlockedItems, itemId];
    this.scheduleSave();
    return true;
  }

  identity(orgId: string, provider: ExternalIdentity['provider'], externalId: string) {
    return this.get(orgId).identities.find((i) => i.provider === provider && i.externalId === externalId);
  }

  linkIdentity(orgId: string, identity: ExternalIdentity): void {
    const d = this.get(orgId);
    d.identities = d.identities.filter(
      (i) => !(i.provider === identity.provider && i.externalId === identity.externalId),
    );
    d.identities.push(identity);
    this.scheduleSave();
  }

  /** Finds which org a provider workspace (e.g. Discord guild) is connected to. */
  orgForWorkspace(provider: ProviderConnection['provider'], workspaceId: string): string | undefined {
    for (const [id, d] of this.orgs) {
      if (d.connections.some((c) => c.provider === provider && c.externalWorkspaceId === workspaceId && c.status === 'active'))
        return id;
    }
    return undefined;
  }

  setConnection(orgId: string, conn: ProviderConnection): void {
    const d = this.get(orgId);
    d.connections = [...d.connections.filter((c) => c.provider !== conn.provider), conn];
    this.scheduleSave();
  }

  setBinding(orgId: string, binding: RoomBinding | null, roomId: string): void {
    const d = this.get(orgId);
    d.bindings = d.bindings.filter((b) => b.roomId !== roomId);
    if (binding) d.bindings.push(binding);
    this.scheduleSave();
  }

  updateRoom(orgId: string, roomId: string, patch: Partial<Pick<Room, 'name' | 'description' | 'ownerTeamId'>>): Room {
    const room = this.get(orgId).rooms.find((r) => r.id === roomId);
    if (!room) throw new Error('room not found');
    Object.assign(room, patch);
    this.scheduleSave();
    return room;
  }

  updateOrg(orgId: string, patch: Partial<Pick<Organization, 'name' | 'tagline'>>): Organization {
    const d = this.get(orgId);
    Object.assign(d.org, patch);
    this.scheduleSave();
    return d.org;
  }

  addEvent(orgId: string, ev: OrgEvent): void {
    this.get(orgId).events.push(ev);
    this.scheduleSave();
  }

  addDecoration(orgId: string, d: Decoration): void {
    this.get(orgId).decorations.push(d);
    this.scheduleSave();
  }

  removeDecoration(orgId: string, id: string): Decoration | undefined {
    const data = this.get(orgId);
    const found = data.decorations.find((d) => d.id === id);
    data.decorations = data.decorations.filter((d) => d.id !== id);
    this.scheduleSave();
    return found;
  }

  addArtifact(orgId: string, a: HistoricalArtifact): void {
    this.get(orgId).artifacts.push(a);
    this.scheduleSave();
  }

  audit(orgId: string, actorId: string, action: string, target: string, detail?: string): void {
    const d = this.get(orgId);
    d.audit.unshift({ id: randomUUID(), orgId, actorId, action, target, detail, at: new Date().toISOString() });
    d.audit.length = Math.min(d.audit.length, 500);
    this.scheduleSave();
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, 400);
  }

  async flush(): Promise<void> {
    const out: Record<string, PersistedOrg> = {};
    const seed = buildSeed();
    const seedEventIds = new Set(seed.events.map((e) => e.id));
    const seedArtifactIds = new Set(seed.artifacts.map((a) => a.id));
    for (const [id, d] of this.orgs) {
      out[id] = {
        org: d.org,
        rooms: d.rooms,
        members: [...d.members.values()].filter((m) => !m.simulated),
        identities: d.identities,
        bindings: d.bindings,
        connections: d.connections,
        customEvents: d.events.filter((e) => !seedEventIds.has(e.id)),
        customArtifacts: d.artifacts.filter((a) => !seedArtifactIds.has(a.id)),
        decorations: d.decorations,
        audit: d.audit,
      };
    }
    await this.persistence.save(out);
  }
}
