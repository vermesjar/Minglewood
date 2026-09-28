/** Builds the HTTP + realtime server. `index.ts` runs it; tests create isolated instances. */
import express from 'express';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
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
import type { AppContext } from './context';

export interface AppOptions {
  persistence: Persistence;
  simulateCoworkers: boolean;
  serveClient?: boolean;
}

export interface App {
  server: Server;
  store: Store;
  hubs: Map<string, OrgHub>;
  close(): Promise<void>;
}

export async function createApp(opts: AppOptions): Promise<App> {
  const store = new Store(opts.persistence);
  await store.init();

  const hubs = new Map<string, OrgHub>();
  for (const orgId of store.orgIds()) hubs.set(orgId, new OrgHub(orgId, store));

  const ctx: AppContext = { store, hubs, discord: new DiscordProvider(), demo: new DemoProvider() };

  const sims: LifeSim[] = [];
  if (opts.simulateCoworkers) {
    const calendar = new MockCalendarProvider(DEMO_CALENDAR, Date.now());
    for (const hub of hubs.values()) {
      const sim = new LifeSim(hub, store, calendar);
      sim.start();
      sims.push(sim);
    }
  }

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
    gateway = new DiscordVoiceGateway(config.discord.botToken, () => [...guildToOrg().keys()]);
    const syncs = new Map<string, VoicePresenceSync>();
    gateway.on('voice', (guildId, change) => {
      const orgId = guildToOrg().get(guildId);
      const hub = orgId && hubs.get(orgId);
      if (!hub) return;
      if (!syncs.has(orgId)) syncs.set(orgId, new VoicePresenceSync(hub, store));
      syncs.get(orgId)!.apply(change);
    });
    gateway.on('ready', () => console.log('[discord] gateway ready — watching voice presence'));
    gateway.on('error', (e) => console.warn('[discord] gateway:', e.message));
    gateway.start();
  };
  startGateway();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '64kb' }));
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
    async close() {
      clearInterval(eventTimer);
      sims.forEach((s) => s.stop());
      hubs.forEach((h) => h.dispose());
      gateway?.stop();
      wss.clients.forEach((c) => c.terminate());
      await new Promise<void>((r) => server.close(() => r()));
      await store.flush();
    },
  };
}
