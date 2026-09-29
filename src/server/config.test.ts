import { afterEach, describe, expect, it, vi } from 'vitest';

describe('config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('trims stray whitespace from pasted secrets (Discord gateway rejects an untrimmed bot token)', async () => {
    vi.stubEnv('DISCORD_BOT_TOKEN', 'abc.def.ghi\n');
    vi.stubEnv('MINGLEWOOD_SERVER_KEY', '  key ');
    const { config } = await import('./config');
    expect(config.discord.botToken).toBe('abc.def.ghi');
    expect(config.serverKey).toBe('key');
  });
});
