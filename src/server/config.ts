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

const env = process.env;
const isProd = env.NODE_ENV === 'production';

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
};

export const discordConfigured = () => !!(config.discord.clientId && config.discord.clientSecret);
export const discordBotConfigured = () => !!config.discord.botToken;
