import { afterEach, describe, expect, it } from 'vitest';
import type { TenantInfo } from '@shared/seed/tenant';
import { createApp, type App } from '../app';
import { MemoryPersistence } from '../store/jsonFile';
import { CloudPersistence } from './cloudPersistence';
import type { ControlPlane } from './controlPlane';
import type { PersistedOrg } from '../store/store';
import { pickOrg, upsertDiscordMember } from '../routes/auth';

/** In-memory stand-in for Minglewood Cloud. */
function fakeCloud(tenants: TenantInfo[]) {
  const state = new Map<string, PersistedOrg>();
  const cloud = {
    saves: 0,
    listTenants: async () => tenants,
    tenantForGuild: async (g: string) => tenants.find((t) => t.discordGuildId === g),
    loadState: async (id: string) => state.get(id),
    saveState: async (id: string, data: PersistedOrg) => {
      cloud.saves++;
      state.set(id, structuredClone(data));
    },
    state,
  };
  return cloud;
}

const acme: TenantInfo = {
  id: '11111111-2222-3333-4444-555555555555',
  slug: 'acme',
  name: 'Acme Co',
  discordGuildId: '900000000000000001',
  installedByDiscordUserId: '700000000000000001',
  createdAt: new Date().toISOString(),
};

let app: App | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

describe('multi-tenant worlds from Minglewood Cloud', () => {
  it('creates a world for each installed company and routes Discord users to it', async () => {
    const cloud = fakeCloud([acme]);
    app = await createApp({
      persistence: new CloudPersistence(new MemoryPersistence(), cloud as unknown as ControlPlane),
      simulateCoworkers: false,
      demo: false,
      cloud: cloud as unknown as ControlPlane,
    });
    const orgId = `t-${acme.id}`;
    expect(app.store.hasOrg(orgId)).toBe(true);
    expect(app.hubs.has(orgId)).toBe(true);
    const d = app.store.get(orgId);
    expect(d.org.name).toBe('Acme Co');
    expect(d.rooms.find((r) => r.id === 'hq')?.name).toBe('Acme Co HQ');
    expect(d.events.some((e) => e.title === 'Housewarming party')).toBe(true);
    expect(d.artifacts[0].title).toBe('We moved into Minglewood');
    expect(d.connections[0]).toMatchObject({ provider: 'discord', externalWorkspaceId: acme.discordGuildId });

    // A user in two servers lands in the one where Minglewood is installed.
    const picked = await pickOrg(app.ctx, [
      { id: '123456789012', name: 'Gaming', manager: false },
      { id: acme.discordGuildId!, name: 'Acme', manager: true },
    ]);
    expect(picked?.orgId).toBe(orgId);

    // Server managers become admins; everyone else is a member.
    const admin = upsertDiscordMember(app.ctx, orgId, { externalId: 'u1', username: 'boss', displayName: 'Boss', workspaceMember: true, roleIds: [] }, true);
    const member = upsertDiscordMember(app.ctx, orgId, { externalId: 'u2', username: 'pal', displayName: 'Pal', workspaceMember: true, roleIds: [] }, false);
    expect(admin.role).toBe('admin');
    expect(member.role).toBe('member');
    expect(member.teamId).toBe('team-everyone');
    expect(member.unlockedItems).not.toContain('top.northstar-hoodie');

    // The installer is an admin even without server-manager permissions.
    const installer = upsertDiscordMember(app.ctx, orgId, { externalId: acme.installedByDiscordUserId!, username: 'i', displayName: 'Installer', workspaceMember: true, roleIds: [] });
    expect(installer.role).toBe('admin');

    // State goes back to the cloud, and template items aren't duplicated into it.
    await app.store.flush();
    const saved = cloud.state.get(acme.id)!;
    expect(saved.members.map((m) => m.displayName).sort()).toEqual(['Boss', 'Installer', 'Pal']);
    expect(saved.customArtifacts).toEqual([]);
    expect(saved.tenant?.slug).toBe('acme');
  });

  it('picks up a company that installs after the server started', async () => {
    const tenants: TenantInfo[] = [];
    const cloud = fakeCloud(tenants);
    app = await createApp({ persistence: new MemoryPersistence(), simulateCoworkers: false, demo: false, cloud: cloud as unknown as ControlPlane });
    expect(await app.ctx.resolveGuild(acme.discordGuildId!)).toBeUndefined();
    tenants.push(acme);
    expect(await app.ctx.resolveGuild(acme.discordGuildId!)).toBe(`t-${acme.id}`);
    expect(app.hubs.has(`t-${acme.id}`)).toBe(true);
  });

  it('restores a company world from the cloud after a restart', async () => {
    const cloud = fakeCloud([acme]);
    const persistence = () => new CloudPersistence(new MemoryPersistence(), cloud as unknown as ControlPlane);
    app = await createApp({ persistence: persistence(), simulateCoworkers: false, demo: false, cloud: cloud as unknown as ControlPlane });
    const orgId = `t-${acme.id}`;
    app.store.updateRoom(orgId, 'cafe', { name: 'The Watering Hole' });
    await app.store.flush();
    await app.close();

    app = await createApp({ persistence: persistence(), simulateCoworkers: false, demo: false, cloud: cloud as unknown as ControlPlane });
    expect(app.store.get(orgId).rooms.find((r) => r.id === 'cafe')?.name).toBe('The Watering Hole');
    expect(app.store.get(orgId).artifacts.filter((a) => a.title === 'We moved into Minglewood')).toHaveLength(1);
  });
});
