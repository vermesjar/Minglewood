/**
 * Repository for organization data.
 *
 * All reads/writes are org-scoped (`orgId` is the first argument everywhere) so tenancy is
 * enforced at the data boundary, not sprinkled through handlers. The dev implementation keeps
 * state in memory and persists to a JSON file; `db/schema.sql` describes the Postgres target,
 * and a `PostgresPersistence` can implement `Persistence` without touching callers.
 */
import { randomUUID } from 'node:crypto';
import { bindingSlot, type BindingSlot } from '@shared/domain/types';
import type {
  AuditEntry,
  AvatarLoadout,
  Department,
  ExternalIdentity,
  HistoricalArtifact,
  Member,
  OrgEvent,
  Organization,
  Platform,
  ProviderKind,
  ProviderConnection,
  Room,
  RoomBinding,
  Team,
  World,
} from '@shared/domain/types';
import type { Decoration } from '@shared/world/decor';
import type { BoardNote } from '@shared/protocol';
import { tenantOrgId, tenantTemplate, type TenantInfo } from '@shared/seed/tenant';
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
  /** Notes left on boards (whiteboards) around the world. */
  notes: BoardNote[];
  audit: AuditEntry[];
  sim: Record<string, SimProfile>;
  /** Event/artifact ids generated from a template (demo seed or tenant starter) — never persisted. */
  templateIds: Set<string>;
  tenant?: TenantInfo;
  /** Server-side secrets for this company (a workspace's bot token). Never sent to clients. */
  secrets?: Record<string, string>;
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
  notes?: BoardNote[];
  audit: AuditEntry[];
  tenant?: TenantInfo;
  /** Server-side secrets (a Slack workspace's bot token) — stored with the world so they survive a redeploy; never exposed by any route. */
  secrets?: Record<string, string>;
}

export interface Persistence {
  load(): Promise<Record<string, PersistedOrg>>;
  save(data: Record<string, PersistedOrg>): Promise<void>;
  /** Optional lazy loading for tenants that aren't part of the initial load. */
  loadOrg?(orgId: string): Promise<PersistedOrg | undefined>;
}

