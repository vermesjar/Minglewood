import { Router } from 'express';
import { z } from 'zod';
import { BRAND } from '@shared/brand';
import type { Member, RoomBinding } from '@shared/domain/types';
import { loadoutSchema } from '@shared/protocol';
import { config, discordConfigured } from '../config';
import { requireMember, type AppContext, authed } from '../context';
import type { BindingView, PublicMember } from '@shared/api';


export function toPublic(m: Member): PublicMember {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { settings, ...rest } = m;
  return rest;
}

export function bindingView(ctx: AppContext, b: RoomBinding): BindingView {
  const provider = b.provider === 'discord' ? ctx.discord : ctx.demo;
  return { ...b, join: provider.joinInstruction(b) };
}

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  title: z.string().trim().min(1).max(60).optional(),
  pronouns: z.string().trim().max(20).optional(),
  location: z.string().trim().max(40).optional(),
  interests: z.array(z.string().trim().min(1).max(30)).max(8).optional(),
  askMeAbout: z.array(z.string().trim().min(1).max(40)).max(6).optional(),
  settings: z
    .object({
      locationVisibility: z.enum(['everyone', 'team', 'nobody']),
      knocksWhileFocused: z.boolean(),
      reducedMotion: z.boolean().optional(),
    })
    .partial()
    .optional(),
});

export function apiRoutes(ctx: AppContext): Router {
  const r = Router();
  const auth = requireMember(ctx);

  r.get('/health', (_req, res) => res.json({ ok: true }));

  /** Public config: what the landing screen needs before sign-in. */
  r.get('/config', (_req, res) => {
    res.json({
      brand: BRAND,
      demoMode: config.demoMode,
      discord: { enabled: discordConfigured(), clientId: config.discord.clientId || null },
    });
  });

  r.get('/bootstrap', auth, (req, res) => {
    const { orgId, member } = authed(req);
    const d = ctx.store.get(orgId);
    res.json({
      org: d.org,
      world: d.world,
      departments: d.departments,
      teams: d.teams,
      rooms: d.rooms,
      members: [...d.members.values()].map(toPublic),
      bindings: d.bindings.map((b) => bindingView(ctx, b)),
      events: d.events,
      artifacts: d.artifacts,
      me: member,
      capabilities: {
        discord: discordConfigured() ? ctx.discord.capabilities : null,
        demo: ctx.demo.capabilities,
      },
      discordConnected: d.connections.some((c) => c.provider === 'discord' && c.status === 'active'),
    });
  });

  r.patch('/me', auth, (req, res) => {
    const { orgId, member } = authed(req);
    const body = profileSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid input' });
    const { settings, ...rest } = body.data;
    const updated = ctx.store.updateMember(orgId, member.id, {
      ...rest,
      settings: { ...member.settings, ...(settings ?? {}) },
    });
    ctx.hubs.get(orgId)?.profileChanged(member.id);
    res.json({ me: updated });
  });

  r.put('/me/avatar', auth, (req, res) => {
    const { orgId, member } = authed(req);
    const body = loadoutSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid loadout' });
    ctx.hubs.get(orgId)?.setAvatar(member.id, body.data);
    res.json({ avatar: ctx.store.member(orgId, member.id)?.avatar });
  });

  /** Resolve an Activity launch context (guild/channel) to the room bound to it. */
  r.get('/discord/context', auth, (req, res) => {
    const { orgId } = authed(req);
    const channelId = String(req.query.channelId ?? '');
    const b = ctx.store.get(orgId).bindings.find((x) => x.provider === 'discord' && x.externalChannelId === channelId);
    res.json({ roomId: b?.roomId ?? null });
  });

  return r;
}
