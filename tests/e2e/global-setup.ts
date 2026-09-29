/**
 * One demo member per worker, created once and reused across runs (demo sign-ups persist and are rate
 * limited): tests/e2e/.auth/bot-N.json holds its session cookie and the local flags a returning player has
 * (welcome seen), so every run starts in the world, not on a welcome screen.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { request, type FullConfig } from '@playwright/test';

export const AUTH_DIR = 'tests/e2e/.auth';
/**
 * PLAYTEST_TAG=name gives a run its own bots, watchers, screenshots and results, so two runs at once (two
 * agents playtesting) never sign in as the same member — one member in two tabs fights itself — or wipe each
 * other's output.
 */
export const TAG = process.env.PLAYTEST_TAG
  ? `-${process.env.PLAYTEST_TAG.replace(/[^\w-]+/g, '')}`
  : '';
export const botState = (i: number) => `${AUTH_DIR}/bot${TAG}-${i}.json`;

export default async function globalSetup(config: FullConfig) {
  const baseURL = String(config.projects[0].use.baseURL ?? 'http://localhost:5173');
  const up = await request.newContext({ baseURL });
  const alive = await up.get('/api/config').catch(() => null);
  if (!alive?.ok())
    throw new Error(
      `The dev server isn't answering at ${baseURL} — start it with \`npm run dev\`.`,
    );
  await up.dispose();
  mkdirSync(AUTH_DIR, { recursive: true });
  const n = config.workers;
  for (let i = 0; i < n; i++) {
    const file = botState(i);
    if (existsSync(file)) {
      const ctx = await request.newContext({ baseURL, storageState: file });
      const ok = (await ctx.get('/api/bootstrap')).ok();
      await ctx.dispose();
      if (ok) continue;
    }
    const ctx = await request.newContext({ baseURL });
    const res = await ctx.post('/api/auth/demo', {
      data: {
        name: `Playtest Bot${TAG ? ' ' + TAG.slice(1) : ''} ${i + 1}`,
        teamId: 'team-aurora',
        interests: ['coffee'],
        admin: true,
      },
    });
    if (!res.ok())
      throw new Error(`demo sign-in failed for bot ${i + 1}: ${res.status()} ${await res.text()}`);
    const { memberId } = (await res.json()) as { memberId: string };
    const state = await ctx.storageState();
    state.origins = [
      {
        origin: baseURL,
        localStorage: [{ name: `mw.welcomed.${memberId}`, value: '1' }],
      },
    ];
    writeFileSync(file, JSON.stringify(state, null, 2));
    await ctx.dispose();
  }
}
