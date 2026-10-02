/**
 * Slack people ↔ Minglewood members. A Slack user is the same member every time (their Slack user id); a first
 * sign-in joins the member who already holds the same verified email on another identity, or creates a new
 * member. Workspace owners and admins (users.info), the person who installed the app, and SLACK_ADMIN_USER_IDS
 * become admins of the company's world.
 */
import { loadoutFromSeed } from '@shared/avatar';
import { ORG_ID } from '@shared/seed/northstar';
import type { Member } from '@shared/domain/types';
import type { SlackUser } from './api';
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
  /** What they do and their pronouns, as set in Slack. */
  title?: string;
  pronouns?: string;
  /** Workspace owner/admin, or the installer. */
  manager?: boolean;
}

/** The fields a member inherits from Slack (Slack is the profile of record on a Slack company). */
export function fieldsFromSlack(p: Pick<SlackPerson, 'name' | 'title' | 'pronouns' | 'timezone'>): Partial<Pick<Member, 'displayName' | 'title' | 'pronouns' | 'timezone'>> {
  const out: Partial<Pick<Member, 'displayName' | 'title' | 'pronouns' | 'timezone'>> = {};
  if (p.name?.trim()) out.displayName = p.name.trim().slice(0, 40);
  if (p.title?.trim()) out.title = p.title.trim().slice(0, 60);
  if (p.pronouns !== undefined) out.pronouns = p.pronouns.trim().slice(0, 20) || undefined;
  if (p.timezone) out.timezone = p.timezone;
  return out;
}

/** A Slack profile (users.info / user_change) as the person we know. */
export function personFromSlackUser(u: SlackUser): Pick<SlackPerson, 'userId' | 'name' | 'title' | 'pronouns' | 'timezone' | 'picture' | 'manager'> {
  return {
    userId: u.id,
    name: u.profile?.display_name || u.real_name || u.name || '', // '' = the event didn't carry a name
    title: u.profile?.title,
    pronouns: u.profile?.pronouns,
    timezone: u.tz,
    picture: u.profile?.image_192 || u.profile?.image_72,
    manager: !!(u.is_admin || u.is_owner),
  };
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
    // Slack is the profile of record: name, title, pronouns and timezone follow it on every sign-in
    const inherited = fieldsFromSlack(p);
    const changed = (Object.keys(inherited) as Array<keyof typeof inherited>).some((k) => inherited[k] !== found[k]);
    const updated = ctx.store.updateMember(orgId, found.id, { ...(changed ? inherited : {}), ...(admin && found.role === 'member' ? { role: 'admin' as const } : {}) });
    if (changed) ctx.hubs.get(orgId)?.profileChanged(found.id);
    return updated;
  }

  const demoOrg = orgId === ORG_ID;
  const team = (demoOrg && data.teams.find((t) => t.id === 'team-aurora')) || data.teams[0];
  const avatar = loadoutFromSeed(`slack:${p.userId}`);
  const member = ctx.store.createMember(orgId, {
    displayName: (p.name.trim() || 'Teammate').slice(0, 40),
    title: p.title?.trim().slice(0, 60) || 'Teammate',
    pronouns: p.pronouns?.trim().slice(0, 20) || undefined,
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
