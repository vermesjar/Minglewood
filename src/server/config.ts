import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Minimal .env loader (no dependency). Real environment variables win. */
function loadDotEnv() {
  for (const file of ['.env.local', '.env']) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || line.trim().startsWith('#')) continue;
      const value = m[2].replace(/^["']|["']$/g, '');
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
  }
}
loadDotEnv();

// Values pasted into hosting dashboards often carry a stray newline or space; Discord's gateway rejects
// such a bot token (close code 4004) even though REST calls tolerate it.
const env: Record<string, string | undefined> = Object.fromEntries(
  Object.entries(process.env).map(([key, value]) => [key, value?.trim()]),
);
const isProd = env.NODE_ENV === 'production';
/** Slack without a workspace (docs/slack.md): outgoing calls are recorded, never sent. Never in production. */
const slackMock = !isProd && (env.SLACK_MOCK === 'true' || env.SLACK_MOCK === '1');

let sessionSecret = env.SESSION_SECRET ?? '';
if (!sessionSecret) {
  if (isProd) throw new Error('SESSION_SECRET is required in production');
  // Dev convenience: persist a generated secret in the (gitignored) data dir.
  const dir = resolve(process.cwd(), env.DATA_DIR ?? '.data');
  const file = resolve(dir, '.dev-session-secret');
  if (existsSync(file)) sessionSecret = readFileSync(file, 'utf8').trim();
  else {
    sessionSecret = randomBytes(32).toString('hex');
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, sessionSecret);
    console.warn('[config] SESSION_SECRET not set — generated a dev secret in .data/.dev-session-secret');
  }
}

export const config = {
  isProd,
  // API_PORT in dev (Vite owns 5173); cloud platforms inject PORT in production.
  port: Number(env.API_PORT ?? (isProd ? env.PORT : undefined) ?? 8787),
  publicUrl: env.PUBLIC_URL ?? 'http://localhost:5173',
  sessionSecret,
  dataDir: resolve(process.cwd(), env.DATA_DIR ?? '.data'),
  demoMode: env.DEMO_MODE !== 'false',
  /** Minglewood Cloud (Lovable Cloud edge functions base URL, e.g. https://<ref>.supabase.co/functions/v1). */
  controlPlaneUrl: env.CONTROL_PLANE_URL ?? '',
  serverKey: env.MINGLEWOOD_SERVER_KEY ?? '',
  /** Where "Add to Discord" lives (the control plane's public site). */
  installUrl: env.INSTALL_URL ?? '',
  simulateCoworkers: env.SIMULATE_COWORKERS !== 'false',
  discord: {
    clientId: env.DISCORD_CLIENT_ID ?? '',
    clientSecret: env.DISCORD_CLIENT_SECRET ?? '',
    botToken: env.DISCORD_BOT_TOKEN ?? '',
    /** Optional: pre-bind the demo org to this guild at boot. Admins can also connect in the UI. */
    guildId: env.DISCORD_GUILD_ID ?? '',
    redirectUri: env.DISCORD_REDIRECT_URI ?? `${env.PUBLIC_URL ?? 'http://localhost:5173'}/api/auth/discord/callback`,
    adminUserIds: (env.DISCORD_ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  },
  slack: {
    clientId: env.SLACK_CLIENT_ID ?? '',
    clientSecret: env.SLACK_CLIENT_SECRET ?? '',
    /** Verifies every request Slack sends us (Basic Information → Signing Secret). */
    signingSecret: env.SLACK_SIGNING_SECRET || (slackMock ? 'mock-signing-secret' : ''),
    /** Optional single-workspace bot token (xoxb-…). Without it, the token from the in-app install is used. */
    botToken: env.SLACK_BOT_TOKEN ?? '',
    /** Optional: pre-bind the demo org to this workspace (team id T…) at boot. Admins can also install in the UI. */
    teamId: env.SLACK_TEAM_ID || (slackMock ? 'T0MOCK' : ''),
    signInRedirectUri: env.SLACK_REDIRECT_URI ?? `${env.PUBLIC_URL ?? 'http://localhost:5173'}/api/slack/auth/callback`,
    installRedirectUri: env.SLACK_INSTALL_REDIRECT_URI ?? `${env.PUBLIC_URL ?? 'http://localhost:5173'}/api/slack/install/callback`,
    /** Where a person's "sync my status" grant lands: the install redirect (already registered with Slack) unless overridden. */
    statusRedirectUri: env.SLACK_STATUS_REDIRECT_URI ?? env.SLACK_INSTALL_REDIRECT_URI ?? `${env.PUBLIC_URL ?? 'http://localhost:5173'}/api/slack/install/callback`,
    adminUserIds: (env.SLACK_ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    /** Local development without a workspace: outgoing Slack calls are recorded instead of sent. */
    mock: slackMock,
  },
};

export const discordConfigured = () => !!(config.discord.clientId && config.discord.clientSecret);
export const discordBotConfigured = () => !!config.discord.botToken;
export const slackConfigured = () => !!(config.slack.clientId && config.slack.clientSecret && config.slack.signingSecret);
/** Requests from Slack can be verified (events, slash commands) — true in mock mode with a dev signing secret too. */
export const slackSigningConfigured = () => !!config.slack.signingSecret;

export const cloudConfigured = () => !!(config.controlPlaneUrl && config.serverKey);
