import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { discordBotConfigured, discordConfigured } from '../config';
import { requireAdmin, requireMember, type AppContext, authed } from '../context';
import { bindingView } from './api';
import { DiscordApiError } from '../providers/discord/api';

/**
 * Admin console API. Every mutation is org-scoped by the session and recorded in the audit log.
 * Note what is *not* here: no per-person activity, attendance, or time-online reporting.
 */
export function adminRoutes(ctx: AppContext, onDiscordConnected: (orgId: string) => void): Router {
  const r = Router();
  r.use(requireMember(ctx), requireAdmin);

  r.get('/overview', (req, res) => {
    const { orgId } = authed(req);
    const d = ctx.store.get(orgId);
    res.json({
      org: d.org,
      rooms: d.rooms,
      teams: d.teams,
      departments: d.departments,
      bindings: d.bindings.map((b) => bindingView(ctx, b)),
      connections: d.connections,
      events: d.events,
      audit: d.audit.slice(0, 50),
      memberCount: d.members.size,
      discord: {
        configured: discordConfigured(),
        botConfigured: discordBotConfigured(),
        installUrl: discordConfigured() ? ctx.discord.botInstallUrl() : null,
        capabilities: ctx.discord.capabilities,
      },
    });
  });

  r.put('/org', (req, res) => {
    const { orgId, member } = authed(req);
    const body = z.object({ name: z.string().trim().min(1).max(60), tagline: z.string().trim().max(120) }).partial().safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid input' });
    const org = ctx.store.updateOrg(orgId, body.data);
    ctx.store.audit(orgId, member.id, 'org.updated', orgId, JSON.stringify(body.data));
    res.json({ org });
  });

  r.put('/rooms/:roomId', (req, res) => {
    const { orgId, member } = authed(req);
    const body = z
      .object({ name: z.string().trim().min(1).max(40), description: z.string().trim().max(200), ownerTeamId: z.string().max(40).optional() })
      .partial()
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid input' });
    try {
      const room = ctx.store.updateRoom(orgId, req.params.roomId, body.data);
      ctx.store.audit(orgId, member.id, 'room.updated', room.id, JSON.stringify(body.data));
      res.json({ room });
    } catch {
      res.status(404).json({ error: 'room not found' });
    }
  });

  const bindingSchema = z.union([
    z.object({ remove: z.literal(true) }),
    z.object({
      provider: z.enum(['discord', 'demo']),
      kind: z.enum(['voice', 'text', 'stage', 'activity']),
      externalChannelId: z.string().trim().min(1).max(40),
      label: z.string().trim().min(1).max(60),
    }),
  ]);

  r.put('/bindings/:roomId', (req, res) => {
    const { orgId, member } = authed(req);
    const d = ctx.store.get(orgId);
    const roomId = req.params.roomId;
    if (!d.rooms.some((x) => x.id === roomId)) return res.status(404).json({ error: 'room not found' });
    const body = bindingSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid input' });
    if ('remove' in body.data) {
      ctx.store.setBinding(orgId, null, roomId);
      ctx.store.audit(orgId, member.id, 'binding.removed', roomId);
      return res.json({ ok: true });
    }
    const guild = d.connections.find((c) => c.provider === 'discord' && c.status === 'active');
    if (body.data.provider === 'discord' && !guild) return res.status(400).json({ error: 'connect a Discord server first' });
    const binding = {
      id: randomUUID(),
      orgId,
      roomId,
      ...body.data,
      externalGuildId: body.data.provider === 'discord' ? guild!.externalWorkspaceId : undefined,
    };
    ctx.store.setBinding(orgId, binding, roomId);
    ctx.store.audit(orgId, member.id, 'binding.set', roomId, `${binding.provider}:${binding.externalChannelId}`);
    res.json({ binding: bindingView(ctx, binding) });
  });

  r.get('/channels', async (req, res) => {
    const { orgId } = authed(req);
    const provider = req.query.provider === 'discord' ? 'discord' : 'demo';
    if (provider === 'demo') return res.json({ channels: await ctx.demo.listChannels() });
    const conn = ctx.store.get(orgId).connections.find((c) => c.provider === 'discord' && c.status === 'active');
    if (!conn) return res.json({ channels: [] });
    try {
      res.json({ channels: await ctx.discord.listChannels(conn.externalWorkspaceId) });
    } catch (e) {
      res.status(502).json({ error: e instanceof DiscordApiError ? `Discord said ${e.status}` : 'failed' });
    }
  });

  r.get('/discord/guilds', async (_req, res) => {
    try {
      res.json({ guilds: await ctx.discord.listGuilds() });
    } catch (e) {
      res.status(502).json({ error: e instanceof DiscordApiError ? `Discord said ${e.status}` : 'failed' });
    }
  });

  r.post('/discord/connect', async (req, res) => {
    const { orgId, member } = authed(req);
    const body = z.object({ guildId: z.string().regex(/^\d{5,25}$/) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid guild id' });
    try {
      const guilds = await ctx.discord.listGuilds();
      const guild = guilds.find((g) => g.id === body.data.guildId);
      if (!guild) return res.status(400).json({ error: 'The Minglewood bot is not in that server yet — install it first.' });
      const conn = {
        id: randomUUID(),
        orgId,
        provider: 'discord' as const,
        externalWorkspaceId: guild.id,
        displayName: guild.name,
        connectedAt: new Date().toISOString(),
        connectedBy: member.id,
        status: 'active' as const,
      };
      ctx.store.setConnection(orgId, conn);
      ctx.store.audit(orgId, member.id, 'discord.connected', guild.id, guild.name);
      onDiscordConnected(orgId);
      res.json({ connection: conn });
    } catch (e) {
      res.status(502).json({ error: e instanceof DiscordApiError ? `Discord said ${e.status}` : 'failed' });
    }
  });

  r.post('/events', (req, res) => {
    const { orgId, member } = authed(req);
    const body = z
      .object({
        title: z.string().trim().min(1).max(80),
        kind: z.enum(['birthday', 'launch', 'allhands', 'social', 'anniversary', 'demo-day']),
        roomId: z.string().max(40),
        startsAt: z.string().datetime(),
        durationMin: z.number().int().min(5).max(24 * 60),
        description: z.string().trim().max(300).default(''),
      })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid input' });
    const d = ctx.store.get(orgId);
    if (!d.rooms.some((x) => x.id === body.data.roomId)) return res.status(404).json({ error: 'room not found' });
    const start = Date.parse(body.data.startsAt);
    const decor = body.data.kind === 'birthday' || body.data.kind === 'anniversary' || body.data.kind === 'social' ? 'balloons' : body.data.kind === 'launch' ? 'launch' : 'stage';
    const ev = {
      id: `ev-${randomUUID().slice(0, 8)}`,
      orgId,
      title: body.data.title,
      kind: body.data.kind,
      roomId: body.data.roomId,
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + body.data.durationMin * 60_000).toISOString(),
      hostIds: [member.id],
      description: body.data.description,
      decor: decor as 'balloons' | 'launch' | 'stage',
    };
    ctx.store.addEvent(orgId, ev);
    ctx.store.audit(orgId, member.id, 'event.created', ev.id, ev.title);
    ctx.hubs.get(orgId)?.eventsChanged();
    res.json({ event: ev });
  });

  return r;
}
