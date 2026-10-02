/**
 * Client for Minglewood Cloud — the hosted control plane (Lovable Cloud edge functions).
 * It owns installs (which companies added Minglewood to Discord or Slack) and durable per-tenant world
 * state. The game server authenticates with a shared server key.
 */
import type { TenantInfo } from '@shared/seed/tenant';
import type { PersistedOrg } from '../store/store';

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  discord_guild_id: string | null;
  discord_guild_icon: string | null;
  installed_by_discord_user_id: string | null;
  /** Added with the Slack install (docs/HOSTING.md); older control planes don't send these. */
  slack_team_id?: string | null;
  installed_by_slack_user_id?: string | null;
  created_at: string;
}

export function toTenant(r: TenantRow): TenantInfo {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    discordGuildId: r.discord_guild_id ?? undefined,
    discordGuildIcon: r.discord_guild_icon,
    installedByDiscordUserId: r.installed_by_discord_user_id,
    slackTeamId: r.slack_team_id ?? undefined,
    installedBySlackUserId: r.installed_by_slack_user_id ?? undefined,
    createdAt: r.created_at,
  };
}

/** A company created by an Add-to-Slack install (the Discord install creates its tenant on the cloud side). */
export interface NewSlackTenant {
  name: string;
  slug: string;
  slackTeamId: string;
  installedBySlackUserId: string;
}

export class ControlPlaneError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    body: string,
  ) {
    super(`control plane ${path}: ${status} ${body.slice(0, 200)}`);
  }
}

export class ControlPlane {
  constructor(
    private readonly baseUrl: string,
    private readonly serverKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'x-minglewood-key': this.serverKey, ...(init.headers ?? {}) },
    });
    if (!res.ok) throw new ControlPlaneError(path, res.status, await res.text());
    return (await res.json()) as T;
  }

  async listTenants(): Promise<TenantInfo[]> {
    const { tenants } = await this.call<{ tenants: TenantRow[] }>('tenants');
    return tenants.map(toTenant);
  }

  async tenantForGuild(guildId: string): Promise<TenantInfo | undefined> {
    const { tenants } = await this.call<{ tenants: TenantRow[] }>(`tenants?guild=${encodeURIComponent(guildId)}`);
    return tenants[0] ? toTenant(tenants[0]) : undefined;
  }

  /** The company a Slack workspace installed Minglewood for (needs the control plane's Slack support). */
  async tenantForSlackTeam(teamId: string): Promise<TenantInfo | undefined> {
    const { tenants } = await this.call<{ tenants: TenantRow[] }>(`tenants?slack_team=${encodeURIComponent(teamId)}`);
    return tenants.find((t) => t.slack_team_id === teamId) ? toTenant(tenants.find((t) => t.slack_team_id === teamId)!) : undefined;
  }

  /**
   * Create a company for a Slack workspace (POST tenants). A control plane without Slack support answers 404/405,
   * which surfaces as ControlPlaneError so the install can explain itself.
   */
  async createTenant(t: NewSlackTenant): Promise<TenantInfo> {
    const { tenant } = await this.call<{ tenant: TenantRow }>('tenants', {
      method: 'POST',
      body: JSON.stringify({ name: t.name, slug: t.slug, slack_team_id: t.slackTeamId, installed_by_slack_user_id: t.installedBySlackUserId }),
    });
    return toTenant(tenant);
  }

  async loadState(tenantId: string): Promise<PersistedOrg | undefined> {
    const { data } = await this.call<{ data: PersistedOrg | Record<string, never> }>(`org-state?org_id=${encodeURIComponent(tenantId)}`);
    return data && 'org' in data ? (data as PersistedOrg) : undefined;
  }

  async saveState(tenantId: string, data: PersistedOrg): Promise<void> {
    await this.call(`org-state?org_id=${encodeURIComponent(tenantId)}`, { method: 'PUT', body: JSON.stringify({ data }) });
  }
}
