/**
 * Northstar Labs — the fictional demo organization. Everything here is invented.
 * `buildSeed(now)` materializes relative dates so the demo always feels current.
 */
import type {
  AvatarLoadout,
  Department,
  HistoricalArtifact,
  Member,
  OrgEvent,
  Organization,
  PresenceStatus,
  Room,
  RoomBinding,
  Team,
  World,
} from '../domain/types';

export const ORG_ID = 'org-northstar';

export const ORGANIZATION: Organization = {
  id: ORG_ID,
  slug: 'northstar',
  name: 'Northstar Labs',
  tagline: 'Tools that help small teams ship with confidence.',
  timezone: 'America/Toronto',
  foundedAt: '2019-04-02',
  worldId: 'world-northstar',
};

export const WORLD: World = {
  id: 'world-northstar',
  orgId: ORG_ID,
  name: 'Northstar Town',
  theme: 'lakeside',
  outdoorSceneId: 'town',
  districts: [
    { id: 'd-center', name: 'Town Center', description: 'HQ, the plaza and the fountain.', departmentIds: ['dep-people', 'dep-sales'] },
    { id: 'd-makers', name: 'Makers’ Row', description: 'Where things get built and designed.', departmentIds: ['dep-eng', 'dep-design', 'dep-product'] },
    { id: 'd-lakeside', name: 'Lakeside', description: 'Coffee, games and celebrations by the water.', departmentIds: ['dep-marketing'] },
    { id: 'd-grove', name: 'The Grove', description: 'Quiet woods for deep work.', departmentIds: [] },
  ],
};

export const DEPARTMENTS: Department[] = [
  { id: 'dep-product', orgId: ORG_ID, name: 'Product', color: '#f2a93b', districtId: 'd-makers' },
  { id: 'dep-eng', orgId: ORG_ID, name: 'Engineering', color: '#3f8fd8', districtId: 'd-makers' },
  { id: 'dep-design', orgId: ORG_ID, name: 'Design', color: '#e27c62', districtId: 'd-makers' },
  { id: 'dep-sales', orgId: ORG_ID, name: 'Sales', color: '#2bb3a3', districtId: 'd-center' },
  { id: 'dep-marketing', orgId: ORG_ID, name: 'Marketing', color: '#d65fa6', districtId: 'd-lakeside' },
  { id: 'dep-people', orgId: ORG_ID, name: 'People', color: '#8f6bd6', districtId: 'd-center' },
];

export const TEAMS: Team[] = [
  { id: 'team-leadership', orgId: ORG_ID, departmentId: 'dep-product', name: 'Founders', emoji: '🌟', homeRoomId: 'hq', blurb: 'Keeping the lights on and the compass pointed north.' },
  { id: 'team-product', orgId: ORG_ID, departmentId: 'dep-product', name: 'Product Crew', emoji: '🧭', homeRoomId: 'launch', blurb: 'Figuring out what to build next, and why.' },
  { id: 'team-aurora', orgId: ORG_ID, departmentId: 'dep-eng', name: 'Aurora Squad', emoji: '🚀', homeRoomId: 'launch', blurb: 'Shipping Aurora 2.0 — offline sync and a brand-new onboarding.' },
  { id: 'team-platform', orgId: ORG_ID, departmentId: 'dep-eng', name: 'Platform', emoji: '🛠️', homeRoomId: 'eng', blurb: 'APIs, infra, and the famously retired build server.' },
  { id: 'team-mobile', orgId: ORG_ID, departmentId: 'dep-eng', name: 'Mobile', emoji: '📱', homeRoomId: 'eng', blurb: 'iOS and Android, pixel-perfect and battery-friendly.' },
  { id: 'team-design', orgId: ORG_ID, departmentId: 'dep-design', name: 'Design Studio', emoji: '🎨', homeRoomId: 'design', blurb: 'Product, brand and the occasional hand-lettered sign.' },
  { id: 'team-sales', orgId: ORG_ID, departmentId: 'dep-sales', name: 'Sales & Success', emoji: '🤝', homeRoomId: 'hq', blurb: 'Helping customers find us — and stay happy.' },
  { id: 'team-marketing', orgId: ORG_ID, departmentId: 'dep-marketing', name: 'Brand & Growth', emoji: '📣', homeRoomId: 'cafe', blurb: 'Stories, launches, and the newsletter people actually read.' },
  { id: 'team-people', orgId: ORG_ID, departmentId: 'dep-people', name: 'People & Culture', emoji: '🌱', homeRoomId: 'events', blurb: 'Hiring, onboarding and every party worth throwing.' },
];

export const ROOMS: Room[] = [
  { id: 'hq', buildingObjectId: 'b-hq', name: 'Northstar HQ', purpose: 'hq', districtId: 'd-center', emoji: '🏛️', description: 'The lobby, the history wall, and the people who keep the company pointed north.' },
  { id: 'cafe', buildingObjectId: 'b-cafe', name: 'Tidewater Café', purpose: 'social', districtId: 'd-lakeside', emoji: '☕', ownerTeamId: 'team-marketing', description: 'Casual hangout by the lake. Drop in, grab a coffee, join whoever’s chatting.' },
  { id: 'eng', buildingObjectId: 'b-eng', name: 'Engineering Studio', purpose: 'team', districtId: 'd-makers', emoji: '🛠️', ownerTeamId: 'team-platform', description: 'Home of Platform and Mobile. Whiteboards, pairing, and the Engineering Library.' },
  { id: 'launch', buildingObjectId: 'b-launch', name: 'Launch Lab', purpose: 'project', districtId: 'd-makers', emoji: '🚀', ownerTeamId: 'team-aurora', description: 'Project room for Aurora 2.0. The board is on the wall; the rocket is from 1.0.' },
  { id: 'events', buildingObjectId: 'b-events', name: 'Lantern Hall', purpose: 'event', districtId: 'd-lakeside', emoji: '🏮', ownerTeamId: 'team-people', description: 'All-hands, demo days, birthdays and launch parties.' },
  { id: 'focus', buildingObjectId: 'b-focus', name: 'The Quiet Grove', purpose: 'focus', districtId: 'd-grove', emoji: '🌲', quiet: true, description: 'A cabin in the woods for deep work. Everyone inside is focused; knocks wait.' },
  { id: 'arcade', buildingObjectId: 'b-arcade', name: 'Pixel Pier Arcade', purpose: 'recreation', districtId: 'd-lakeside', emoji: '🕹️', description: 'Games, pool, and a champion cabinet from the 2025 offsite.' },
  { id: 'design', buildingObjectId: 'b-design', name: 'Design Loft', purpose: 'team', districtId: 'd-makers', emoji: '🎨', ownerTeamId: 'team-design', description: 'Moodboards, easels and very strong opinions about kerning.' },
];

