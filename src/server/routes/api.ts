import { Router } from 'express';
import { z } from 'zod';
import { BRAND } from '@shared/brand';
import type { Member, RoomBinding } from '@shared/domain/types';
import { loadoutSchema, outfitsSchema } from '@shared/protocol';
import { sanitizeLoadout } from '@shared/avatar';
import { decorItem, decorObject, MAX_DECOR_PER_ROOM, placementProblem, wallPlacementProblem, withoutDecoration, type Decoration } from '@shared/world/decor';
import { serverArt } from '../art';
import { randomUUID } from 'node:crypto';
import { config, discordConfigured, slackConfigured } from '../config';
import { requireMember, type AppContext, authed } from '../context';
import type { BindingView, PublicMember } from '@shared/api';


export function toPublic(m: Member): PublicMember {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { settings, outfits, ...rest } = m;
  return rest;
}

export function bindingView(ctx: AppContext, b: RoomBinding): BindingView {
  const provider = b.provider === 'discord' ? ctx.discord : b.provider === 'slack' ? ctx.slack.provider : ctx.demo;
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
      voiceFollow: z.boolean().optional(),
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
      slack: { enabled: slackConfigured(), addUrl: ctx.slack.addUrl() },
      installUrl: config.installUrl || null,
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
        slack: slackConfigured() || config.slack.mock ? ctx.slack.provider.capabilities : null,
        demo: ctx.demo.capabilities,
      },
      discordConnected: d.connections.some((c) => c.provider === 'discord' && c.status === 'active'),
      slackConnected: !!ctx.slack.connection(orgId),
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

  /** Where a piece goes: a floor tile, or a wall (its span starting at x on the right wall, y on the left). */
  const decorBody = z.object({ itemId: z.string().max(80), x: z.number().int(), y: z.number().int(), wall: z.enum(['left', 'right']).optional() });

  /**
   * Why a piece can't go there (or null): the same checks decorate mode ran on the player's screen (decor.ts),
   * against the room as it is — without the piece itself when it's being moved.
   */
  const decorProblem = (orgId: string, roomId: string, spot: z.infer<typeof decorBody>, moving?: string): string | null => {
    const hub = ctx.hubs.get(orgId)!;
    const lived = hub.scene(roomId);
    if (!lived) return 'room not found';
    const scene = moving ? withoutDecoration(lived, moving) : lived;
    const item = decorItem(spot.itemId)!;
    const art = serverArt();
    if (item.wall || spot.wall) {
      if (!item.wall || !spot.wall) return item.wall ? 'That hangs on a wall.' : 'That goes on the floor.';
      if ((spot.wall === 'right' ? spot.y : spot.x) !== 0) return 'That spot is off the wall.';
      return wallPlacementProblem(scene, item, spot.wall, spot.wall === 'right' ? spot.x : spot.y, art);
    }
    const occupied = new Set(hub.actorsIn(roomId).map((a) => `${Math.round(a.x)},${Math.round(a.y)}`));
    const piece = decorObject({ id: 'ghost', roomId, itemId: spot.itemId, x: spot.x, y: spot.y, placedBy: '', placedAt: '' }) ?? undefined;
    return placementProblem(scene, spot.x, spot.y, occupied, piece, art);
  };

  r.post('/rooms/:roomId/decor', auth, (req, res) => {
    const { orgId, member } = authed(req);
    const roomId = req.params.roomId;
    serverArt(); // (the wall catalog follows the art on disk)
    const body = decorBody.safeParse(req.body);
    if (!body.success || !decorItem(body.data.itemId)) return res.status(400).json({ error: 'invalid input' });
    if (!canDecorate(orgId, member.id, roomId)) return res.status(403).json({ error: 'Only the team that owns this room can decorate it.' });
    const d = ctx.store.get(orgId);
    if (d.decorations.filter((x) => x.roomId === roomId).length >= MAX_DECOR_PER_ROOM)
      return res.status(409).json({ error: 'This room is fully decorated — remove something first.' });
    const hub = ctx.hubs.get(orgId)!;
    if (!hub.scene(roomId)) return res.status(404).json({ error: 'room not found' });
    const problem = decorProblem(orgId, roomId, body.data);
    if (problem) return res.status(409).json({ error: problem });
    const decoration: Decoration = {
      id: randomUUID().slice(0, 8),
      roomId,
      itemId: body.data.itemId,
      x: body.data.x,
      y: body.data.y,
      ...(body.data.wall ? { wall: body.data.wall } : {}),
      placedBy: member.id,
      placedAt: new Date().toISOString(),
    };
    ctx.store.addDecoration(orgId, decoration);
    ctx.store.audit(orgId, member.id, 'decor.added', roomId, body.data.itemId);
    hub.decorChanged(roomId, member.id);
    res.json({ decoration });
  });

  /** Move a team piece: to another tile, or along (or across to the other) wall. */
  r.patch('/rooms/:roomId/decor/:id', auth, (req, res) => {
    const { orgId, member } = authed(req);
    const roomId = req.params.roomId;
    serverArt();
    if (!canDecorate(orgId, member.id, roomId)) return res.status(403).json({ error: 'not your team’s room' });
    const found = ctx.store.get(orgId).decorations.find((x) => x.id === req.params.id && x.roomId === roomId);
    if (!found) return res.status(404).json({ error: 'not found' });
    const body = decorBody.safeParse({ ...req.body, itemId: found.itemId });
    if (!body.success || !decorItem(found.itemId)) return res.status(400).json({ error: 'invalid input' });
    const problem = decorProblem(orgId, roomId, body.data, found.id);
    if (problem) return res.status(409).json({ error: problem });
    const moved = ctx.store.moveDecoration(orgId, found.id, { x: body.data.x, y: body.data.y, wall: body.data.wall });
    ctx.store.audit(orgId, member.id, 'decor.moved', roomId, found.itemId);
    ctx.hubs.get(orgId)?.decorChanged(roomId, member.id);
    res.json({ decoration: moved });
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
