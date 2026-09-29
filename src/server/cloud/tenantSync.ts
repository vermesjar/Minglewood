import type { TenantInfo } from '@shared/seed/tenant';
import type { Store } from '../store/store';
import type { ControlPlane } from './controlPlane';

/**
 * Keeps the game server's set of worlds in step with installs. New companies appear within a
 * minute, and a login from a just-installed server resolves immediately via `forGuild`.
 */
export class TenantSync {
  private timer: NodeJS.Timeout | null = null;
  private byGuild = new Map<string, string>();

  constructor(
    private readonly store: Store,
    private readonly cloud: ControlPlane,
    private readonly onOrg: (orgId: string, tenant: TenantInfo, created: boolean) => void,
  ) {}

  async start(intervalMs = 60_000) {
    await this.refresh().catch((e) => console.warn('[cloud] tenant sync failed:', (e as Error).message));
    this.timer = setInterval(() => void this.refresh().catch((e) => console.warn('[cloud] tenant sync failed:', (e as Error).message)), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh() {
    for (const t of await this.cloud.listTenants()) await this.add(t);
  }

  private async add(t: TenantInfo): Promise<string> {
    const { orgId, created } = await this.store.ensureTenant(t);
    if (t.discordGuildId) this.byGuild.set(t.discordGuildId, orgId);
    this.onOrg(orgId, t, created);
    if (created) console.log(`[cloud] new world for ${t.name} (${orgId})`);
    return orgId;
  }

  /** Org for a Discord server, asking the control plane if we haven't seen it yet. */
  async forGuild(guildId: string): Promise<string | undefined> {
    const known = this.byGuild.get(guildId);
    if (known) return known;
    const t = await this.cloud.tenantForGuild(guildId);
    return t ? this.add(t) : undefined;
  }

  guilds(): Map<string, string> {
    return this.byGuild;
  }
}
