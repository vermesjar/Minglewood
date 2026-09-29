/**
 * Contract test: the real ControlPlane HTTP client against a local server that mirrors
 * Minglewood Cloud's /api/public routes (tenants, org-state) — same paths, headers, shapes
 * and status codes as the Lovable implementation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ControlPlane } from './controlPlane';
import { createApp } from '../app';
import { MemoryPersistence } from '../store/jsonFile';
import { CloudPersistence } from './cloudPersistence';

const KEY = 'test-server-key';
const org = {
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  slug: 'globex',
  name: 'Globex',
  discord_guild_id: '910000000000000009',
  discord_guild_icon: null,
  installed_by_discord_user_id: '710000000000000007',
  created_at: new Date().toISOString(),
};
const states = new Map<string, unknown>();
let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers['x-minglewood-key'] !== KEY) return send(401, { error: 'unauthorized' });
    if (url.pathname === '/api/public/tenants') {
      const g = url.searchParams.get('guild');
      return send(200, { tenants: g ? [org].filter((o) => o.discord_guild_id === g) : [org] });
    }
    if (url.pathname === '/api/public/org-state') {
      const id = url.searchParams.get('org_id')!;
      if (req.method === 'GET') return send(200, { data: states.get(id) ?? {}, updated_at: null });
      let body = '';
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body) as { data: unknown };
      if (id !== org.id) return send(404, { error: 'org not found' });
      states.set(id, parsed.data);
      return send(200, { ok: true, updated_at: new Date().toISOString() });
    }
    send(404, { error: 'not found' });
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/public`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('ControlPlane HTTP contract', () => {
  it('rejects a wrong server key', async () => {
    await expect(new ControlPlane(base, 'nope').listTenants()).rejects.toThrow(/401/);
  });

  it('lists tenants and maps them to TenantInfo', async () => {
    const cp = new ControlPlane(base, KEY);
    const [t] = await cp.listTenants();
    expect(t).toMatchObject({ id: org.id, name: 'Globex', discordGuildId: org.discord_guild_id, installedByDiscordUserId: org.installed_by_discord_user_id });
    expect(await cp.tenantForGuild('123')).toBeUndefined();
    expect((await cp.tenantForGuild(org.discord_guild_id))?.slug).toBe('globex');
  });

  it('treats an empty state as "no world yet", then round-trips a saved world', async () => {
    const cp = new ControlPlane(base, KEY);
    expect(await cp.loadState(org.id)).toBeUndefined();
    const app = await createApp({ persistence: new CloudPersistence(new MemoryPersistence(), cp), simulateCoworkers: false, demo: false, cloud: cp });
    const orgId = `t-${org.id}`;
    app.store.updateOrg(orgId, { tagline: 'We make everything.' });
    await app.store.flush();
    await app.close();
    const saved = await cp.loadState(org.id);
    expect(saved?.org.tagline).toBe('We make everything.');
    expect(saved?.tenant?.discordGuildId).toBe(org.discord_guild_id);
  });
});
