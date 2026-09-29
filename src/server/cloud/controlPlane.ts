/**
 * Client for Minglewood Cloud — the hosted control plane (Lovable Cloud edge functions).
 * It owns installs (which companies added Minglewood to Discord) and durable per-tenant world
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
    createdAt: r.created_at,
  };
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
    if (!res.ok) throw new Error(`control plane ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
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

  async loadState(tenantId: string): Promise<PersistedOrg | undefined> {
    const { data } = await this.call<{ data: PersistedOrg | Record<string, never> }>(`org-state?org_id=${encodeURIComponent(tenantId)}`);
    return data && 'org' in data ? (data as PersistedOrg) : undefined;
  }

  async saveState(tenantId: string, data: PersistedOrg): Promise<void> {
    await this.call(`org-state?org_id=${encodeURIComponent(tenantId)}`, { method: 'PUT', body: JSON.stringify({ data }) });
  }
}
