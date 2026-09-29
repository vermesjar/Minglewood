/**
 * Where workspace bot tokens live. Secrets never enter the org data the client sees, and never git:
 * - SLACK_BOT_TOKEN (env) — a single-workspace deploy, like DISCORD_BOT_TOKEN;
 * - tokens from the in-app workspace install (OAuth v2), kept in `<DATA_DIR>/slack-tokens.json` (gitignored,
 *   file mode 600) when the server runs with a data directory, or in memory (tests).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class SlackTokens {
  private byTeam = new Map<string, string>();

  constructor(
    private readonly envToken: () => string,
    private readonly file?: string,
  ) {
    if (file && existsSync(file)) {
      try {
        const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
        for (const [team, token] of Object.entries(saved)) if (typeof token === 'string') this.byTeam.set(team, token);
      } catch {
        console.warn('[slack] could not read the saved workspace tokens; reinstall the app if needed');
      }
    }
  }

  /** The bot token for a workspace: one saved by its install, else the env token. */
  forTeam(teamId: string | undefined): string {
    return (teamId && this.byTeam.get(teamId)) || this.envToken();
  }

  has(teamId: string | undefined): boolean {
    return !!this.forTeam(teamId);
  }

  set(teamId: string, token: string) {
    this.byTeam.set(teamId, token);
    this.save();
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.byTeam), null, 2));
    try {
      chmodSync(this.file, 0o600);
    } catch {
      /* not supported on every filesystem */
    }
  }
}
