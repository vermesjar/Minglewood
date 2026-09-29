/**
 * /api/slack — mounted before the JSON body parser, because Slack signs the raw bytes of each request.
 *
 *   POST /events         Events API (signed): huddles, statuses, DND, link previews, uninstall
 *   POST /commands       /minglewood (signed)
 *   POST /interactions   block actions (signed) — our buttons are links, so this only acknowledges
 *   GET  /auth/start     Sign in with Slack (OpenID Connect)       → /auth/callback
 *   GET  /install/start  add the app to a workspace (admins, OAuth v2) → /install/callback
 *   /admin/*             connection status, channels, daily note, single-workspace connect (admins)
 *   PUT  /me/knock-dms   opt in or out of knock DMs
 *   /dev/*               the mock's outbox and users (SLACK_MOCK, never in production)
 */
import express, { Router, type Request, type Response } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SlackAdminStatus } from '@shared/api';
import { issueToken, parseCookies, sessionCookie } from '../auth/session';
import { config, slackConfigured } from '../config';
import { authed, requireAdmin, requireMember, type AppContext } from '../context';
import { KeyedLimiter } from '../realtime/rateLimit';
import { SlackApiError, type MockSlack } from './api';
import { upsertSlackMember } from './members';
import type { SlackEvent } from './service';
import { verifySlackRequest } from './verify';

const STATE_COOKIE = 'mw_slack_state';
const oauthLimiter = new KeyedLimiter(60, 600_000);

const cookie = (value: string, maxAge: number) =>
  `${STATE_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.isProd ? '; Secure' : ''}`;

export function slackAdminStatus(ctx: AppContext, orgId: string): SlackAdminStatus {
  const base = config.publicUrl.replace(/\/$/, '');
  return {
    configured: slackConfigured(),
    botConfigured: ctx.slack.provider.tokens.has(undefined),
    installUrl: slackConfigured() ? `${base}/api/slack/install/start` : null,
    mock: config.slack.mock,
    team: ctx.slack.teamFor(orgId) ?? null,
    capabilities: ctx.slack.provider.capabilities,
    endpoints: {
      events: `${base}/api/slack/events`,
      commands: `${base}/api/slack/commands`,
      interactions: `${base}/api/slack/interactions`,
      signInRedirect: config.slack.signInRedirectUri,
      installRedirect: config.slack.installRedirectUri,
    },
  };
}

