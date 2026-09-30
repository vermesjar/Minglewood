import type { NextFunction, Request, Response } from 'express';
import type { Member } from '@shared/domain/types';
import { sessionFromRequest } from './auth/session';
import type { Store } from './store/store';
import type { OrgHub } from './realtime/orgHub';
import type { DiscordProvider } from './providers/discord/provider';
import type { DemoProvider } from './providers/demo';
import type { SlackService } from './slack/service';
import type { DiscordBridge } from './providers/discord/bridge';

export interface AppContext {
  store: Store;
  hubs: Map<string, OrgHub>;
  discord: DiscordProvider;
  demo: DemoProvider;
  /** Slack: provider (sign-in, install, channels, links) and the per-company presence/commands service. */
  slack: SlackService;
  /** Which org a Discord server belongs to (installed tenants, or the legacy single-guild setup). */
  resolveGuild(guildId: string): Promise<string | undefined>;
  /** Chat, history and voice-follow between spaces and Discord channels (present when a bot token is set). */
  discordBridge?: DiscordBridge;
}

export interface AuthedRequest extends Request {
  member: Member;
  orgId: string;
}

/** Authenticates the request and pins it to the session's organization (tenancy boundary). */
export function requireMember(ctx: AppContext) {
  return (req: Request, res: Response, next: NextFunction) => {
    const s = sessionFromRequest(req);
    const member = s && ctx.store.member(s.orgId, s.memberId);
    if (!s || !member) {
      res.status(401).json({ error: 'not signed in' });
      return;
    }
    (req as AuthedRequest).member = member;
    (req as AuthedRequest).orgId = s.orgId;
    next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const m = (req as AuthedRequest).member;
  if (!m || (m.role !== 'admin' && m.role !== 'owner')) {
    res.status(403).json({ error: 'admin only' });
    return;
  }
  next();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const authed = (req: Request<any>) => req as unknown as AuthedRequest;