export class Store {
  private orgs = new Map<string, OrgData>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly persistence: Persistence) {}

  private persisted: Record<string, PersistedOrg> = {};

  async init(now = new Date(), opts: { demo?: boolean } = {}): Promise<void> {
    this.persisted = await this.persistence.load();
    if (opts.demo !== false) {
      const seed = buildSeed(now);
      const saved = this.persisted[ORGANIZATION.id];
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
        notes: saved?.notes ?? [],
        audit: saved?.audit ?? [],
        sim: seed.sim,
        templateIds: new Set([...seed.events.map((e) => e.id), ...seed.artifacts.map((a) => a.id)]),
        secrets: saved?.secrets,
      });
    }
    // Tenants that were saved locally (single-server installs) come back at boot.
    for (const p of Object.values(this.persisted)) if (p.tenant) this.hydrateTenant(p.tenant, p);
  }

  hasOrg(orgId: string): boolean {
    return this.orgs.has(orgId);
  }

  /**
   * Makes sure a company that installed Minglewood has a world. Loads its saved state (lazily,
   * from the control plane) or creates it from the starter template. Returns the org id.
   */
  async ensureTenant(t: TenantInfo): Promise<{ orgId: string; created: boolean }> {
    const orgId = tenantOrgId(t.id);
    const existing = this.orgs.get(orgId);
    if (existing) {
      existing.tenant = t;
      if (t.discordGuildId) this.connectDiscord(existing, t);
      if (t.slackTeamId) this.connectSlack(existing, t);
      return { orgId, created: false };
    }
    const saved = this.persisted[orgId] ?? (await this.persistence.loadOrg?.(orgId));
    this.hydrateTenant(t, saved);
    if (!saved) this.scheduleSave();
    return { orgId, created: !saved };
  }

  private hydrateTenant(t: TenantInfo, saved: PersistedOrg | undefined) {
    const tpl = tenantTemplate(t);
    const d: OrgData = {
      org: saved?.org ?? tpl.org,
      world: tpl.world,
      departments: tpl.departments,
      teams: tpl.teams,
      rooms: saved?.rooms ?? tpl.rooms,
      members: new Map((saved?.members ?? []).map((m) => [m.id, m])),
      identities: saved?.identities ?? [],
      bindings: saved?.bindings ?? [],
      connections: saved?.connections ?? [],
      events: [...tpl.events, ...(saved?.customEvents ?? [])],
      artifacts: [...tpl.artifacts, ...(saved?.customArtifacts ?? [])],
      decorations: saved?.decorations ?? [],
      notes: saved?.notes ?? [],
      audit: saved?.audit ?? [],
      sim: {},
      templateIds: new Set([...tpl.events.map((e) => e.id), ...tpl.artifacts.map((a) => a.id)]),
      tenant: t,
      secrets: saved?.secrets,
    };
    if (t.discordGuildId) this.connectDiscord(d, t);
    if (t.slackTeamId) this.connectSlack(d, t);
    this.orgs.set(tpl.org.id, d);
  }

  private connectDiscord(d: OrgData, t: TenantInfo) {
    if (d.connections.some((c) => c.provider === 'discord' && c.externalWorkspaceId === t.discordGuildId)) return;
    d.connections = [
      ...d.connections.filter((c) => c.provider !== 'discord'),
      {
        id: `conn-${t.id.slice(0, 8)}`,
        orgId: d.org.id,
        provider: 'discord',
        externalWorkspaceId: t.discordGuildId!,
        displayName: t.name,
        connectedAt: t.createdAt,
        connectedBy: t.installedByDiscordUserId ?? 'installer',
        status: 'active',
      },
    ];
  }

  private connectSlack(d: OrgData, t: TenantInfo) {
    if (d.connections.some((c) => c.provider === 'slack' && c.externalWorkspaceId === t.slackTeamId)) return;
    d.connections = [
      ...d.connections.filter((c) => c.provider !== 'slack'),
      {
        id: `conn-slack-${t.id.slice(0, 8)}`,
        orgId: d.org.id,
        provider: 'slack',
        externalWorkspaceId: t.slackTeamId!,
        displayName: t.name,
        connectedAt: t.createdAt,
        connectedBy: t.installedBySlackUserId ?? 'installer',
        status: 'active',
      },
    ];
  }

  /** A server-side secret of this company (never part of any API response). */
  secret(orgId: string, key: string): string | undefined {
    return this.get(orgId).secrets?.[key];
  }

  setSecret(orgId: string, key: string, value: string | null): void {
    const d = this.get(orgId);
    const secrets = { ...d.secrets };
    if (value) secrets[key] = value;
    else delete secrets[key];
    d.secrets = Object.keys(secrets).length ? secrets : undefined;
    this.scheduleSave();
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

  /**
   * Set (or clear) one of a space's bindings. A space keeps one voice and one text binding: setting a
   * text channel leaves its voice channel alone and vice versa. `slot` limits a removal; without it,
   * removing clears the whole space.
   */
  setBinding(orgId: string, binding: RoomBinding | null, roomId: string, slot?: BindingSlot): void {
    const d = this.get(orgId);
    const which = binding ? bindingSlot(binding.kind) : slot;
    d.bindings = d.bindings.filter((b) => b.roomId !== roomId || (which !== undefined && bindingSlot(b.kind) !== which));
    if (binding) d.bindings.push(binding);
    this.scheduleSave();
  }

  /** The provider renamed a bound channel: keep the space's label in step with it. */
  relabelBinding(orgId: string, bindingId: string, label: string): void {
    const b = this.get(orgId).bindings.find((x) => x.id === bindingId);
    if (b && b.label !== label) {
      b.label = label;
      this.scheduleSave();
    }
  }

  bindingFor(orgId: string, roomId: string, slot: BindingSlot): RoomBinding | undefined {
    return this.get(orgId).bindings.find((b) => b.roomId === roomId && bindingSlot(b.kind) === slot);
  }

  updateRoom(orgId: string, roomId: string, patch: Partial<Pick<Room, 'name' | 'description' | 'ownerTeamId'>>): Room {
    const room = this.get(orgId).rooms.find((r) => r.id === roomId);
    if (!room) throw new Error('room not found');
    Object.assign(room, patch);
    this.scheduleSave();
    return room;
  }

  /** The platform a company runs on: the admin's pick, else whichever is connected (Slack first), else local. */
  platformOf(orgId: string): Platform {
    const d = this.get(orgId);
    if (d.org.platform) return d.org.platform;
    const active = (p: ProviderKind) => d.connections.some((c) => c.provider === p && c.status === 'active');
    return active('slack') ? 'slack' : active('discord') ? 'discord' : 'local';
  }

  updateOrg(orgId: string, patch: Partial<Pick<Organization, 'name' | 'tagline' | 'platform'>>): Organization {
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

  /** A team piece moved: to another floor tile, or along a wall (`wall` absent: it stands on the floor). */
  moveDecoration(orgId: string, id: string, to: { x: number; y: number; wall?: 'left' | 'right' }): Decoration | undefined {
    const data = this.get(orgId);
    const i = data.decorations.findIndex((d) => d.id === id);
    if (i < 0) return undefined;
    const { wall: _was, ...rest } = data.decorations[i];
    void _was;
    const moved: Decoration = { ...rest, x: to.x, y: to.y, ...(to.wall ? { wall: to.wall } : {}) };
    data.decorations = data.decorations.map((d, j) => (j === i ? moved : d));
    this.scheduleSave();
    return moved;
  }

  addNote(orgId: string, n: BoardNote): void {
    this.get(orgId).notes.push(n);
    this.scheduleSave();
  }

  removeNote(orgId: string, id: string): BoardNote | undefined {
    const data = this.get(orgId);
    const found = data.notes.find((n) => n.id === id);
    data.notes = data.notes.filter((n) => n.id !== id);
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
    for (const [id, d] of this.orgs) {
      out[id] = {
        org: d.org,
        rooms: d.rooms,
        members: [...d.members.values()].filter((m) => !m.simulated),
        identities: d.identities,
        bindings: d.bindings,
        connections: d.connections,
        customEvents: d.events.filter((e) => !d.templateIds.has(e.id)),
        customArtifacts: d.artifacts.filter((a) => !d.templateIds.has(a.id)),
        decorations: d.decorations,
        notes: d.notes,
        audit: d.audit,
        tenant: d.tenant,
        ...(d.secrets ? { secrets: d.secrets } : {}),
      };
    }
    await this.persistence.save(out);
  }
}
