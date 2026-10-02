/**
 * Slack people ↔ Minglewood members. A Slack user is the same member every time (their Slack user id); a first
 * sign-in joins the member who already holds the same verified email on another identity, or creates a new
 * member. Workspace owners and admins (users.info), the person who installed the app, and SLACK_ADMIN_USER_IDS
 * become admins of the company's world.
 */
import { loadoutFromSeed } from '@shared/avatar';
import { ORG_ID } from '@shared/seed/northstar';
import type { Member } from '@shared/domain/types';
import { config } from '../config';
import type { AppContext } from '../context';

export interface SlackPerson {
  userId: string;
  name: string;
  email?: string;
  emailVerified?: boolean;
  timezone?: string;
  /** Their Slack picture, so what they say in the world can show up in the channel as them. */
  picture?: string;
  /** Workspace owner/admin, or the installer. */
  manager?: boolean;
}

export function upsertSlackMember(ctx: AppContext, orgId: string, p: SlackPerson): Member {
  const data = ctx.store.get(orgId);
  const admin = !!p.manager || config.slack.adminUserIds.includes(p.userId);
  const email = p.email && p.emailVerified !== false ? p.email.toLowerCase() : undefined;
  const link = (memberId: string) =>
    ctx.store.linkIdentity(orgId, { provider: 'slack', externalId: p.userId, memberId, username: p.name, email, avatarUrl: p.picture, linkedAt: new Date().toISOString() });

  const existing = ctx.store.identity(orgId, 'slack', p.userId);
  const known = existing && ctx.store.member(orgId, existing.memberId);
  const byEmail = !known && email ? data.identities.find((i) => i.email === email && ctx.store.member(orgId, i.memberId)) : undefined;
  const found = known ?? (byEmail ? ctx.store.member(orgId, byEmail.memberId) : undefined);
  if (found) {
    if (!known || (p.picture && existing?.avatarUrl !== p.picture)) link(found.id);
    if (admin && found.role === 'member') ctx.store.updateMember(orgId, found.id, { role: 'admin' });
    return found;
  }

  const demoOrg = orgId === ORG_ID;
  const team = (demoOrg && data.teams.find((t) => t.id === 'team-aurora')) || data.teams[0];
  const avatar = loadoutFromSeed(`slack:${p.userId}`);
  const member = ctx.store.createMember(orgId, {
    displayName: p.name.slice(0, 40),
    title: 'Teammate',
    departmentId: team.departmentId,
    teamId: team.id,
    location: 'Somewhere lovely',
    timezone: p.timezone ?? 'UTC',
    startDate: new Date().toISOString().slice(0, 10),
    askMeAbout: [],
    interests: [],
    role: admin ? 'admin' : 'member',
    avatar: demoOrg ? avatar : { ...avatar, top: 'top.hoodie' },
    unlockedItems: demoOrg ? ['top.northstar-hoodie'] : [],
    settings: { locationVisibility: 'everyone', knocksWhileFocused: false },
  });
  link(member.id);
  ctx.store.audit(orgId, member.id, 'member.joined', member.id, 'via Slack');
  ctx.hubs.get(orgId)?.profileChanged(member.id);
  return member;
}