/** Demo bindings. In a connected org these point at real Discord channels (see admin). */
export const DEMO_BINDINGS: RoomBinding[] = [
  { id: 'bind-cafe', orgId: ORG_ID, roomId: 'cafe', provider: 'demo', kind: 'voice', externalChannelId: 'demo-cafe', label: '☕ café-hangout' },
  { id: 'bind-hq', orgId: ORG_ID, roomId: 'hq', provider: 'demo', kind: 'voice', externalChannelId: 'demo-hq', label: '🏛️ town-square' },
  { id: 'bind-eng', orgId: ORG_ID, roomId: 'eng', provider: 'demo', kind: 'voice', externalChannelId: 'demo-eng', label: '🛠️ eng-commons' },
  { id: 'bind-launch', orgId: ORG_ID, roomId: 'launch', provider: 'demo', kind: 'voice', externalChannelId: 'demo-launch', label: '🚀 aurora-war-room' },
  { id: 'bind-events', orgId: ORG_ID, roomId: 'events', provider: 'demo', kind: 'stage', externalChannelId: 'demo-events', label: '🏮 lantern-hall-stage' },
  { id: 'bind-arcade', orgId: ORG_ID, roomId: 'arcade', provider: 'demo', kind: 'voice', externalChannelId: 'demo-arcade', label: '🕹️ game-night' },
  { id: 'bind-design', orgId: ORG_ID, roomId: 'design', provider: 'demo', kind: 'voice', externalChannelId: 'demo-design', label: '🎨 design-crit' },
];

/* ---------------------------------------------------------------- people */

const L = (
  skin: number,
  hair: string,
  hairColor: string,
  top: string,
  topColor: string,
  bottom: string,
  bottomColor: string,
  accessory = 'acc.none',
  shoes = 'shoes.sneakers',
  shoesColor = '#f4efe6',
): AvatarLoadout => ({
  skin: ['#ffe0c4', '#f6c9a4', '#e8b088', '#c98d62', '#a86b45', '#7c4a2d', '#5a3420'][skin],
  hair: `hair.${hair}`,
  hairColor,
  top: `top.${top}`,
  topColor,
  bottom: `bottom.${bottom}`,
  bottomColor,
  shoes,
  shoesColor,
  accessory: accessory.startsWith('acc.') ? accessory : `acc.${accessory}`,
});

/** Simulation hints for demo coworkers: where they start, where they like to go. */
export interface SimProfile {
  start: string; // scene id
  haunts: string[];
  status: PresenceStatus;
  note?: string;
  /** 0..1 — how often they wander and chat. */
  sociability: number;
}

interface PersonSeed {
  id: string;
  name: string;
  pronouns: string;
  title: string;
  dept: string;
  team: string;
  manager?: string;
  location: string;
  tz: string;
  start: string; // ISO date, or "today"
  ask: string[];
  interests: string[];
  bio: string;
  look: AvatarLoadout;
  sim: SimProfile;
  unlocks?: string[];
  role?: Member['role'];
}

