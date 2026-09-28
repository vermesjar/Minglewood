import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { loadoutFromSeed } from '@shared/avatar';
import { ORG_ID } from '@shared/seed/northstar';
import type { Member } from '@shared/domain/types';
import { clearSessionCookie, issueToken, parseCookies, sessionCookie } from '../auth/session';
import { config, discordConfigured } from '../config';
import type { AppContext } from '../context';
import { KeyedLimiter } from '../realtime/rateLimit';
import type { ExternalIdentityProfile } from '../providers/types';

const demoLimiter = new KeyedLimiter(30, 3600_000);
const oauthLimiter = new KeyedLimiter(60, 600_000);
const STATE_COOKIE = 'mw_oauth_state';

const demoSchema = z.object({
  name: z.string().trim().min(1).max(40),
  teamId: z.string().max(40).optional(),
  interests: z.array(z.string().trim().min(1).max(30)).max(6).optional(),
  admin: z.boolean().optional(),
});

/** The org a Discord login belongs to: the one connected to our configured/connected guild. */
function discordGuildFor(ctx: AppContext): { orgId: string; guildId: string | undefined } {
  const conn = ctx.store.get(ORG_ID).connections.find((c) => c.provider === 'discord' && c.status === 'active');
  return { orgId: ORG_ID, guildId: conn?.externalWorkspaceId ?? (config.discord.guildId || undefined) };
}

function managerFor(ctx: AppContext, orgId: string, teamId: string): string | undefined {
  const team = ctx.store.members(orgId).filter((m) => m.teamId === teamId && m.simulated);
  const managedBy = new Map<string, number>();
  for (const m of team) if (m.managerId) managedBy.set(m.managerId, (managedBy.get(m.managerId) ?? 0) + 1);
  return [...managedBy.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Links (or creates) the Minglewood member for a verified Discord identity. */
export function upsertDiscordMember(ctx: AppContext, orgId: string, p: ExternalIdentityProfile): Member {
  const existing = ctx.store.identity(orgId, 'discord', p.externalId);
  const known = existing && ctx.store.member(orgId, existing.memberId);
  if (known) return known;
  const admin = config.discord.adminUserIds.includes(p.externalId);
  const member = ctx.store.createMember(orgId, {
    displayName: p.displayName.slice(0, 40),
    title: 'Teammate',
    departmentId: 'dep-eng',
    teamId: 'team-aurora',
    managerId: managerFor(ctx, orgId, 'team-aurora'),
    location: 'Somewhere lovely',
    timezone: 'UTC',
    startDate: new Date().toISOString().slice(0, 10),
    askMeAbout: [],
    interests: [],
    role: admin ? 'admin' : 'member',
    avatar: loadoutFromSeed(p.externalId),
    unlockedItems: ['top.northstar-hoodie'],
    settings: { locationVisibility: 'everyone', knocksWhileFocused: false },
  });
  ctx.store.linkIdentity(orgId, {
    provider: 'discord',
    externalId: p.externalId,
    memberId: member.id,
    username: p.username,
    linkedAt: new Date().toISOString(),
  });
  ctx.store.audit(orgId, member.id, 'member.joined', member.id, 'via Discord');
  ctx.hubs.get(orgId)?.profileChanged(member.id);
  return member;
}

export function authRoutes(ctx: AppContext): Router {
  const r = Router();

  r.post('/demo', (req, res) => {
    if (!config.demoMode) return res.status(404).json({ error: 'demo mode disabled' });
    if (!demoLimiter.allow(req.ip ?? 'x')) return res.status(429).json({ error: 'slow down' });
    const body = demoSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid input' });
    const orgId = ORG_ID;
    const team = ctx.store.get(orgId).teams.find((t) => t.id === body.data.teamId) ?? ctx.store.get(orgId).teams.find((t) => t.id === 'team-aurora')!;
    const member = ctx.store.createMember(orgId, {
      displayName: body.data.name,
      title: 'New teammate',
      departmentId: team.departmentId,
      teamId: team.id,
      managerId: managerFor(ctx, orgId, team.id),
      location: 'Remote',
      timezone: 'UTC',
      startDate: new Date().toISOString().slice(0, 10),
      askMeAbout: ['I just joined!'],
      interests: body.data.interests ?? [],
      role: body.data.admin ? 'admin' : 'member',
      avatar: loadoutFromSeed(body.data.name + randomBytes(4).toString('hex')),
      unlockedItems: ['top.northstar-hoodie'],
      settings: { locationVisibility: 'everyone', knocksWhileFocused: false },
    });
    ctx.hubs.get(orgId)?.profileChanged(member.id);
    const token = issueToken(member.id, orgId);
    res.setHeader('Set-Cookie', sessionCookie(token));
    res.json({ token, memberId: member.id });
  });

  r.post('/logout', (_req, res) => {
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.json({ ok: true });
  });

  r.get('/discord/start', (req, res) => {
    if (!discordConfigured()) return res.status(404).send('Discord is not configured. See docs/DISCORD.md.');
    if (!oauthLimiter.allow(req.ip ?? 'x')) return res.status(429).send('Too many attempts');
    const state = randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie', `${STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${config.isProd ? '; Secure' : ''}`);
    res.redirect(ctx.discord.authorizeUrl(state));
  });

  r.get('/discord/callback', async (req, res) => {
    const state = parseCookies(req.headers.cookie)[STATE_COOKIE];
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!state || state !== req.query.state || !code) return res.redirect('/?error=oauth_state');
    try {
      const { orgId, guildId } = discordGuildFor(ctx);
      if (!guildId) return res.redirect('/?error=no_guild');
      const profile = await ctx.discord.identify(code, guildId, config.discord.redirectUri);
      if (!profile.workspaceMember) return res.redirect('/?error=not_member');
      const member = upsertDiscordMember(ctx, orgId, profile);
      res.setHeader('Set-Cookie', [sessionCookie(issueToken(member.id, orgId)), `${STATE_COOKIE}=; Path=/; Max-Age=0`]);
      res.redirect('/');
    } catch (e) {
      console.error('[discord] oauth callback failed', e);
      res.redirect('/?error=oauth_failed');
    }
  });

  /**
   * Discord Activity (Embedded App SDK) flow: the client calls `authorize()` inside Discord,
   * posts the code here, we exchange it server-side (client secret never leaves the server),
   * verify guild membership, and hand back the access token the SDK needs for `authenticate()`
   * plus our own session token (bearer — third-party cookies aren't reliable in the iframe).
   */
  r.post('/discord/activity', async (req, res) => {
    if (!discordConfigured()) return res.status(404).json({ error: 'discord not configured' });
    const code = z.object({ code: z.string().min(1).max(200), guildId: z.string().max(32).optional() }).safeParse(req.body);
    if (!code.success) return res.status(400).json({ error: 'invalid input' });
    try {
      const { orgId, guildId } = discordGuildFor(ctx);
      const profile = await ctx.discord.identify(code.data.code, guildId ?? code.data.guildId);
      if (guildId && !profile.workspaceMember) return res.status(403).json({ error: 'not a member of the company server' });
      const member = upsertDiscordMember(ctx, orgId, profile);
      res.json({ access_token: profile.accessToken, token: issueToken(member.id, orgId), memberId: member.id });
    } catch (e) {
      console.error('[discord] activity token exchange failed', e);
      res.status(502).json({ error: 'discord exchange failed' });
    }
  });

  return r;
}
