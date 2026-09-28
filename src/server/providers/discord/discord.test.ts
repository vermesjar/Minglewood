import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ORG_ID } from '@shared/seed/northstar';
import { DEFAULT_LOADOUT } from '@shared/avatar';
import { DiscordProvider } from './provider';
import { Store } from '../../store/store';
import { MemoryPersistence } from '../../store/jsonFile';
import { OrgHub } from '../../realtime/orgHub';
import { VoicePresenceSync } from '../voiceSync';

function mockFetch(routes: Record<string, { status?: number; body: unknown }>) {
  return vi.fn(async (url: string | URL) => {
    const u = String(url);
    const hit = Object.entries(routes).find(([k]) => u.includes(k));
    const { status = 200, body } = hit?.[1] ?? { status: 404, body: { message: 'Unknown' } };
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  });
}

describe('DiscordProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('verifies guild membership and prefers the server nickname', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/oauth2/token': { body: { access_token: 'at', token_type: 'Bearer', expires_in: 1, scope: 'identify' } },
        '/users/@me/guilds/G1/member': { body: { nick: 'Maya (Design)', roles: ['r1'] } },
        '/users/@me': { body: { id: 'u1', username: 'maya', global_name: 'Maya' } },
      }),
    );
    const p = await new DiscordProvider().identify('code', 'G1');
    expect(p).toMatchObject({ externalId: 'u1', workspaceMember: true, displayName: 'Maya (Design)', roleIds: ['r1'] });
  });

  it('reports non-members (404 on the member endpoint) instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/oauth2/token': { body: { access_token: 'at', token_type: 'Bearer', expires_in: 1, scope: 'identify' } },
        '/users/@me/guilds/G1/member': { status: 404, body: { message: 'Unknown Guild' } },
        '/users/@me': { body: { id: 'u2', username: 'stranger' } },
      }),
    );
    const p = await new DiscordProvider().identify('code', 'G1');
    expect(p.workspaceMember).toBe(false);
  });

  it('produces an honest deep-link join instruction for voice channels', () => {
    const j = new DiscordProvider().joinInstruction({
      id: 'b',
      orgId: ORG_ID,
      roomId: 'cafe',
      provider: 'discord',
      kind: 'voice',
      externalGuildId: 'G1',
      externalChannelId: 'C1',
      label: '🔊 café',
    });
    expect(j.webUrl).toBe('https://discord.com/channels/G1/C1');
    expect(j.explainer).toMatch(/Join Voice/);
  });
});

describe('VoicePresenceSync', () => {
  let store: Store;
  let hub: OrgHub;
  beforeEach(async () => {
    store = new Store(new MemoryPersistence());
    await store.init();
    hub = new OrgHub(ORG_ID, store);
  });
  afterEach(() => hub.dispose());

  it('places a member who joins a bound Discord voice channel into the matching room', () => {
    const m = store.createMember(ORG_ID, {
      displayName: 'Dee',
      title: 'Engineer',
      departmentId: 'dep-eng',
      teamId: 'team-platform',
      location: 'Remote',
      timezone: 'UTC',
      startDate: '2025-01-01',
      askMeAbout: [],
      interests: [],
      role: 'member',
      avatar: DEFAULT_LOADOUT,
      unlockedItems: [],
      settings: { locationVisibility: 'everyone', knocksWhileFocused: false },
    });
    store.linkIdentity(ORG_ID, { provider: 'discord', externalId: 'u9', memberId: m.id, linkedAt: new Date().toISOString() });
    store.setBinding(
      ORG_ID,
      { id: 'b1', orgId: ORG_ID, roomId: 'cafe', provider: 'discord', kind: 'voice', externalGuildId: 'G1', externalChannelId: 'C1', label: 'café' },
      'cafe',
    );
    const sync = new VoicePresenceSync(hub, store);
    sync.apply({ externalUserId: 'u9', channelId: 'C1', muted: true, video: false });
    const a = hub.actor(m.id);
    expect(a?.sceneId).toBe('cafe');
    expect(a?.via).toBe('provider');
    expect(hub.presenceOf(m.id).voice).toMatchObject({ providerChannelId: 'C1', muted: true });

    sync.apply({ externalUserId: 'u9', channelId: null, muted: false, video: false });
    expect(hub.actor(m.id)).toBeUndefined();
    expect(hub.presenceOf(m.id).voice).toBeUndefined();
  });

  it('ignores Discord users who are not Minglewood members', () => {
    const sync = new VoicePresenceSync(hub, store);
    sync.apply({ externalUserId: 'nobody', channelId: 'C1', muted: false, video: false });
    expect(hub.actorsIn('cafe').every((a) => a.via !== 'provider')).toBe(true);
  });
});
