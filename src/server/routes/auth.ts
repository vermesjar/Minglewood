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
import type { UserGuild } from '../providers/discord/provider';

const demoLimiter = new KeyedLimiter(30, 3600_000);
const oauthLimiter = new KeyedLimiter(60, 600_000);
const STATE_COOKIE = 'mw_oauth_state';

const demoSchema = z.object({
  name: z.string().trim().min(1).max(40),
  teamId: z.string().max(40).optional(),
  interests: z.array(z.string().trim().min(1).max(30)).max(6).optional(),
  admin: z.boolean().optional(),
});

function managerFor(ctx: AppContext, orgId: string, teamId: string): string | undefined {
  const team = ctx.store.members(orgId).filter((m) => m.teamId === teamId && m.simulated);
  const managedBy = new Map<string, number>();
  for (const m of team) if (m.managerId) managedBy.set(m.managerId, (managedBy.get(m.managerId) ?? 0) + 1);
  return [...managedBy.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * Links (or creates) the Minglewood member for a verified Discord identity. People who own or
 * manage the Discord server (or installed Minglewood) become admins of their company's world.
 */
export function upsertDiscordMember(ctx: AppContext, orgId: string, p: ExternalIdentityProfile, manager = false): Member {
  const data = ctx.store.get(orgId);
  const admin =
    manager || config.discord.adminUserIds.includes(p.externalId) || data.tenant?.installedByDiscordUserId === p.externalId;
  const existing = ctx.store.identity(orgId, 'discord', p.externalId);
  const known = existing && ctx.store.member(orgId, existing.memberId);
  if (known) {
    if (admin && known.role === 'member') ctx.store.updateMember(orgId, known.id, { role: 'admin' });
    if (p.avatarUrl !== existing.avatarUrl) ctx.store.linkIdentity(orgId, { ...existing, avatarUrl: p.avatarUrl });
    return known;
  }
  const demoOrg = orgId === ORG_ID;
  const team = (demoOrg && data.teams.find((t) => t.id === 'team-aurora')) || data.teams[0];
  const avatar = loadoutFromSeed(p.externalId);
  const member = ctx.store.createMember(orgId, {
    displayName: p.displayName.slice(0, 40),
    title: 'Teammate',
    departmentId: team.departmentId,
    teamId: team.id,
    managerId: demoOrg ? managerFor(ctx, orgId, team.id) : undefined,
    location: 'Somewhere lovely',
    timezone: 'UTC',
    startDate: new Date().toISOString().slice(0, 10),
    askMeAbout: [],
    interests: [],
    role: admin ? 'admin' : 'member',
    avatar: demoOrg ? avatar : { ...avatar, top: 'top.hoodie' },
    unlockedItems: demoOrg ? ['top.northstar-hoodie'] : [],
    settings: { locationVisibility: 'everyone', knocksWhileFocused: false },
  });
  ctx.store.linkIdentity(orgId, {
    provider: 'discord',
    externalId: p.externalId,
    memberId: member.id,
    username: p.username,
    avatarUrl: p.avatarUrl,
    linkedAt: new Date().toISOString(),
  });
  ctx.store.audit(orgId, member.id, 'member.joined', member.id, 'via Discord');
  ctx.hubs.get(orgId)?.profileChanged(member.id);
  return member;
}

/**
 * Chooses the company world for a Discord user: the server they came from (a /minglewood link or
 * the Activity's server) if Minglewood is installed there, otherwise the first installed server
 * they belong to.
 */
export async function pickOrg(ctx: AppContext, guilds: UserGuild[], preferred?: string, strict = false) {
  const first = preferred ? guilds.filter((g) => g.id === preferred) : [];
  const rest = strict && preferred ? [] : guilds.filter((g) => g.id !== preferred);
  for (const guild of [...first, ...rest]) {
    const orgId = await ctx.resolveGuild(guild.id);
    if (orgId) return { orgId, guild };
  }
  return undefined;
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
    const guild = typeof req.query.guild === 'string' && /^\d{5,25}$/.test(req.query.guild) ? req.query.guild : '';
    const state = randomBytes(16).toString('hex');
    res.setHeader(
      'Set-Cookie',
      `${STATE_COOKIE}=${state}.${guild}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${config.isProd ? '; Secure' : ''}`,
    );
    res.redirect(ctx.discord.authorizeUrl(state));
  });

  r.get('/discord/callback', async (req, res) => {
    const [state, preferred] = (parseCookies(req.headers.cookie)[STATE_COOKIE] ?? '').split('.');
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!state || state !== req.query.state || !code) return res.redirect('/?error=oauth_state');
    try {
      const { accessToken, user, guilds } = await ctx.discord.signIn(code, config.discord.redirectUri);
      const picked = await pickOrg(ctx, guilds, preferred || undefined);
      if (!picked) {
        const notMember = !!preferred && !guilds.some((g) => g.id === preferred);
        return res.redirect(`/?error=${notMember ? 'not_member' : 'no_install'}`);
      }
      const profile = await ctx.discord.memberProfile(accessToken, user, picked.guild.id);
      const member = upsertDiscordMember(ctx, picked.orgId, profile, picked.guild.manager);
      res.setHeader('Set-Cookie', [sessionCookie(issueToken(member.id, picked.orgId)), `${STATE_COOKIE}=; Path=/; Max-Age=0`]);
      res.redirect('/');
    } catch (e) {
      console.error('[discord] oauth callback failed', (e as Error).message);
      res.redirect('/?error=oauth_failed');
    }
  });

  /**
   * Discord Activity (Embedded App SDK) flow: the client calls `authorize()` inside Discord,
   * posts the code here, we exchange it server-side (client secret never leaves the server),
   * check the user belongs to the server the Activity was launched in, and hand back the access
   * token the SDK needs for `authenticate()` plus our own bearer session (third-party cookies
   * aren't reliable inside the iframe).
   */
  r.post('/discord/activity', async (req, res) => {
    if (!discordConfigured()) return res.status(404).json({ error: 'discord not configured' });
    const body = z.object({ code: z.string().min(1).max(200), guildId: z.string().max(32).optional() }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid input' });
    try {
      const { accessToken, user, guilds } = await ctx.discord.signIn(body.data.code);
      const picked = await pickOrg(ctx, guilds, body.data.guildId, true);
      if (!picked) return res.status(403).json({ error: 'Minglewood is not installed in this server yet' });
      const profile = await ctx.discord.memberProfile(accessToken, user, picked.guild.id);
      const member = upsertDiscordMember(ctx, picked.orgId, profile, picked.guild.manager);
      res.json({ access_token: accessToken, token: issueToken(member.id, picked.orgId), memberId: member.id });
    } catch (e) {
      console.error('[discord] activity token exchange failed', (e as Error).message);
      res.status(502).json({ error: 'discord exchange failed' });
    }
  });

  return r;
}
