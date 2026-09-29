/** Builds the HTTP + realtime server. `index.ts` runs it; tests create isolated instances. */
import express from 'express';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEMO_CALENDAR } from '@shared/seed/northstar';
import { MockCalendarProvider } from '@shared/calendar';
import { config, discordBotConfigured } from './config';
import { Store, type Persistence } from './store/store';
import { OrgHub } from './realtime/orgHub';
import { attachSockets } from './realtime/socketServer';
import { KeyedLimiter } from './realtime/rateLimit';
import { LifeSim } from './sim/lifeSim';
import { DiscordProvider } from './providers/discord/provider';
import { DemoProvider } from './providers/demo';
import { DiscordVoiceGateway } from './providers/discord/gateway';
import { VoicePresenceSync } from './providers/voiceSync';
import { apiRoutes } from './routes/api';
import { authRoutes } from './routes/auth';
import { adminRoutes } from './routes/admin';
import { MockSlack, SlackApi } from './slack/api';
import { SlackProvider } from './slack/provider';
import { slackRoutes } from './slack/routes';
import { SlackService } from './slack/service';
import { SlackTokens } from './slack/tokens';
import type { AppContext } from './context';
import { ORG_ID } from '@shared/seed/northstar';
import type { ControlPlane } from './cloud/controlPlane';
import { TenantSync } from './cloud/tenantSync';

export interface AppOptions {
  persistence: Persistence;
  simulateCoworkers: boolean;
  serveClient?: boolean;
  /** Include the Northstar Labs demo world (default true). */
  demo?: boolean;
  /** Minglewood Cloud: installs + tenant state. Without it, the server runs single-org. */
  cloud?: ControlPlane;
  /** Where Slack workspace tokens from the in-app install are kept (a gitignored file); in memory if omitted. */
  slackTokenFile?: string;
}

export interface App {
  server: Server;
  store: Store;
  hubs: Map<string, OrgHub>;
  ctx: AppContext;
  close(): Promise<void>;
}