const P: PersonSeed[] = [
  // Leadership
  { id: 'm-grace', name: 'Grace Whitfield', pronouns: 'she/her', title: 'CEO & Co-founder', dept: 'dep-product', team: 'team-leadership', location: 'Toronto', tz: 'America/Toronto', start: '2019-04-02', ask: ['company history', 'fundraising', 'the garage days'], interests: ['sailing', 'sourdough'], bio: 'Started Northstar in a garage with Omar. Still answers every new-hire DM.', look: L(1, 'bob', '#9aa0a8', 'blazer', '#1f2a44', 'chinos', '#8e8a84', 'glasses', 'shoes.loafers', '#6b4a33'), sim: { start: 'hq', haunts: ['hq', 'cafe', 'town'], status: 'available', note: 'office hours till 4', sociability: 0.5 }, unlocks: ['acc.five-year-pin'], role: 'owner' },
  { id: 'm-omar', name: 'Omar Haddad', pronouns: 'he/him', title: 'CTO & Co-founder', dept: 'dep-eng', team: 'team-platform', manager: 'm-grace', location: 'Montréal', tz: 'America/Toronto', start: '2019-04-02', ask: ['system design', 'Postgres', 'mentoring'], interests: ['cycling', 'synths'], bio: 'Wrote the first line of Northstar code. Now mostly draws boxes on whiteboards.', look: L(3, 'buzz', '#2b1d16', 'sweater', '#2bb3a3', 'jeans', '#1f2a44', 'acc.five-year-pin', 'shoes.boots', '#6b4a33'), sim: { start: 'eng', haunts: ['eng', 'cafe', 'launch'], status: 'open', note: 'happy to pair', sociability: 0.6 }, unlocks: ['acc.five-year-pin', 'top.aurora-tee'], role: 'admin' },

  // People & Culture
  { id: 'm-rosa', name: 'Rosa Alvarez', pronouns: 'she/her', title: 'People Partner & Onboarding Buddy', dept: 'dep-people', team: 'team-people', manager: 'm-grace', location: 'Mexico City', tz: 'America/Mexico_City', start: '2021-02-15', ask: ['onboarding', 'benefits', 'where anything is'], interests: ['salsa', 'plants', 'board games'], bio: 'If you are new, Rosa has probably already waved at you.', look: L(2, 'curly', '#2b1d16', 'overalls', '#f2c14e', 'jeans', '#3f8fd8', 'flower'), sim: { start: 'events', haunts: ['events', 'hq', 'cafe'], status: 'open', note: 'decorating for Jonah’s party 🎈', sociability: 0.9 }, role: 'admin' },
  { id: 'm-hana', name: 'Hana Sato', pronouns: 'she/her', title: 'Talent Partner', dept: 'dep-people', team: 'team-people', manager: 'm-rosa', location: 'Vancouver', tz: 'America/Vancouver', start: '2023-06-01', ask: ['referrals', 'interviewing', 'career growth'], interests: ['bouldering', 'matcha'], bio: 'Has met everyone at Northstar at least once — usually in their final interview.', look: L(0, 'ponytail', '#2b1d16', 'shirt', '#f4efe6', 'skirt', '#1f2a44', 'none', 'shoes.loafers', '#3a3a46'), sim: { start: 'events', haunts: ['events', 'cafe', 'hq'], status: 'available', note: 'signing the card 🎂', sociability: 0.8 } },
  { id: 'm-dev', name: 'Dev Malhotra', pronouns: 'he/him', title: 'Workplace Experience', dept: 'dep-people', team: 'team-people', manager: 'm-rosa', location: 'Toronto', tz: 'America/Toronto', start: '2022-09-12', ask: ['offsites', 'swag', 'events'], interests: ['karaoke', 'cricket'], bio: 'Planned the Lisbon offsite. Still has the tram-shaped cookie cutter.', look: L(3, 'swoop', '#2b1d16', 'tee', '#e27ca7', 'shorts', '#8e8a84', 'cap'), sim: { start: 'events', haunts: ['events', 'arcade', 'cafe'], status: 'open', note: 'blowing up balloons', sociability: 0.9 } },

  // Sales & Success
  { id: 'm-marcus', name: 'Marcus Bell', pronouns: 'he/him', title: 'Head of Sales', dept: 'dep-sales', team: 'team-sales', manager: 'm-grace', location: 'Chicago', tz: 'America/Chicago', start: '2020-08-03', ask: ['pricing', 'enterprise deals'], interests: ['jazz', 'grilling'], bio: 'Closed Northstar’s 1,000th customer and got a bench named after it.', look: L(5, 'short', '#2b1d16', 'blazer', '#5b5fc7', 'chinos', '#3a3a46', 'none', 'shoes.loafers', '#2b1d16'), sim: { start: 'hq', haunts: ['hq', 'cafe'], status: 'meeting', note: 'customer call', sociability: 0.4 } },
  { id: 'm-jonah', name: 'Jonah Park', pronouns: 'he/him', title: 'Account Executive', dept: 'dep-sales', team: 'team-sales', manager: 'm-marcus', location: 'Seattle', tz: 'America/Los_Angeles', start: '2022-03-21', ask: ['demos', 'customer stories'], interests: ['birthday cake', 'running', 'K-dramas'], bio: 'It’s his birthday today. He will pretend not to know about the party.', look: L(1, 'swoop', '#5a3825', 'shirt', '#7cc576', 'chinos', '#8e8a84', 'party-hat'), sim: { start: 'events', haunts: ['events', 'cafe'], status: 'open', note: '🎂 birthday!', sociability: 1 }, unlocks: ['hat.party'] },
  { id: 'm-chris', name: 'Chris Okafor', pronouns: 'he/him', title: 'Customer Success Lead', dept: 'dep-sales', team: 'team-sales', manager: 'm-marcus', location: 'Lagos → Toronto', tz: 'America/Toronto', start: '2021-05-10', ask: ['onboarding customers', 'support tooling'], interests: ['afrobeats', 'football'], bio: 'Support won the Customer Hero Award under Chris. The trophy lives in HQ.', look: L(6, 'crop', '#2b1d16', 'hoodie', '#f2c14e', 'jeans', '#1f2a44', 'headphones'), sim: { start: 'cafe', haunts: ['cafe', 'hq', 'arcade'], status: 'open', note: 'grabbing coffee', sociability: 0.8 } },
  { id: 'm-elena', name: 'Elena Petrova', pronouns: 'she/her', title: 'Solutions Engineer', dept: 'dep-sales', team: 'team-sales', manager: 'm-marcus', location: 'Berlin', tz: 'Europe/Berlin', start: '2023-01-09', ask: ['integrations', 'security reviews'], interests: ['chess', 'techno'], bio: 'Speaks four languages and fluent SAML.', look: L(0, 'long', '#e8c16d', 'sweater', '#9b6bd6', 'jeans', '#3a3a46', 'glasses'), sim: { start: 'hq', haunts: ['hq', 'eng', 'cafe'], status: 'available', sociability: 0.5 } },

  // Marketing
  { id: 'm-sofia', name: 'Sofia Ramirez', pronouns: 'she/her', title: 'Head of Brand', dept: 'dep-marketing', team: 'team-marketing', manager: 'm-grace', location: 'Austin', tz: 'America/Chicago', start: '2021-10-04', ask: ['storytelling', 'launch plans'], interests: ['film photography', 'tacos'], bio: 'Named the café. Fights for the Oxford comma.', look: L(2, 'bun', '#5a3825', 'tee', '#e0503f', 'skirt', '#3a3a46', 'sunglasses'), sim: { start: 'cafe', haunts: ['cafe', 'design', 'events'], status: 'available', note: 'brainstorming launch copy', sociability: 0.8 } },
  { id: 'm-wes', name: 'Wes Turner', pronouns: 'he/him', title: 'Growth Marketer', dept: 'dep-marketing', team: 'team-marketing', manager: 'm-sofia', location: 'Denver', tz: 'America/Denver', start: '2024-02-12', ask: ['SEO', 'experiments'], interests: ['skiing', 'podcasts'], bio: 'Runs the newsletter. Yes, the one with the lake photos.', look: L(1, 'short', '#c98f4a', 'hoodie', '#2bb3a3', 'shorts', '#1f2a44', 'cap'), sim: { start: 'town', haunts: ['town', 'cafe', 'arcade'], status: 'available', sociability: 0.7 } },
  { id: 'm-mira', name: 'Mira Kaur', pronouns: 'she/her', title: 'Content Lead', dept: 'dep-marketing', team: 'team-marketing', manager: 'm-sofia', location: 'London', tz: 'Europe/London', start: '2022-11-01', ask: ['writing', 'customer interviews'], interests: ['poetry', 'tea'], bio: 'Interviewed 60 customers last year. Remembers all of them.', look: L(3, 'long', '#2b1d16', 'sweater', '#f2c14e', 'jeans', '#6b4a33', 'scarf'), sim: { start: 'town', haunts: ['town', 'cafe', 'focus'], status: 'available', sociability: 0.6 } },

  // Product
  { id: 'm-jordan', name: 'Jordan Lee', pronouns: 'they/them', title: 'Product Manager, Aurora', dept: 'dep-product', team: 'team-product', manager: 'm-grace', location: 'Toronto', tz: 'America/Toronto', start: '2022-01-17', ask: ['roadmap', 'Aurora 2.0', 'user research'], interests: ['climbing', 'zines'], bio: 'Leads Aurora. Keeps the board honest and the snacks stocked.', look: L(2, 'crop', '#b8432e', 'shirt', '#3f8fd8', 'chinos', '#3a3a46', 'glasses'), sim: { start: 'launch', haunts: ['launch', 'eng', 'cafe'], status: 'open', note: 'planning Aurora 2.0', sociability: 0.7 }, unlocks: ['top.aurora-tee'] },
  { id: 'm-ines', name: 'Inês Costa', pronouns: 'she/her', title: 'Product Analyst', dept: 'dep-product', team: 'team-product', manager: 'm-jordan', location: 'Lisbon', tz: 'Europe/Lisbon', start: '2023-04-03', ask: ['SQL', 'product questions'], interests: ['surfing', 'pastéis de nata'], bio: 'Hosted everyone in Lisbon for the 2024 offsite.', look: L(2, 'long', '#5a3825', 'tee', '#f4efe6', 'jeans', '#3f8fd8', 'headphones'), sim: { start: 'focus', haunts: ['focus', 'launch', 'cafe'], status: 'focused', note: 'deep in a dashboard', sociability: 0.3 } },
  { id: 'm-noor', name: 'Noor Rahman', pronouns: 'she/her', title: 'Product Manager, Platform', dept: 'dep-product', team: 'team-product', manager: 'm-grace', location: 'Dubai', tz: 'Asia/Dubai', start: '2023-08-14', ask: ['APIs', 'developer experience'], interests: ['calligraphy', 'hiking'], bio: 'Believes every API deserves a good error message.', look: L(3, 'bun', '#2b1d16', 'blazer', '#2bb3a3', 'skirt', '#1f2a44'), sim: { start: 'eng', haunts: ['eng', 'launch', 'hq'], status: 'meeting', note: 'Product review', sociability: 0.5 } },

  // Design
  { id: 'm-maya', name: 'Maya Chen', pronouns: 'she/her', title: 'Product Designer', dept: 'dep-design', team: 'team-design', manager: 'm-leo', location: 'San Francisco', tz: 'America/Los_Angeles', start: '2021-07-19', ask: ['onboarding UX', 'illustration', 'Figma tricks'], interests: ['ceramics', 'climbing', 'lo-fi beats'], bio: 'Redesigning onboarding. Will absolutely ask you what your first day felt like.', look: L(0, 'bob', '#2b1d16', 'overalls', '#e27ca7', 'jeans', '#f4efe6', 'glasses'), sim: { start: 'cafe', haunts: ['cafe', 'design', 'launch'], status: 'open', note: 'grabbing coffee ☕', sociability: 0.8 } },
  { id: 'm-leo', name: 'Leo Martins', pronouns: 'he/him', title: 'Design Lead', dept: 'dep-design', team: 'team-design', manager: 'm-grace', location: 'Porto', tz: 'Europe/Lisbon', start: '2020-11-02', ask: ['design systems', 'brand', 'critique'], interests: ['type design', 'football'], bio: 'Drew the Northstar logo on a napkin. The napkin is framed somewhere.', look: L(1, 'curly', '#5a3825', 'sweater', '#e0503f', 'chinos', '#3a3a46', 'none', 'shoes.boots', '#6b4a33'), sim: { start: 'design', haunts: ['design', 'cafe', 'launch'], status: 'available', sociability: 0.6 } },
  { id: 'm-aiko', name: 'Aiko Tanaka', pronouns: 'she/her', title: 'Brand Designer', dept: 'dep-design', team: 'team-design', manager: 'm-leo', location: 'Osaka', tz: 'Asia/Tokyo', start: '2024-05-06', ask: ['illustration', 'motion'], interests: ['pixel art', 'cats'], bio: 'Drew most of the little pixel plants you see around town.', look: L(0, 'bun', '#d65fa6', 'hoodie', '#9b6bd6', 'skirt', '#3a3a46', 'headphones'), sim: { start: 'design', haunts: ['design', 'arcade'], status: 'focused', note: 'illustrating', sociability: 0.4 } },
  { id: 'm-ava', name: 'Ava Brooks', pronouns: 'she/her', title: 'UX Researcher', dept: 'dep-design', team: 'team-aurora', manager: 'm-leo', location: 'Melbourne', tz: 'Australia/Melbourne', start: '2023-10-09', ask: ['research', 'interviews'], interests: ['birding', 'crosswords'], bio: 'Has watched 40 people try the new onboarding. Has notes.', look: L(1, 'ponytail', '#c98f4a', 'shirt', '#7cc576', 'jeans', '#1f2a44'), sim: { start: 'launch', haunts: ['launch', 'design', 'cafe'], status: 'available', sociability: 0.6 } },

  // Engineering — Platform
  { id: 'm-ben', name: 'Ben Adler', pronouns: 'he/him', title: 'Backend Engineer', dept: 'dep-eng', team: 'team-platform', manager: 'm-priya', location: 'Toronto', tz: 'America/Toronto', start: '2022-06-06', ask: ['Postgres', 'queues', 'the sync engine'], interests: ['bread', 'mechanical keyboards'], bio: 'Focused most mornings. Very chatty after lunch.', look: L(0, 'short', '#8a5a32', 'hoodie', '#3a3a46', 'jeans', '#1f2a44', 'headphones'), sim: { start: 'eng', haunts: ['eng', 'focus', 'cafe'], status: 'focused', note: 'deep in the migration', sociability: 0.4 } },
  { id: 'm-priya', name: 'Priya Nair', pronouns: 'she/her', title: 'Staff Engineer', dept: 'dep-eng', team: 'team-platform', manager: 'm-omar', location: 'Bengaluru → Toronto', tz: 'America/Toronto', start: '2020-03-16', ask: ['architecture', 'career growth', 'incident reviews'], interests: ['climbing', 'Carnatic music'], bio: 'Runs Thursday office hours. Mentored half of Engineering.', look: L(4, 'long', '#2b1d16', 'blazer', '#7cc576', 'chinos', '#3a3a46', 'glasses'), sim: { start: 'eng', haunts: ['eng', 'launch', 'cafe'], status: 'open', note: 'office hours — drop by', sociability: 0.7 }, unlocks: ['acc.five-year-pin'] },
  { id: 'm-kenji', name: 'Kenji Mori', pronouns: 'he/him', title: 'Infrastructure Engineer', dept: 'dep-eng', team: 'team-platform', manager: 'm-priya', location: 'Tokyo', tz: 'Asia/Tokyo', start: '2021-09-01', ask: ['Kubernetes', 'on-call'], interests: ['bonsai', 'arcade games'], bio: 'Retired “The Toaster” build server and gave it a eulogy.', look: L(1, 'swoop', '#2b1d16', 'tee', '#3a3a46', 'jeans', '#3a3a46', 'none', 'shoes.sneakers', '#e0503f'), sim: { start: 'eng', haunts: ['eng', 'arcade'], status: 'available', sociability: 0.5 } },
  { id: 'm-lena', name: 'Lena Fischer', pronouns: 'she/her', title: 'Security Engineer', dept: 'dep-eng', team: 'team-platform', manager: 'm-priya', location: 'Munich', tz: 'Europe/Berlin', start: '2022-10-10', ask: ['threat modeling', 'auth'], interests: ['rowing', 'escape rooms'], bio: 'Will happily review your OAuth scopes. Please ask for fewer.', look: L(0, 'bob', '#e8c16d', 'sweater', '#1f2a44', 'jeans', '#8e8a84', 'glasses'), sim: { start: 'eng', haunts: ['eng', 'focus'], status: 'focused', sociability: 0.3 } },
  { id: 'm-arjun', name: 'Arjun Shah', pronouns: 'he/him', title: 'Backend Engineer', dept: 'dep-eng', team: 'team-platform', manager: 'm-priya', location: 'Toronto', tz: 'America/Toronto', start: '2024-09-03', ask: ['APIs', 'Go'], interests: ['cricket', 'cooking'], bio: 'Second year at Northstar; first year was mostly learning where things are.', look: L(4, 'short', '#2b1d16', 'shirt', '#f4efe6', 'chinos', '#6b4a33'), sim: { start: 'eng', haunts: ['eng', 'cafe', 'town'], status: 'available', sociability: 0.6 } },

  // Engineering — Mobile
  { id: 'm-zoe', name: 'Zoe Martin', pronouns: 'she/her', title: 'Mobile Engineering Lead', dept: 'dep-eng', team: 'team-mobile', manager: 'm-omar', location: 'Paris', tz: 'Europe/Paris', start: '2021-01-11', ask: ['iOS', 'SwiftUI', 'hiring'], interests: ['vinyl', 'running'], bio: 'Ships on Tuesdays. Bakes on Fridays.', look: L(2, 'short', '#b8432e', 'tee', '#5b5fc7', 'jeans', '#1f2a44', 'none', 'shoes.sneakers', '#f2c14e'), sim: { start: 'eng', haunts: ['eng', 'cafe'], status: 'available', sociability: 0.6 } },
  { id: 'm-kai', name: 'Kai Nakamura', pronouns: 'he/they', title: 'Android Engineer', dept: 'dep-eng', team: 'team-mobile', manager: 'm-zoe', location: 'Honolulu', tz: 'Pacific/Honolulu', start: '2023-03-06', ask: ['Kotlin', 'surfing'], interests: ['surfing', 'ukulele'], bio: 'Holds the Offsite ’25 arcade crown. Accepts challengers.', look: L(3, 'curly', '#2b1d16', 'hoodie', '#ff8a3d', 'shorts', '#2bb3a3', 'sunglasses'), sim: { start: 'arcade', haunts: ['arcade', 'eng', 'town'], status: 'open', note: 'lunch break 🎮', sociability: 0.9 } },
  { id: 'm-theo', name: 'Theo Grant', pronouns: 'he/him', title: 'iOS Engineer', dept: 'dep-eng', team: 'team-mobile', manager: 'm-zoe', location: 'Dublin', tz: 'Europe/Dublin', start: '2024-01-15', ask: ['accessibility', 'animations'], interests: ['pinball', 'hurling'], bio: 'Made VoiceOver work beautifully in the app. Ask him about rotors.', look: L(0, 'crop', '#c98f4a', 'tee', '#e0503f', 'jeans', '#3a3a46', 'cap'), sim: { start: 'arcade', haunts: ['arcade', 'eng'], status: 'available', note: 'pool rematch', sociability: 0.8 } },

  // Engineering — Aurora squad
  { id: 'm-nia', name: 'Nia Thompson', pronouns: 'she/her', title: 'Full-stack Engineer', dept: 'dep-eng', team: 'team-aurora', manager: 'm-omar', location: 'Atlanta', tz: 'America/New_York', start: '2022-07-25', ask: ['offline sync', 'React'], interests: ['roller skating', 'sci-fi'], bio: 'Building offline sync for Aurora 2.0. Has a theory about CRDTs.', look: L(5, 'curly', '#2b1d16', 'shirt', '#9b6bd6', 'jeans', '#1f2a44', 'none', 'shoes.sneakers', '#e27ca7'), sim: { start: 'launch', haunts: ['launch', 'eng', 'cafe'], status: 'open', sociability: 0.6 }, unlocks: ['top.aurora-tee'] },
  { id: 'm-sam', name: 'Sam Rivera', pronouns: 'he/him', title: 'Full-stack Engineer', dept: 'dep-eng', team: 'team-aurora', manager: 'm-omar', location: 'Toronto', tz: 'America/Toronto', start: '2021-12-06', ask: ['TypeScript', 'testing'], interests: ['board games', 'hot sauce'], bio: 'Wore the Aurora launch tee three days straight in 2025.', look: L(2, 'short', '#2b1d16', 'aurora-tee', '#1f2a44', 'jeans', '#3f8fd8'), sim: { start: 'launch', haunts: ['launch', 'eng', 'arcade'], status: 'available', note: 'pairing with Nia', sociability: 0.6 }, unlocks: ['top.aurora-tee'] },

  // Newer folks
  { id: 'm-luca', name: 'Luca Romano', pronouns: 'he/him', title: 'Sales Development Rep', dept: 'dep-sales', team: 'team-sales', manager: 'm-marcus', location: 'Milan', tz: 'Europe/Rome', start: '2026-08-31', ask: ['anything! I’m new'], interests: ['espresso', 'cycling'], bio: 'Four weeks in. Still getting lost between HQ and the café.', look: L(1, 'curly', '#2b1d16', 'shirt', '#3f8fd8', 'chinos', '#8e8a84', 'none', 'shoes.loafers', '#6b4a33'), sim: { start: 'town', haunts: ['town', 'cafe', 'hq'], status: 'open', note: 'exploring', sociability: 0.8 } },
  { id: 'm-alex', name: 'Alex Kim', pronouns: 'they/them', title: 'Frontend Engineer', dept: 'dep-eng', team: 'team-aurora', manager: 'm-omar', location: 'Vancouver', tz: 'America/Vancouver', start: 'today', ask: ['I just joined!', 'CSS'], interests: ['film', 'hiking', 'ramen'], bio: 'First day! Exploring the town and trying to remember everyone’s name.', look: L(2, 'bob', '#4a6fd1', 'northstar-hoodie', '#3f8fd8', 'jeans', '#1f2a44', 'none', 'shoes.sneakers', '#7cc576'), sim: { start: 'town', haunts: ['town', 'hq', 'eng', 'cafe'], status: 'open', note: 'first day 👋', sociability: 0.9 }, unlocks: ['top.northstar-hoodie'] },
  { id: 'm-diego', name: 'Diego Fernández', pronouns: 'he/him', title: 'Support Specialist', dept: 'dep-sales', team: 'team-sales', manager: 'm-chris', location: 'Bogotá', tz: 'America/Bogota', start: '2025-04-14', ask: ['customer issues', 'docs'], interests: ['salsa', 'coffee roasting'], bio: 'Roasts his own coffee and has Opinions about the café’s.', look: L(3, 'short', '#2b1d16', 'tee', '#7cc576', 'jeans', '#1f2a44', 'headphones'), sim: { start: 'town', haunts: ['town', 'cafe', 'hq'], status: 'available', sociability: 0.7 } },
  { id: 'm-tomas', name: 'Tomás Silva', pronouns: 'he/him', title: 'Designer, Marketing', dept: 'dep-design', team: 'team-design', manager: 'm-leo', location: 'São Paulo', tz: 'America/Sao_Paulo', start: '2024-07-01', ask: ['landing pages', 'illustration'], interests: ['skateboarding', 'samba'], bio: 'Makes the launch posters. Ask him for a sneak peek of the Aurora 2.0 one.', look: L(4, 'swoop', '#2b1d16', 'tee', '#f2c14e', 'shorts', '#3a3a46', 'cap', 'shoes.sneakers', '#e0503f'), sim: { start: 'cafe', haunts: ['cafe', 'design', 'arcade'], status: 'available', sociability: 0.8 } },
];

