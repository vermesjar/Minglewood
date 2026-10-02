/**
 * The starter world for a company that just added Minglewood to its workspace.
 * Same town layout as the demo, but it belongs to them: their name, generic room names they can
 * rename, a housewarming party, and the first artifact on the HQ memory wall.
 */
import type { Department, HistoricalArtifact, OrgEvent, Organization, Room, Team, World } from '../domain/types';
import { MEMORY_SLOTS } from '../world/memory';

export interface TenantInfo {
  /** Control-plane id (uuid). */
  id: string;
  slug: string;
  name: string;
  discordGuildId?: string;
  discordGuildIcon?: string | null;
  installedByDiscordUserId?: string | null;
  /** The Slack workspace that installed Minglewood (a company can come from Discord, Slack, or both). */
  slackTeamId?: string;
  installedBySlackUserId?: string | null;
  createdAt: string;
}

export const tenantOrgId = (tenantId: string) => `t-${tenantId}`;
export const isTenantOrg = (orgId: string) => orgId.startsWith('t-');
export const tenantIdOf = (orgId: string) => orgId.slice(2);

export function tenantTemplate(t: TenantInfo) {
  const orgId = tenantOrgId(t.id);
  const org: Organization = {
    id: orgId,
    slug: t.slug,
    name: t.name,
    tagline: 'Our company, as a place.',
    timezone: 'UTC',
    foundedAt: t.createdAt.slice(0, 10),
    worldId: `world-${orgId}`,
  };
  const world: World = {
    id: org.worldId,
    orgId,
    name: `${t.name} Town`,
    theme: 'lakeside',
    outdoorSceneId: 'town',
    districts: [
      { id: 'd-center', name: 'Town Center', description: 'HQ and the plaza.', departmentIds: ['dep-company'] },
      { id: 'd-makers', name: 'Makers’ Row', description: 'Where things get built.', departmentIds: [] },
      { id: 'd-lakeside', name: 'Lakeside', description: 'Coffee, games and celebrations.', departmentIds: [] },
      { id: 'd-grove', name: 'The Grove', description: 'Quiet woods for deep work.', departmentIds: [] },
    ],
  };
  const departments: Department[] = [{ id: 'dep-company', orgId, name: 'Company', color: '#2bb3a3', districtId: 'd-center' }];
  const teams: Team[] = [
    { id: 'team-everyone', orgId, departmentId: 'dep-company', name: 'Everyone', emoji: '🌟', homeRoomId: 'hq', blurb: 'The whole company. Admins can add teams later.' },
  ];
  const rooms: Room[] = [
    { id: 'hq', buildingObjectId: 'b-hq', name: `${t.name} HQ`, purpose: 'hq', districtId: 'd-center', emoji: '🏛️', description: 'The lobby and the memory wall — where your company’s story will hang.' },
    { id: 'cafe', buildingObjectId: 'b-cafe', name: 'The Café', purpose: 'social', districtId: 'd-lakeside', emoji: '☕', description: 'Casual hangout. Bind it to your social voice channel.' },
    { id: 'eng', buildingObjectId: 'b-eng', name: 'The Studio', purpose: 'team', districtId: 'd-makers', emoji: '🛠️', description: 'A home for a team. Rename it and make it yours.' },
    { id: 'launch', buildingObjectId: 'b-launch', name: 'Project Room', purpose: 'project', districtId: 'd-makers', emoji: '🚀', description: 'Gather around a project. Bind it to the project’s channel.' },
    { id: 'events', buildingObjectId: 'b-events', name: 'Event Hall', purpose: 'event', districtId: 'd-lakeside', emoji: '🏮', description: 'All-hands, demos and celebrations.' },
    { id: 'focus', buildingObjectId: 'b-focus', name: 'The Quiet Grove', purpose: 'focus', districtId: 'd-grove', emoji: '🌲', quiet: true, description: 'Deep work. Everyone inside is focused; knocks wait.' },
    { id: 'arcade', buildingObjectId: 'b-arcade', name: 'The Arcade', purpose: 'recreation', districtId: 'd-lakeside', emoji: '🕹️', description: 'Games and downtime.' },
    { id: 'design', buildingObjectId: 'b-design', name: 'The Loft', purpose: 'team', districtId: 'd-makers', emoji: '🎨', description: 'Another team space, waiting for an owner.' },
  ];
  const created = Date.parse(t.createdAt) || Date.now();
  const events: OrgEvent[] = [
    {
      id: `ev-housewarming-${t.id.slice(0, 8)}`,
      orgId,
      title: 'Housewarming party',
      kind: 'social',
      roomId: 'events',
      startsAt: new Date(created).toISOString(),
      endsAt: new Date(created + 3 * 86_400_000).toISOString(),
      hostIds: [],
      description: `${t.name} just moved into Minglewood. Come say hi and grab a party hat.`,
      rewardItemId: 'hat.party',
      decor: 'balloons',
    },
  ];
  const slot = MEMORY_SLOTS.hq[0];
  const artifacts: HistoricalArtifact[] = [
    {
      id: `art-moved-in-${t.id.slice(0, 8)}`,
      orgId,
      sceneId: 'hq',
      objectId: `mem-art-moved-in-${t.id.slice(0, 8)}`,
      title: 'We moved into Minglewood',
      story: `On this day ${t.name} got a place of its own. Every launch, award and offsite from here on can leave something behind.`,
      kind: 'milestone',
      occurredAt: t.createdAt.slice(0, 10),
      teamIds: ['team-everyone'],
      contributorIds: [],
      placement: slot,
    },
  ];
  return { org, world, departments, teams, rooms, events, artifacts };
}