export async function createApp(opts: AppOptions): Promise<App> {
  const store = new Store(opts.persistence);
  await store.init(new Date(), { demo: opts.demo !== false });

  const hubs = new Map<string, OrgHub>();
  const sims: LifeSim[] = [];
  const calendar = new MockCalendarProvider(DEMO_CALENDAR, Date.now());
  /** One realtime hub per company world, created the first time it's needed. */
  const ensureHub = (orgId: string) => {
    let hub = hubs.get(orgId);
    if (hub) return hub;
    hub = new OrgHub(orgId, store);
    hubs.set(orgId, hub);
    // Simulated coworkers only live in the demo company.
    if (opts.simulateCoworkers && orgId === ORG_ID) {
      const sim = new LifeSim(hub, store, calendar);
      sim.start();
      sims.push(sim);
    }
    return hub;
  };
  for (const orgId of store.orgIds()) ensureHub(orgId);

  const tenants = opts.cloud ? new TenantSync(store, opts.cloud, (orgId) => void ensureHub(orgId)) : null;
  await tenants?.start();

  const resolveGuild = async (guildId: string): Promise<string | undefined> => {
    const connected = store.orgForWorkspace('discord', guildId);
    if (connected) return connected;
    const tenant = await tenants?.forGuild(guildId).catch((e) => {
      console.warn('[cloud] guild lookup failed:', (e as Error).message);
      return undefined;
    });
    if (tenant) return tenant;
    if (config.discord.guildId === guildId && store.hasOrg(ORG_ID)) return ORG_ID;
    return undefined;
  };

  // Slack: real Web API, or the recording mock for local development (SLACK_MOCK=true)
  const slackMock = config.slack.mock ? new MockSlack() : undefined;
  const slackTokens = new SlackTokens(() => config.slack.botToken || (slackMock ? 'xoxb-mock' : ''), opts.slackTokenFile);
  const slack = new SlackService(store, ensureHub, new SlackProvider(new SlackApi(slackMock?.transport), slackTokens));
  slack.start();

  const ctx: AppContext = { store, hubs, discord: new DiscordProvider(), demo: new DemoProvider(), slack, resolveGuild };

  // Events start and end on their own; tell clients when the set of active events changes.
  const activeKey = new Map<string, string>();
  const eventTimer = setInterval(() => {
    for (const hub of hubs.values()) {
      const key = hub.activeEvents().map((e) => e.id).join(',');
      if (activeKey.get(hub.orgId) !== key) {
        if (activeKey.has(hub.orgId)) hub.eventsChanged();
        activeKey.set(hub.orgId, key);
      }
    }
  }, 30_000);

  // Discord voice presence (optional; needs a bot token and a connected server).
  let gateway: DiscordVoiceGateway | null = null;
  const startGateway = () => {
    if (!discordBotConfigured() || gateway) return;
    const guildToOrg = () => {
      const m = new Map<string, string>();
      for (const orgId of store.orgIds()) {
        for (const c of store.get(orgId).connections) {
          if (c.provider === 'discord' && c.status === 'active') m.set(c.externalWorkspaceId, orgId);
        }
      }
      if (config.discord.guildId && !m.size) m.set(config.discord.guildId, store.orgIds()[0]);
      return m;
    };
    gateway = new DiscordVoiceGateway(config.discord.botToken, () => [...guildToOrg().keys()], !!opts.cloud);
    const syncs = new Map<string, VoicePresenceSync>();
    gateway.on('voice', (guildId, change) => {
      void (async () => {
        const orgId = guildToOrg().get(guildId) ?? (await resolveGuild(guildId));
        if (!orgId || !store.hasOrg(orgId)) return;
        const hub = ensureHub(orgId);
        if (!syncs.has(orgId)) syncs.set(orgId, new VoicePresenceSync(hub, store));
        syncs.get(orgId)!.apply(change);
      })();
    });
    gateway.on('ready', () => console.log('[discord] gateway ready — watching voice presence'));
    gateway.on('error', (e) => console.warn('[discord] gateway:', e.message));
    gateway.start();
  };
  startGateway();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  // Slack signs the raw request bytes, so its routes read the body themselves (before the JSON parser).
  app.use('/api/slack', slackRoutes(ctx, slackMock));
  app.use(express.json({ limit: '64kb' }));
  if (!config.isProd) {
    // Dev only: the Design Lab (src/client/studio.html), localhost only (routes/devLab.ts labGuard). Loaded on
    // first use and never in production; ahead of the API rate limit because its sandbox loads every sprite.
    let lab: Promise<{ guard: express.RequestHandler; router: express.Router }> | null = null;
    app.use('/api/dev/lab', (req, res, next) => {
      lab ??= import('./routes/devLab').then((m) => ({ guard: m.labGuard, router: m.devLabRoutes() }));
      lab.then(({ guard, router }) => guard(req, res, (err?: unknown) => (err ? next(err) : router(req, res, next)))).catch(next);
    });
  }
  const apiLimiter = new KeyedLimiter(600, 60_000);
  app.use('/api', (req, res, next) => {
    if (!apiLimiter.allow(req.ip ?? 'unknown')) {
      res.status(429).json({ error: 'too many requests' });
      return;
    }
    next();
  });
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  if (!config.isProd) {
    // Dev only: the sprite lab posts rendered PNGs here so art can be reviewed from disk (art/review/).
    app.post('/api/dev/snapshot', express.raw({ type: 'image/png', limit: '40mb' }), (req, res) => {
      const name = String(req.query.name ?? '').replace(/[^a-z0-9._-]/gi, '');
      if (!name || !Buffer.isBuffer(req.body)) {
        res.status(400).json({ error: 'name and a PNG body are required' });
        return;
      }
      const dir = resolve(process.cwd(), 'art/review');
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, `${name}.png`), req.body);
      res.json({ ok: true, path: `art/review/${name}.png` });
    });
  }
  app.use('/api/auth', authRoutes(ctx));
  app.use('/api/admin', adminRoutes(ctx, () => startGateway()));
  app.use('/api', apiRoutes(ctx));

  const clientDir = resolve(process.cwd(), 'dist/client');
  if (opts.serveClient && existsSync(clientDir)) {
    app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(resolve(clientDir, 'index.html')));
  }

  const server = createServer(app);
  const wss = attachSockets(server, store, hubs);

  return {
    server,
    store,
    hubs,
    ctx,
    async close() {
      clearInterval(eventTimer);
      slack.stop();
      tenants?.stop();
      sims.forEach((s) => s.stop());
      hubs.forEach((h) => h.dispose());
      gateway?.stop();
      wss.clients.forEach((c) => c.terminate());
      await new Promise<void>((r) => server.close(() => r()));
      await store.flush();
    },
  };
}