/** Personal touches layered on top of each base look (the catalog grew after the seed was written). */
const EXTRAS: Record<string, Partial<AvatarLoadout>> = {
  'm-grace': { eyes: 'eyes.lashes', neck: 'neck.necklace', faceDetail: 'fd.mole' },
  'm-omar': { facialHair: 'fh.beard', brows: 'brows.bold', held: 'held.coffee' },
  'm-rosa': { eyes: 'eyes.happy', faceDetail: 'fd.freckles', held: 'held.balloon', heldColor: '#e27ca7' },
  'm-hana': { eyes: 'eyes.wide', eyeColor: '#5a3825', held: 'held.boba' },
  'm-dev': { accessory: 'acc.none', headwear: 'hat.turban', headwearColor: '#e0503f', facialHair: 'fh.beard', mouth: 'mouth.grin' },
  'm-marcus': { facialHair: 'fh.goatee', neck: 'neck.tie', neckColor: '#f2c14e' },
  'm-jonah': { eyes: 'eyes.happy', mouth: 'mouth.grin' },
  'm-chris': { held: 'held.coffee', mouth: 'mouth.grin' },
  'm-elena': { eyes: 'eyes.lashes', accessory: 'acc.earrings', eyewear: 'eye.round' },
  'm-sofia': { hairHighlight: '#e27ca7', mouth: 'mouth.smirk' },
  'm-wes': { pet: 'pet.dog', petColor: '#c98f4a', held: 'held.coffee' },
  'm-mira': { held: 'held.book', heldColor: '#9b6bd6', eyes: 'eyes.lashes' },
  'm-jordan': { faceDetail: 'fd.freckles', held: 'held.laptop', topPattern: 'pat.check', topAccent: '#1f2a44' },
  'm-noor': { headwear: 'hat.hijab', headwearColor: '#2bb3a3', eyes: 'eyes.lashes' },
  'm-maya': { pet: 'pet.cat', petColor: '#3a3a46', held: 'held.coffee' },
  'm-leo': { facialHair: 'fh.stubble' },
  'm-aiko': { held: 'held.plant', hairHighlight: '#9b6bd6', eyes: 'eyes.sparkle' },
  'm-ava': { faceDetail: 'fd.freckles', accessory: 'acc.rainbow-pin' },
  'm-ben': { pet: 'pet.dog', petColor: '#e8a15a', facialHair: 'fh.stubble', eyes: 'eyes.sleepy' },
  'm-priya': { hair: 'hair.braids', eyes: 'eyes.lashes', accessory: 'acc.earrings' },
  'm-kenji': { hair: 'hair.undercut', mouth: 'mouth.neutral' },
  'm-lena': { hair: 'hair.bangs' },
  'm-arjun': { facialHair: 'fh.mustache' },
  'm-zoe': { hair: 'hair.pixie', faceDetail: 'fd.blush' },
  'm-kai': { pet: 'pet.duck', petColor: '#fffaf0', mouth: 'mouth.tongue' },
  'm-theo': { accessory: 'acc.hearing-aid', headwear: 'hat.capback', headwearColor: '#e0503f' },
  'm-nia': { hair: 'hair.afro', shoes: 'shoes.skates', shoesColor: '#e27ca7' },
  'm-sam': { hair: 'hair.curlyshort', held: 'held.icecream' },
  'm-luca': { held: 'held.coffee' },
  'm-alex': { hairHighlight: '#9fe3e0', eyes: 'eyes.wide', eyeColor: '#3f7fbf' },
  'm-diego': { held: 'held.coffee', hair: 'hair.locs' },
  'm-tomas': { hair: 'hair.mullet', held: 'held.book', heldColor: '#f2c14e' },
};

