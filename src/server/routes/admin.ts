import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config, discordBotConfigured, discordConfigured } from '../config';
import { TOWN_ID } from '@shared/world';
import { discordApi } from '../providers/discord/api';
import { DISCORD_BOT_PERMISSION_BITS } from '../providers/discord/provider';
import { effectivePermissions, runSetup } from '../providers/discord/setup';
import { requireAdmin, requireMember, type AppContext, authed } from '../context';
import { bindingView } from './api';
import { DiscordApiError } from '../providers/discord/api';
import { nextFreeSlot } from '@shared/world/memory';
import { slackAdminStatus } from '../slack/routes';

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
      artifacts: d.artifacts,
      members: [...d.members.values()].map((m) => ({ id: m.id, displayName: m.displayName, teamId: m.teamId })),
      audit: d.audit.slice(0, 50),
      memberCount: d.members.size,
      discord: {
        configured: discordConfigured(),
        botConfigured: discordBotConfigured(),
        installUrl: discordConfigured() ? ctx.discord.botInstallUrl() : null,
        capabilities: ctx.discord.capabilities,
      },
      slack: slackAdminStatus(ctx, orgId),
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
    z.object({ remove: z.literal(true), slot: z.enum(['voice', 'text']).optional() }),
    z.object({
      provider: z.enum(['discord', 'slack', 'demo']),
      kind: z.enum(['voice', 'text', 'stage', 'activity']),
      externalChannelId: z.string().trim().min(1).max(40),
      label: z.string().trim().min(1).max(60),
    }),
  ]);

  r.put('/bindings/:roomId', async (req, res) => {
    const { orgId, member } = authed(req);
    const d = ctx.store.get(orgId);
    const roomId = req.params.roomId;
    // The town is a space too: its channels are the company's "general".
    if (roomId !== TOWN_ID && !d.rooms.some((x) => x.id === roomId)) return res.status(404).json({ error: 'room not found' });
    const body = bindingSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid input' });
    if ('remove' in body.data) {
      ctx.store.setBinding(orgId, null, roomId, body.data.slot);
      ctx.store.audit(orgId, member.id, 'binding.removed', roomId, body.data.slot);
      return res.json({ ok: true });
    }
    const guild = d.connections.find((c) => c.provider === 'discord' && c.status === 'active');
    if (body.data.provider === 'discord' && !guild) return res.status(400).json({ error: 'connect a Discord server first' });
    const slackTeam = ctx.slack.teamFor(orgId);
    if (body.data.provider === 'slack' && !slackTeam) return res.status(400).json({ error: 'connect a Slack workspace first' });
    const binding = {
      id: randomUUID(),
      orgId,
      roomId,
      ...body.data,
      externalGuildId: body.data.provider === 'discord' ? guild!.externalWorkspaceId : body.data.provider === 'slack' ? slackTeam : undefined,
    };
    ctx.store.setBinding(orgId, binding, roomId);
    ctx.store.audit(orgId, member.id, 'binding.set', roomId, `${binding.provider}:${binding.externalChannelId}`);
    // Slack only tells apps about channels they're in: join the public channel now (private ones need an /invite).
    const inChannel = binding.provider === 'slack' ? await ctx.slack.bridge.ensureInChannel(orgId, binding.externalChannelId) : undefined;
    ctx.hubs.get(orgId)?.bindingsChanged();
    res.json({ binding: bindingView(ctx, binding), inChannel });
  });

  r.get('/channels', async (req, res) => {
    const { orgId } = authed(req);
    const provider = req.query.provider === 'discord' ? 'discord' : req.query.provider === 'slack' ? 'slack' : 'demo';
    if (provider === 'demo') return res.json({ channels: await ctx.demo.listChannels() });
    if (provider === 'slack') {
      const team = ctx.slack.teamFor(orgId);
      if (!team) return res.json({ channels: [] });
      return res.json({ channels: await ctx.slack.provider.listChannels(team).catch(() => []) });
    }
    const conn = ctx.store.get(orgId).connections.find((c) => c.provider === 'discord' && c.status === 'active');
    if (!conn) return res.json({ channels: [] });
    try {
      res.json({ channels: await ctx.discord.listChannels(conn.externalWorkspaceId) });
    } catch (e) {
      res.status(502).json({ error: e instanceof DiscordApiError ? `Discord said ${e.status}` : 'failed' });
    }
  });

  /** Can the bot do everything the bridge needs in this server? (Server-wide; channel overrides can still deny.) */
  r.get('/discord/permissions', async (req, res) => {
    const { orgId } = authed(req);
    const conn = ctx.store.get(orgId).connections.find((c) => c.provider === 'discord' && c.status === 'active');
    if (!conn || !discordBotConfigured()) return res.json({ connected: false, items: [], installUrl: config.discord.clientId ? ctx.discord.botInstallUrl() : null });
    try {
      const token = config.discord.botToken;
      const [guild, roles, me] = await Promise.all([
        discordApi.guild(token, conn.externalWorkspaceId),
        discordApi.guildRoles(token, conn.externalWorkspaceId),
        discordApi.botUser(token),
      ]);
      const botMember = await discordApi.guildMember(token, conn.externalWorkspaceId, me.id);
      const perms = effectivePermissions({ guildId: guild.id, ownerId: guild.owner_id, botId: me.id, roles, botRoleIds: botMember.roles });
      const why: Record<string, string> = {
        'View Channels': 'See the server’s channels and who’s in voice',
        'Read Message History': 'Load a space’s recent conversation when you walk in',
        'Send Messages': 'Post what’s said in the world to the space’s channel',
        'Embed Links': 'Post links from the world with previews',
        'Manage Webhooks': 'Post under each person’s own name and picture',
        Connect: 'Needed alongside Move Members for voice follow',
        'Move Members': 'Move you between voice channels as you walk between spaces',
        'Manage Channels': 'One-click “set up channels for every space”',
      };
      const items = Object.entries(DISCORD_BOT_PERMISSION_BITS).map(([name, bit]) => ({ name, ok: (perms & bit) !== 0n, neededFor: why[name] ?? '' }));
      res.json({
        connected: true,
        guild: { id: guild.id, name: guild.name },
        items,
        messageContent: ctx.discordBridge?.messageContent ?? true,
        installUrl: ctx.discord.botInstallUrl(),
      });
    } catch (e) {
      res.status(502).json({ error: e instanceof DiscordApiError ? `Discord said ${e.status}` : 'failed' });
    }
  });

  /** Match (and optionally create) a text and a voice channel for the town and every room. */
  r.post('/discord/setup', async (req, res) => {
    const { orgId, member } = authed(req);
    const body = z.object({ create: z.boolean() }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid input' });
    const conn = ctx.store.get(orgId).connections.find((c) => c.provider === 'discord' && c.status === 'active');
    if (!conn || !discordBotConfigured()) return res.status(400).json({ error: 'connect a Discord server first' });
    try {
      const result = await runSetup({ store: ctx.store, orgId, guildId: conn.externalWorkspaceId, token: config.discord.botToken, create: body.data.create });
      const done = result.plan.filter((p) => p.action === 'matched' || p.action === 'create').length - result.failed.length;
      ctx.store.audit(orgId, member.id, 'discord.setup', conn.externalWorkspaceId, `${done} channels bound${result.failed.length ? `, ${result.failed.length} failed` : ''}`);
      ctx.hubs.get(orgId)?.bindingsChanged();
      res.json(result);
    } catch (e) {
      res.status(502).json({ error: e instanceof DiscordApiError ? `Discord said ${e.status}` : (e as Error).message });
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

  /** Commemorate a moment: the company's history becomes a physical artifact in a room. */
  r.post('/artifacts', (req, res) => {
    const { orgId, member } = authed(req);
    const body = z
      .object({
        title: z.string().trim().min(1).max(80),
        story: z.string().trim().min(1).max(600),
        kind: z.enum(['launch', 'award', 'offsite', 'milestone', 'tenure', 'tradition']),
        roomId: z.string().max(40),
        occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        contributorIds: z.array(z.string().max(40)).max(30).default([]),
        teamIds: z.array(z.string().max(40)).max(10).default([]),
      })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid input' });
    const d = ctx.store.get(orgId);
    if (!d.rooms.some((x) => x.id === body.data.roomId)) return res.status(404).json({ error: 'room not found' });
    const slot = nextFreeSlot(body.data.roomId, d.artifacts);
    if (!slot) return res.status(409).json({ error: 'This room’s memory wall is full — try another room.' });
    const id = `art-${randomUUID().slice(0, 8)}`;
    const artifact = {
      id,
      orgId,
      sceneId: body.data.roomId,
      objectId: `mem-${id}`,
      title: body.data.title,
      story: body.data.story,
      kind: body.data.kind,
      occurredAt: body.data.occurredAt,
      contributorIds: body.data.contributorIds.filter((c) => d.members.has(c)),
      teamIds: body.data.teamIds.filter((t) => d.teams.some((x) => x.id === t)),
      addedBy: member.id,
      placement: slot,
    };
    ctx.store.addArtifact(orgId, artifact);
    ctx.store.audit(orgId, member.id, 'artifact.added', id, artifact.title);
    ctx.hubs.get(orgId)?.artifactsChanged(id);
    res.json({ artifact });
  });

  return r;
}
