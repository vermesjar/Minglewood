import { Router } from 'express';
import { z } from 'zod';
import { BRAND } from '@shared/brand';
import type { Member, RoomBinding } from '@shared/domain/types';
import { loadoutSchema, outfitsSchema } from '@shared/protocol';
import { sanitizeLoadout } from '@shared/avatar';
import { DECOR_BY_ID, MAX_DECOR_PER_ROOM, placementProblem } from '@shared/world/decor';
import { randomUUID } from 'node:crypto';
import { config, discordConfigured } from '../config';
import { requireMember, type AppContext, authed } from '../context';
import type { BindingView, PublicMember } from '@shared/api';


export function toPublic(m: Member): PublicMember {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { settings, outfits, ...rest } = m;
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
      decorations: d.decorations,
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

  /** Saved looks ("vibe of the day"). Each loadout is validated against the member's unlocks. */
  r.put('/me/outfits', auth, (req, res) => {
    const { orgId, member } = authed(req);
    const body = outfitsSchema.safeParse(req.body?.outfits);
    if (!body.success) return res.status(400).json({ error: 'invalid outfits' });
    const outfits = body.data.map((o) => ({ ...o, loadout: sanitizeLoadout(o.loadout, member.unlockedItems) }));
    const updated = ctx.store.updateMember(orgId, member.id, { outfits });
    res.json({ outfits: updated.outfits });
  });

  /** Team-owned rooms: members of the owning team (or admins) can decorate. */
  const canDecorate = (orgId: string, memberId: string, roomId: string) => {
    const m = ctx.store.member(orgId, memberId);
    const room = ctx.store.get(orgId).rooms.find((r) => r.id === roomId);
    if (!m || !room) return false;
    return m.role !== 'member' || (!!room.ownerTeamId && room.ownerTeamId === m.teamId);
  };

  r.post('/rooms/:roomId/decor', auth, (req, res) => {
    const { orgId, member } = authed(req);
    const roomId = req.params.roomId;
    const body = z.object({ itemId: z.string().max(40), x: z.number().int(), y: z.number().int() }).safeParse(req.body);
    if (!body.success || !DECOR_BY_ID.has(body.data.itemId)) return res.status(400).json({ error: 'invalid input' });
    if (!canDecorate(orgId, member.id, roomId)) return res.status(403).json({ error: 'Only the team that owns this room can decorate it.' });
    const d = ctx.store.get(orgId);
    if (d.decorations.filter((x) => x.roomId === roomId).length >= MAX_DECOR_PER_ROOM)
      return res.status(409).json({ error: 'This room is fully decorated — remove something first.' });
    const hub = ctx.hubs.get(orgId)!;
    const scene = hub.scene(roomId);
    if (!scene) return res.status(404).json({ error: 'room not found' });
    const occupied = new Set(hub.actorsIn(roomId).map((a) => `${Math.round(a.x)},${Math.round(a.y)}`));
    const problem = placementProblem(scene, body.data.x, body.data.y, occupied);
    if (problem) return res.status(409).json({ error: problem });
    const decoration = {
      id: randomUUID().slice(0, 8),
      roomId,
      itemId: body.data.itemId,
      x: body.data.x,
      y: body.data.y,
      placedBy: member.id,
      placedAt: new Date().toISOString(),
    };
    ctx.store.addDecoration(orgId, decoration);
    ctx.store.audit(orgId, member.id, 'decor.added', roomId, body.data.itemId);
    hub.decorChanged(roomId, member.id);
    res.json({ decoration });
  });

  r.delete('/rooms/:roomId/decor/:id', auth, (req, res) => {
    const { orgId, member } = authed(req);
    if (!canDecorate(orgId, member.id, req.params.roomId)) return res.status(403).json({ error: 'not your team’s room' });
    const found = ctx.store.get(orgId).decorations.find((x) => x.id === req.params.id && x.roomId === req.params.roomId);
    if (!found) return res.status(404).json({ error: 'not found' });
    ctx.store.removeDecoration(orgId, found.id);
    ctx.store.audit(orgId, member.id, 'decor.removed', req.params.roomId, found.itemId);
    ctx.hubs.get(orgId)?.decorChanged(req.params.roomId, member.id);
    res.json({ ok: true });
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
