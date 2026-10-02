/**
 * Channels for every space, in one click: match the server's existing channels to the town and each
 * room by name, and (optionally) create what's missing in a "Minglewood" category. Planning is pure
 * so it's easy to test; `runSetup` performs the plan against Discord and records the bindings.
 */
import { randomUUID } from 'node:crypto';
import { bindingSlot, type BindingSlot, type RoomBinding } from '@shared/domain/types';
import type { Store } from '../../store/store';
import { namesFor, scoreChannelName, slug, spacesOf, type Space } from '../spaces';
import { ChannelType, discordApi, type DiscordChannel } from './api';

export { namesFor, slug, spacesOf, type Space } from '../spaces';

export interface PlanItem {
  spaceId: string;
  spaceName: string;
  slot: BindingSlot;
  /** kept: already bound · matched: an existing channel fits · create: will be created · skip: none and not creating */
  action: 'kept' | 'matched' | 'create' | 'skip';
  channelId?: string;
  channelName: string;
}

const isText = (c: DiscordChannel) => c.type === ChannelType.GUILD_TEXT;
const isVoice = (c: DiscordChannel) => c.type === ChannelType.GUILD_VOICE || c.type === ChannelType.GUILD_STAGE_VOICE;

const score = (space: Space, channel: DiscordChannel) => scoreChannelName(space, channel.name ?? '');

export function planSetup(spaces: Space[], channels: DiscordChannel[], bindings: RoomBinding[], create: boolean): PlanItem[] {
  const used = new Set(bindings.filter((b) => b.provider === 'discord').map((b) => b.externalChannelId));
  const plan: PlanItem[] = [];
  for (const slot of ['text', 'voice'] as const) {
    for (const space of spaces) {
      const names = namesFor(space);
      const bound = bindings.find((b) => b.roomId === space.id && bindingSlot(b.kind) === slot);
      if (bound) {
        plan.push({ spaceId: space.id, spaceName: space.name, slot, action: 'kept', channelId: bound.externalChannelId, channelName: bound.label });
        continue;
      }
      const best = channels
        .filter((c) => (slot === 'text' ? isText(c) : isVoice(c)) && !used.has(c.id))
        .map((c) => ({ c, s: score(space, c) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || (a.c.position ?? 0) - (b.c.position ?? 0))[0];
      if (best) {
        used.add(best.c.id);
        plan.push({ spaceId: space.id, spaceName: space.name, slot, action: 'matched', channelId: best.c.id, channelName: best.c.name ?? '' });
      } else {
        plan.push({ spaceId: space.id, spaceName: space.name, slot, action: create ? 'create' : 'skip', channelName: slot === 'text' ? names.text : names.voice });
      }
    }
  }
  return plan;
}

export const labelFor = (slot: BindingSlot, name: string) => (slot === 'text' ? `#${name.replace(/^#/, '')}` : `🔊 ${name.replace(/^🔊\s*/, '')}`);

type Api = Pick<typeof discordApi, 'guildChannels' | 'createChannel'>;

/** Perform a plan: create what's missing (under a "Minglewood" category) and bind every space. */
export async function runSetup(opts: {
  store: Store;
  orgId: string;
  guildId: string;
  token: string;
  create: boolean;
  api?: Api;
}): Promise<{ plan: PlanItem[]; failed: Array<PlanItem & { error: string }> }> {
  const api = opts.api ?? discordApi;
  const d = opts.store.get(opts.orgId);
  const channels = await api.guildChannels(opts.token, opts.guildId);
  const plan = planSetup(spacesOf(d.rooms), channels, d.bindings, opts.create);
  const failed: Array<PlanItem & { error: string }> = [];
  let category = channels.find((c) => c.type === ChannelType.GUILD_CATEGORY && slug(c.name ?? '') === 'minglewood');
  for (const item of plan) {
    if (item.action === 'kept' || item.action === 'skip') continue;
    try {
      if (item.action === 'create') {
        category ??= await api.createChannel(opts.token, opts.guildId, { name: 'Minglewood', type: ChannelType.GUILD_CATEGORY });
        const made = await api.createChannel(opts.token, opts.guildId, {
          name: item.channelName,
          type: item.slot === 'text' ? ChannelType.GUILD_TEXT : ChannelType.GUILD_VOICE,
          parent_id: category.id,
          ...(item.slot === 'text' ? { topic: `${item.spaceName} in Minglewood — what's said here shows up in the world, and the other way round.` } : {}),
        });
        item.channelId = made.id;
        item.channelName = made.name ?? item.channelName;
      }
      opts.store.setBinding(opts.orgId, {
        id: randomUUID(),
        orgId: opts.orgId,
        roomId: item.spaceId,
        provider: 'discord',
        kind: item.slot === 'text' ? 'text' : 'voice',
        externalGuildId: opts.guildId,
        externalChannelId: item.channelId!,
        label: labelFor(item.slot, item.channelName),
      }, item.spaceId);
    } catch (e) {
      failed.push({ ...item, error: (e as Error).message });
    }
  }
  return { plan, failed };
}

/** The bot's server-wide permissions: @everyone + its roles, everything if administrator or owner. */
export function effectivePermissions(opts: { guildId: string; ownerId: string; botId: string; roles: Array<{ id: string; permissions: string }>; botRoleIds: string[] }): bigint {
  if (opts.ownerId === opts.botId) return ~0n;
  let perms = 0n;
  for (const r of opts.roles) if (r.id === opts.guildId || opts.botRoleIds.includes(r.id)) perms |= BigInt(r.permissions);
  return perms & (1n << 3n) ? ~0n : perms;
}