/** Deterministic mock calendar for demo coworkers (see calendar provider abstraction). */
export const DEMO_CALENDAR: Array<{ memberIds: string[]; title: string; offsetMin: number; durationMin: number; roomId?: string }> = [
  { memberIds: ['m-noor', 'm-marcus'], title: 'Product review', offsetMin: -10, durationMin: 40 },
  { memberIds: ['m-grace', 'm-omar'], title: 'Founders 1:1', offsetMin: 25, durationMin: 30 },
  { memberIds: ['m-jordan', 'm-nia', 'm-sam', 'm-ava'], title: 'Aurora stand-up', offsetMin: 50, durationMin: 15, roomId: 'launch' },
];

/** A natural mix of body bases across the demo cast (anyone can change theirs in the wardrobe). */
const SOFT_BODY = new Set(['m-hana', 'm-elena', 'm-sofia', 'm-mira', 'm-ines', 'm-maya', 'm-aiko', 'm-ava', 'm-priya', 'm-lena', 'm-kai', 'm-nia', 'm-zoe', 'm-rosa']);

export function buildSeed(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const members: Member[] = P.map((p) => ({
    id: p.id,
    orgId: ORG_ID,
    displayName: p.name,
    pronouns: p.pronouns,
    title: p.title,
    departmentId: p.dept,
    teamId: p.team,
    managerId: p.manager,
    location: p.location,
    timezone: p.tz,
    startDate: p.start === 'today' ? today : p.start,
    askMeAbout: p.ask,
    interests: p.interests,
    bio: p.bio,
    role: p.role ?? 'member',
    avatar: { body: SOFT_BODY.has(p.id) ? 'body.b' : 'body.a', ...p.look, ...EXTRAS[p.id] },
    unlockedItems: p.unlocks ?? [],
    simulated: true,
    settings: { locationVisibility: 'everyone', knocksWhileFocused: false },
  }));
  const sim: Record<string, SimProfile> = Object.fromEntries(P.map((p) => [p.id, p.sim]));

  const at = (min: number) => new Date(now.getTime() + min * 60_000).toISOString();
  const events: OrgEvent[] = [
    {
      id: 'ev-jonah-bday',
      orgId: ORG_ID,
      title: 'Jonah’s birthday party',
      kind: 'birthday',
      roomId: 'events',
      startsAt: at(-20),
      endsAt: at(240),
      hostIds: ['m-rosa', 'm-dev'],
      description: 'Cake at Lantern Hall! Drop by, sign the card, grab a party hat.',
      rewardItemId: 'hat.party',
      decor: 'balloons',
    },
    {
      id: 'ev-demo-day',
      orgId: ORG_ID,
      title: 'Friday Demo Day',
      kind: 'demo-day',
      roomId: 'events',
      startsAt: at(26 * 60),
      endsAt: at(27 * 60),
      hostIds: ['m-jordan'],
      description: 'Five-minute demos from every team. Aurora is showing offline sync.',
      decor: 'stage',
    },
    {
      id: 'ev-aurora-launch',
      orgId: ORG_ID,
      title: 'Aurora 2.0 launch party',
      kind: 'launch',
      roomId: 'launch',
      startsAt: at(9 * 24 * 60),
      endsAt: at(9 * 24 * 60 + 120),
      hostIds: ['m-jordan', 'm-sofia'],
      description: 'When we ship, a new artifact joins the Launch Lab.',
      decor: 'launch',
    },
  ];

  const artifacts: HistoricalArtifact[] = [
    { id: 'art-founders-oak', orgId: ORG_ID, sceneId: 'town', objectId: 'founders-oak', title: 'The Founders’ Oak', story: 'Planted the week Grace and Omar incorporated Northstar. Every anniversary, someone hangs a new lantern on it.', kind: 'tradition', occurredAt: '2019-04-09', teamIds: ['team-leadership'], contributorIds: ['m-grace', 'm-omar'] },
    { id: 'art-1000-bench', orgId: ORG_ID, sceneId: 'town', objectId: 'bench-1000', title: 'The 1,000th Customer Bench', story: 'Marcus closed customer #1,000 — a bakery in Halifax. The plaque reads: “For Daisy’s Bakery, who believed early.”', kind: 'milestone', occurredAt: '2023-05-18', teamIds: ['team-sales'], contributorIds: ['m-marcus', 'm-chris'] },
    { id: 'art-aurora-statue', orgId: ORG_ID, sceneId: 'town', objectId: 'rocket-statue', title: 'Aurora 1.0 Launch Monument', story: 'Aurora 1.0 shipped on March 12, 2025 after an eleven-week sprint. Everyone who shipped it got the launch tee.', kind: 'launch', occurredAt: '2025-03-12', teamIds: ['team-aurora', 'team-product'], contributorIds: ['m-jordan', 'm-nia', 'm-sam', 'm-omar'] },
    { id: 'art-lighthouse', orgId: ORG_ID, sceneId: 'town', objectId: 'lighthouse', title: 'The Little Light', story: 'Added for Northstar’s 5th anniversary. It blinks once for every year we’ve been around.', kind: 'milestone', occurredAt: '2024-04-02', teamIds: [], contributorIds: ['m-grace'] },
    { id: 'art-garage', orgId: ORG_ID, sceneId: 'hq', objectId: 'hq-3', title: 'The Garage, 2019', story: 'A photo of the first “office”: two laptops, one space heater, and a whiteboard that said “ship it”.', kind: 'milestone', occurredAt: '2019-04-02', teamIds: ['team-leadership'], contributorIds: ['m-grace', 'm-omar'] },
    { id: 'art-first-customer', orgId: ORG_ID, sceneId: 'hq', objectId: 'hq-4', title: 'First Customer Invoice', story: '$49. Framed. Signed by the whole team at the time — all four of them.', kind: 'milestone', occurredAt: '2019-09-15', teamIds: [], contributorIds: ['m-grace', 'm-omar', 'm-leo'] },
    { id: 'art-lisbon', orgId: ORG_ID, sceneId: 'hq', objectId: 'hq-5', title: 'Lisbon Offsite, 2024', story: 'Forty-one people, one tram, and Inês’s grandmother’s custard tarts. The group photo is slightly blurry because Dev was laughing.', kind: 'offsite', occurredAt: '2024-10-08', teamIds: ['team-people'], contributorIds: ['m-dev', 'm-ines'] },
    { id: 'art-series-a', orgId: ORG_ID, sceneId: 'hq', objectId: 'hq-6', title: 'Series A Team Photo', story: 'Taken the day we raised our Series A. Half the people in it now lead teams.', kind: 'milestone', occurredAt: '2021-06-01', teamIds: [], contributorIds: ['m-grace'] },
    { id: 'art-support-award', orgId: ORG_ID, sceneId: 'hq', objectId: 'hq-10', title: 'Customer Hero Award 2025', story: 'Awarded to Sales & Success for the year response times dropped under an hour — without anyone working weekends.', kind: 'award', occurredAt: '2025-12-12', teamIds: ['team-sales'], contributorIds: ['m-chris', 'm-diego'] },
    { id: 'art-time-capsule', orgId: ORG_ID, sceneId: 'hq', objectId: 'hq-14', title: 'Time Capsule (open 2029)', story: 'Everyone who joined before 2025 dropped in a note for the company ten years in. No peeking.', kind: 'tradition', occurredAt: '2024-04-02', teamIds: [], contributorIds: [] },
    { id: 'art-aurora-rocket', orgId: ORG_ID, sceneId: 'launch', objectId: 'launch-12', title: 'Aurora 1.0 Rocket', story: 'Built from cardboard during launch week. Signed by the whole squad. Aurora 2.0 gets its own artifact when it ships.', kind: 'launch', occurredAt: '2025-03-12', teamIds: ['team-aurora'], contributorIds: ['m-nia', 'm-sam', 'm-jordan'] },
    { id: 'art-hackathon', orgId: ORG_ID, sceneId: 'launch', objectId: 'launch-13', title: 'Hackathon ’24 Winners', story: 'The offline-mode prototype that became Aurora 2.0 was built here in 48 hours.', kind: 'award', occurredAt: '2024-11-22', teamIds: ['team-aurora'], contributorIds: ['m-nia', 'm-kenji'] },
    { id: 'art-offsite-cabinet', orgId: ORG_ID, sceneId: 'arcade', objectId: 'arcade-5', title: 'Offsite ’25 Champion Cabinet', story: 'Kai won the Star Pong tournament at the 2025 offsite. The cabinet was a gift from the People team.', kind: 'offsite', occurredAt: '2025-09-19', teamIds: ['team-mobile'], contributorIds: ['m-kai', 'm-dev'] },
  ];

  return { members, sim, events, artifacts };
}
