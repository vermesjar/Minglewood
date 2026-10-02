/**
 * A channel for every space, in one click — Slack edition. A Slack channel is both a space's conversation and its
 * huddle, so each space gets exactly one channel, bound as both its text and its voice. Existing channels are
 * matched by name (the town is #general), the rest are created (channels:manage), and the app joins every public
 * channel it binds (channels:join) so their messages and huddles reach the world. Planning is pure for testing;
 * `runSlackSetup` performs the plan and records the bindings.
 *
 * `readiness` is what the admin console shows next to it: which scopes the workspace granted (from auth.test),
 * and whether the app is in each bound channel.
 */
import { randomUUID } from 'node:crypto';
import type { SlackReadiness, SlackSetupItem } from '@shared/api';
import { bindingSlot, type RoomBinding } from '@shared/domain/types';
import { TOWN_ID } from '@shared/world';
import { namesFor, scoreChannelName, spacesOf, type Space } from '../providers/spaces';
import type { Store } from '../store/store';
import type { SlackApi, SlackChannel } from './api';
import { SLACK_BOT_SCOPE_NEEDS } from './scopes';

export const slackLabel = (slot: 'voice' | 'text', name: string) => (slot === 'text' ? `#${name.replace(/^#/, '')}` : `🎧 #${name.replace(/^(🎧\s*)?#?/, '')}`);

export function planSlackSetup(spaces: Space[], channels: SlackChannel[], bindings: RoomBinding[], create: boolean): SlackSetupItem[] {
  const used = new Set(bindings.filter((b) => b.provider === 'slack').map((b) => b.externalChannelId));
  const live = channels.filter((c) => !c.is_archived);
  return spaces.map((space) => {
    const bound = bindings.find((b) => b.roomId === space.id && b.provider === 'slack');
    if (bound) {
      const ch = live.find((c) => c.id === bound.externalChannelId);
      return { spaceId: space.id, spaceName: space.name, action: 'kept', channelId: bound.externalChannelId, channelName: ch?.name ?? bound.label.replace(/^(🎧\s*)?#/, ''), inChannel: ch?.is_member, isPrivate: ch?.is_private };
    }
    // The town is the workspace's default channel: #general, or #all-<workspace> in newer workspaces (is_general).
    const best = live
      .filter((c) => !used.has(c.id))
      .map((c) => ({ c, s: space.id === TOWN_ID && c.is_general ? 4 : scoreChannelName(space, c.name) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.c.name.localeCompare(b.c.name))[0];
    if (best) {
      used.add(best.c.id);
      return { spaceId: space.id, spaceName: space.name, action: 'matched', channelId: best.c.id, channelName: best.c.name, inChannel: best.c.is_member, isPrivate: best.c.is_private };
    }
    // Slack always has a #general; if it wasn't found the app can't see it, which creating won't fix.
    const action = create && space.id !== TOWN_ID ? 'create' : 'skip';
    return { spaceId: space.id, spaceName: space.name, action, channelName: namesFor(space).text };
  });
}

type Api = Pick<SlackApi, 'conversations' | 'conversationsCreate' | 'conversationsJoin'>;

/** Perform a plan: create what's missing, join public channels, and bind every space (text + huddle). */
export async function runSlackSetup(opts: { store: Store; orgId: string; teamId: string; token: string; create: boolean; api: Api }): Promise<{ plan: SlackSetupItem[]; failed: Array<SlackSetupItem & { error: string }> }> {
  const d = opts.store.get(opts.orgId);
  const channels = await opts.api.conversations(opts.token);
  const plan = planSlackSetup(spacesOf(d.rooms), channels, d.bindings, opts.create);
  const failed: Array<SlackSetupItem & { error: string }> = [];
  for (const item of plan) {
    if (item.action === 'skip') continue;
    try {
      if (item.action === 'create') {
        const made = await opts.api.conversationsCreate(opts.token, item.channelName);
        item.channelId = made.id;
        item.channelName = made.name;
        item.inChannel = true;
        item.isPrivate = false;
      } else if (item.inChannel === false && !item.isPrivate) {
        await opts.api.conversationsJoin(opts.token, item.channelId!);
        item.inChannel = true;
        item.joined = true;
      }
      for (const slot of ['text', 'voice'] as const) {
        if (item.action === 'kept' && opts.store.bindingFor(opts.orgId, item.spaceId, slot)?.provider === 'slack') continue;
        opts.store.setBinding(
          opts.orgId,
          {
            id: randomUUID(),
            orgId: opts.orgId,
            roomId: item.spaceId,
            provider: 'slack',
            kind: slot,
            externalGuildId: opts.teamId,
            externalChannelId: item.channelId!,
            label: slackLabel(slot, item.channelName),
          },
          item.spaceId,
        );
      }
    } catch (e) {
      failed.push({ ...item, error: (e as Error).message });
    }
  }
  return { plan, failed };
}

type ReadinessApi = Pick<SlackApi, 'authTest' | 'conversationsInfo'>;

/** Granted scopes vs. the ones each feature needs, and whether the app is in every bound channel. */
export async function readiness(opts: { store: Store; orgId: string; teamId: string; token: string; api: ReadinessApi }): Promise<SlackReadiness> {
  const d = opts.store.get(opts.orgId);
  const auth = await opts.api.authTest(opts.token);
  const granted = new Set(auth.scopes);
  // Slack doesn't always send the scopes header through every proxy; with none, we can't judge and say so.
  const known = granted.size > 0;
  const scopes = SLACK_BOT_SCOPE_NEEDS.map((n) => ({ scope: n.scope, ok: known ? granted.has(n.scope) : null, neededFor: n.neededFor }));
  const spaces = [{ id: TOWN_ID, name: 'Town' }, ...d.rooms.map((r) => ({ id: r.id, name: r.name }))];
  const bound = d.bindings.filter((b) => b.provider === 'slack');
  const byChannel = new Map<string, { inChannel: boolean | null; isPrivate: boolean; name: string }>();
  for (const id of new Set(bound.map((b) => b.externalChannelId))) {
    try {
      const c = await opts.api.conversationsInfo(opts.token, id);
      byChannel.set(id, { inChannel: !!c.is_member, isPrivate: !!c.is_private, name: c.name });
    } catch {
      byChannel.set(id, { inChannel: null, isPrivate: false, name: bound.find((b) => b.externalChannelId === id)?.label.replace(/^(🎧\s*)?#/, '') ?? id });
    }
  }
  const channels = spaces.flatMap((s) => {
    const ids = [...new Set(bound.filter((b) => b.roomId === s.id).map((b) => b.externalChannelId))];
    return ids.map((id) => {
      const c = byChannel.get(id)!;
      return { spaceId: s.id, spaceName: s.name, channelId: id, channelName: c.name, slots: bound.filter((b) => b.roomId === s.id && b.externalChannelId === id).map((b) => bindingSlot(b.kind)), inChannel: c.inChannel, isPrivate: c.isPrivate };
    });
  });
  return { botUserId: auth.user_id, teamName: auth.team, scopesKnown: known, scopes, channels };
}