export function slackRoutes(ctx: AppContext, mock?: MockSlack): Router {
  const r = Router();
  const raw = express.raw({ type: () => true, limit: '256kb' });
  const json = express.json({ limit: '16kb' });

  /** Verify Slack's signature over the raw body; responds 401 and returns null when it doesn't check out. */
  const verified = (req: Request, res: Response): string | null => {
    const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const v = verifySlackRequest(config.slack.signingSecret, {
      timestamp: req.header('x-slack-request-timestamp') ?? undefined,
      signature: req.header('x-slack-signature') ?? undefined,
    }, body);
    if (!v.ok) {
      res.status(v.reason === 'no-secret' ? 404 : 401).json({ error: v.reason === 'no-secret' ? 'slack not configured' : 'bad signature' });
      return null;
    }
    return body;
  };

  /* ------------------------------------------------------------------ from Slack */

  r.post('/events', raw, (req, res) => {
    const body = verified(req, res);
    if (body === null) return;
    let payload: { type?: string; challenge?: string; team_id?: string; event?: SlackEvent };
    try {
      payload = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'invalid json' });
    }
    if (payload.type === 'url_verification') return res.json({ challenge: payload.challenge });
    // acknowledge within Slack's 3 s, then do the work
    res.status(200).end();
    if (payload.type === 'event_callback' && payload.event && payload.team_id) {
      void ctx.slack.onEvent(payload.team_id, payload.event).catch((e) => console.warn('[slack] event failed:', (e as Error).message));
    }
  });

  r.post('/commands', raw, (req, res) => {
    const body = verified(req, res);
    if (body === null) return;
    const f = new URLSearchParams(body);
    res.json(ctx.slack.command(f.get('team_id') ?? '', f.get('user_id') ?? '', f.get('text') ?? ''));
  });

  r.post('/interactions', raw, (req, res) => {
    if (verified(req, res) === null) return;
    res.status(200).end();
  });

  /* ------------------------------------------------------------------ Sign in with Slack */

  r.get('/auth/start', (req, res) => {
    if (!slackConfigured()) return res.status(404).send('Slack is not configured. See docs/slack.md.');
    if (!oauthLimiter.allow(req.ip ?? 'x')) return res.status(429).send('Too many attempts');
    const team = typeof req.query.team === 'string' && /^T[A-Z0-9]{4,20}$/.test(req.query.team) ? req.query.team : undefined;
    const state = randomBytes(16).toString('hex');
    const nonce = randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie', cookie(`${state}.${nonce}`, 600));
    res.redirect(ctx.slack.provider.authorizeUrl(state, nonce, team));
  });

  r.get('/auth/callback', async (req, res) => {
    const [state, nonce] = (parseCookies(req.headers.cookie)[STATE_COOKIE] ?? '').split('.');
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!state || !nonce || state !== req.query.state || !code) return res.redirect('/?error=oauth_state');
    try {
      const who = await ctx.slack.provider.signIn(code, nonce);
      const orgId = ctx.slack.orgForTeam(who.teamId);
      if (!orgId) return res.redirect('/?error=slack_no_install');
      const profile = await ctx.slack.provider.user(who.teamId, who.userId);
      const member = upsertSlackMember(ctx, orgId, {
        userId: who.userId,
        name: profile?.profile?.display_name || profile?.real_name || who.name,
        email: who.email,
        emailVerified: who.emailVerified,
        timezone: profile?.tz,
        manager: !!(profile?.is_admin || profile?.is_owner),
      });
      res.setHeader('Set-Cookie', [sessionCookie(issueToken(member.id, orgId)), cookie('', 0)]);
      res.redirect('/');
    } catch (e) {
      console.error('[slack] sign-in failed', (e as Error).message);
      res.redirect('/?error=slack_failed');
    }
  });

  /* ------------------------------------------------------------------ add to a workspace (admins) */

  r.get('/install/start', requireMember(ctx), requireAdmin, (_req, res) => {
    if (!slackConfigured()) return res.status(404).send('Slack is not configured. See docs/slack.md.');
    const state = randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie', cookie(state, 600));
    res.redirect(ctx.slack.provider.installUrl(state));
  });

  r.get('/install/callback', requireMember(ctx), requireAdmin, async (req, res) => {
    const { orgId, member } = authed(req);
    const state = parseCookies(req.headers.cookie)[STATE_COOKIE] ?? '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!state || state !== req.query.state || !code) return res.redirect('/#/admin');
    try {
      const inst = await ctx.slack.provider.install(code);
      const owner = ctx.store.orgForWorkspace('slack', inst.teamId);
      if (owner && owner !== orgId) return res.status(409).send('That Slack workspace is already connected to another Minglewood.');
      ctx.slack.provider.tokens.set(inst.teamId, inst.botToken);
      const prev = ctx.slack.connection(orgId);
      ctx.store.setConnection(orgId, {
        id: prev?.id ?? randomUUID(),
        orgId,
        provider: 'slack',
        externalWorkspaceId: inst.teamId,
        displayName: inst.teamName,
        connectedAt: new Date().toISOString(),
        connectedBy: member.id,
        status: 'active',
        settings: prev?.settings,
      });
      // the installer's Slack account is this admin
      ctx.store.linkIdentity(orgId, { provider: 'slack', externalId: inst.installerUserId, memberId: member.id, linkedAt: new Date().toISOString() });
      ctx.store.audit(orgId, member.id, 'slack.connected', inst.teamId, inst.teamName);
      ctx.slack.watch([orgId]);
      res.setHeader('Set-Cookie', cookie('', 0));
      res.redirect('/#/admin');
    } catch (e) {
      console.error('[slack] install failed', (e as Error).message);
      res.redirect('/#/admin');
    }
  });

  /* ------------------------------------------------------------------ admin */

  const admin = Router();
  admin.use(requireMember(ctx), requireAdmin);

  admin.get('/status', (req, res) => {
    const { orgId } = authed(req);
    res.json({ status: slackAdminStatus(ctx, orgId), connection: ctx.slack.connection(orgId) ?? null });
  });

  admin.get('/channels', async (req, res) => {
    const team = ctx.slack.teamFor(authed(req).orgId);
    if (!team && !config.slack.mock) return res.json({ channels: [] });
    try {
      res.json({ channels: await ctx.slack.provider.listChannels(team ?? '') });
    } catch (e) {
      res.status(502).json({ error: e instanceof SlackApiError ? `Slack said ${e.error}` : 'failed' });
    }
  });

  /** Single-workspace deploys (SLACK_BOT_TOKEN set): connect the token's workspace without the OAuth install. */
  admin.post('/connect', async (req, res) => {
    const { orgId, member } = authed(req);
    const token = ctx.slack.provider.tokens.forTeam(undefined);
    if (!token) return res.status(400).json({ error: 'Set SLACK_BOT_TOKEN, or use “Add to Slack”.' });
    try {
      const team = await ctx.slack.provider.api.teamInfo(token);
      const owner = ctx.store.orgForWorkspace('slack', team.id);
      if (owner && owner !== orgId) return res.status(409).json({ error: 'That workspace is already connected to another Minglewood.' });
      const conn = {
        id: randomUUID(),
        orgId,
        provider: 'slack' as const,
        externalWorkspaceId: team.id,
        displayName: team.name,
        connectedAt: new Date().toISOString(),
        connectedBy: member.id,
        status: 'active' as const,
      };
      ctx.store.setConnection(orgId, conn);
      ctx.store.audit(orgId, member.id, 'slack.connected', team.id, team.name);
      ctx.slack.watch([orgId]);
      res.json({ connection: conn });
    } catch (e) {
      res.status(502).json({ error: e instanceof SlackApiError ? `Slack said ${e.error}` : 'failed' });
    }
  });

  admin.put('/settings', json, (req, res) => {
    const { orgId, member } = authed(req);
    const body = z
      .object({ dailyChannelId: z.string().regex(/^[CG][A-Z0-9]{2,20}$/).nullable(), dailyHour: z.number().int().min(0).max(23) })
      .partial()
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid input' });
    const conn = ctx.slack.connection(orgId);
    if (!conn) return res.status(400).json({ error: 'connect Slack first' });
    const settings = { ...conn.settings };
    if (body.data.dailyChannelId !== undefined) settings.dailyChannelId = body.data.dailyChannelId ?? undefined;
    if (body.data.dailyHour !== undefined) settings.dailyHour = body.data.dailyHour;
    ctx.store.setConnection(orgId, { ...conn, settings });
    ctx.store.audit(orgId, member.id, 'slack.settings', conn.externalWorkspaceId, JSON.stringify(settings));
    res.json({ settings });
  });

  r.use('/admin', admin);

  /* ------------------------------------------------------------------ me */

  r.put('/me/knock-dms', requireMember(ctx), json, (req, res) => {
    const { orgId, member } = authed(req);
    const body = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid input' });
    const updated = ctx.store.updateMember(orgId, member.id, { settings: { ...member.settings, slackKnockDms: body.data.enabled } });
    res.json({ settings: updated.settings });
  });

  /* ------------------------------------------------------------------ local mock (never in production) */

  if (mock && !config.isProd) {
    r.get('/dev/outbox', (_req, res) => res.json({ outbox: mock.outbox }));
    r.post('/dev/users', json, (req, res) => {
      const u = z.object({ id: z.string().regex(/^U[A-Z0-9]{1,20}$/), name: z.string().max(60), is_admin: z.boolean().optional() }).safeParse(req.body);
      if (!u.success) return res.status(400).json({ error: 'invalid user' });
      mock.users.set(u.data.id, { id: u.data.id, real_name: u.data.name, is_admin: u.data.is_admin, profile: { display_name: u.data.name } });
      res.json({ ok: true });
    });
    /** Sign in as a Slack user of the mock workspace (what the OpenID flow does, minus Slack). */
    r.post('/dev/signin', json, (req, res) => {
      const b = z.object({ userId: z.string().regex(/^U[A-Z0-9]{1,20}$/), teamId: z.string().regex(/^T[A-Z0-9]{2,20}$/), name: z.string().min(1).max(40) }).safeParse(req.body);
      if (!b.success) return res.status(400).json({ error: 'invalid input' });
      const orgId = ctx.slack.orgForTeam(b.data.teamId);
      if (!orgId) return res.status(404).json({ error: 'that workspace isn’t connected (set SLACK_TEAM_ID, or connect it in the admin console)' });
      const member = upsertSlackMember(ctx, orgId, { userId: b.data.userId, name: b.data.name });
      const token = issueToken(member.id, orgId);
      res.setHeader('Set-Cookie', sessionCookie(token));
      res.json({ token, memberId: member.id });
    });
    /** Make a demo coworker a Slack user of the mock workspace, so their huddles and statuses show up. */
    r.post('/dev/link', json, (req, res) => {
      const b = z.object({ userId: z.string().regex(/^U[A-Z0-9]{1,20}$/), member: z.string().min(1).max(40) }).safeParse(req.body);
      const orgId = ctx.slack.orgForTeam(config.slack.teamId);
      if (!b.success || !orgId) return res.status(400).json({ error: 'invalid input' });
      const q = b.data.member.toLowerCase();
      const member = ctx.store.members(orgId).find((m) => m.id === b.data.member || m.displayName.toLowerCase().startsWith(q));
      if (!member) return res.status(404).json({ error: `no member named “${b.data.member}”` });
      ctx.store.linkIdentity(orgId, { provider: 'slack', externalId: b.data.userId, memberId: member.id, linkedAt: new Date().toISOString() });
      mock.users.set(b.data.userId, { id: b.data.userId, real_name: member.displayName, profile: { display_name: member.displayName } });
      res.json({ memberId: member.id, displayName: member.displayName });
    });
    /** Bind a room to a mock channel (what the admin console's Rooms tab does). */
    r.post('/dev/bind', json, (req, res) => {
      const b = z.object({ roomId: z.string().max(40), channelId: z.string().regex(/^[CG][A-Z0-9]{2,20}$/) }).safeParse(req.body);
      const orgId = ctx.slack.orgForTeam(config.slack.teamId);
      if (!b.success || !orgId) return res.status(400).json({ error: 'invalid input' });
      if (!ctx.store.get(orgId).rooms.some((r) => r.id === b.data.roomId)) return res.status(404).json({ error: 'no such room' });
      const ch = mock.channels.find((c) => c.id === b.data.channelId);
      ctx.store.setBinding(
        orgId,
        { id: randomUUID(), orgId, roomId: b.data.roomId, provider: 'slack', kind: 'voice', externalGuildId: config.slack.teamId, externalChannelId: b.data.channelId, label: `🎧 #${ch?.name ?? b.data.channelId}` },
        b.data.roomId,
      );
      res.json({ ok: true });
    });
  }

  return r;
}
