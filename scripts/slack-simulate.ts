// Plays Slack against a local server started with SLACK_MOCK=true (see docs/slack.md): sends the same
// signed Events API and slash-command requests Slack would, and reads back what Minglewood sent to "Slack".
//
//   npm run slack:sim -- demo                          link Maya → U1, bind Design Loft → #design, huddle
//   npm run slack:sim -- link U1 maya                  make a demo coworker Slack user U1
//   npm run slack:sim -- bind design C0DESIGN [text]   bind a room to a mock channel (its huddle; with `text`, its conversation too)
//   npm run slack:sim -- say U1 C0DESIGN "hello"       U1 posts in #design (shows up in the space, bubble if they're there)
//   npm run slack:sim -- rename C0DESIGN design-crew   Slack renamed the channel (the space's label follows)
//   npm run slack:sim -- archive C0DESIGN              Slack archived the channel (the space is unlinked)
//   npm run slack:sim -- history C0DESIGN              what the mock channel holds (what the world posted, and `say`s)
//   npm run slack:sim -- huddle U1 C0DESIGN            U1 joins the huddle in #design
//   npm run slack:sim -- leave U1                      U1 leaves their huddle
//   npm run slack:sim -- status U1 :spiral_calendar_pad: "In a meeting"
//   npm run slack:sim -- dnd U1 on|off
//   npm run slack:sim -- cmd U1 "where is maya"        run /minglewood as U1
//   npm run slack:sim -- unfurl "http://localhost:5173/?room=design"
//   npm run slack:sim -- outbox                        what Minglewood sent to Slack
//
// SLACK_SIM_URL (default http://localhost:8787) and SLACK_SIGNING_SECRET (default the mock's) override.
import { slackSignature } from '../src/server/slack/verify';

const base = (process.env.SLACK_SIM_URL ?? `http://localhost:${process.env.API_PORT ?? 8787}`).replace(/\/$/, '');
const secret = process.env.SLACK_SIGNING_SECRET || 'mock-signing-secret';
const team = process.env.SLACK_TEAM_ID || 'T0MOCK';
const publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:5173';

const huddles = new Map<string, string>();

async function signed(path: string, body: string, type: string) {
  const ts = String(Math.floor(Date.now() / 1000));
  const res = await fetch(`${base}/api/slack/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': type, 'X-Slack-Request-Timestamp': ts, 'X-Slack-Signature': slackSignature(secret, ts, body) },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  return text;
}

const event = (ev: Record<string, unknown>) => signed('events', JSON.stringify({ type: 'event_callback', team_id: team, event: ev }), 'application/json');

async function dev(path: string, json: unknown) {
  const res = await fetch(`${base}/api/slack/dev/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
  const body = await res.json();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function huddle(user: string, channel: string) {
  const call = huddles.get(channel) ?? `R${channel.slice(1)}`;
  huddles.set(channel, call);
  await event({ type: 'user_huddle_changed', user: { id: user, profile: { huddle_state: 'in_a_huddle', huddle_state_call_id: call } } });
  await event({ type: 'message', subtype: 'huddle_thread', channel, ts: `${Date.now() / 1000}`, room: { id: call, participants: [user], has_ended: false } });
  console.log(`${user} is in the huddle in ${channel}`);
}

async function main() {
  const [verb, ...args] = process.argv.slice(2);
  switch (verb) {
    case 'demo':
      console.log(await dev('link', { userId: 'U1', member: 'maya' }));
      await dev('bind', { roomId: 'design', channelId: 'C0DESIGN' });
      console.log('Design Loft ↔ #design');
      await huddle('U1', 'C0DESIGN');
      console.log(await signed('commands', new URLSearchParams({ team_id: team, user_id: 'U1', command: '/minglewood', text: '' }).toString(), 'application/x-www-form-urlencoded'));
      return;
    case 'link':
      return console.log(await dev('link', { userId: args[0], member: args[1] }));
    case 'bind':
      await dev('bind', { roomId: args[0], channelId: args[1], text: args[2] === 'text' });
      return console.log(`${args[0]} ↔ ${args[1]}${args[2] === 'text' ? ' (text + huddle)' : ''}`);
    case 'say': {
      const ts = `${Math.floor(Date.now() / 1000)}.${String(Date.now() % 1000000).padStart(6, '0')}`;
      await event({ type: 'message', channel: args[1] ?? 'C0DESIGN', user: args[0], text: args.slice(2).join(' ') || 'hello from Slack', ts });
      return console.log(`${args[0]} said in ${args[1] ?? 'C0DESIGN'}`);
    }
    case 'rename':
      await event({ type: 'channel_rename', channel: { id: args[0], name: args[1] } });
      return console.log(`${args[0]} is now #${args[1]}`);
    case 'archive':
      await event({ type: 'channel_archive', channel: args[0], user: 'U1' });
      return console.log(`${args[0]} archived`);
    case 'history': {
      const { outbox } = (await (await fetch(`${base}/api/slack/dev/outbox`)).json()) as { outbox: Array<{ method: string; args: { channel?: string; text?: string; username?: string } }> };
      for (const c of outbox.filter((x) => x.method === 'chat.postMessage' && x.args.channel === (args[0] ?? 'C0DESIGN'))) console.log(`${c.args.username ?? '(app)'}: ${c.args.text}`);
      return;
    }
    case 'huddle':
      return huddle(args[0], args[1] ?? 'C0DESIGN');
    case 'leave':
      await event({ type: 'user_huddle_changed', user: { id: args[0], profile: { huddle_state: 'default_unset' } } });
      return console.log(`${args[0]} left their huddle`);
    case 'status':
      await event({ type: 'user_change', user: { id: args[0], profile: { status_emoji: args[1] ?? '', status_text: args[2] ?? '', status_expiration: 0 } } });
      return console.log(`${args[0]} status → ${args[1] ?? ''} ${args[2] ?? ''}`);
    case 'dnd':
      await event({ type: 'dnd_updated_user', user: args[0], dnd_status: { snooze_enabled: args[1] !== 'off' } });
      return console.log(`${args[0]} DND ${args[1] !== 'off' ? 'on' : 'off'}`);
    case 'cmd':
      return console.log(
        JSON.parse(await signed('commands', new URLSearchParams({ team_id: team, user_id: args[0], command: '/minglewood', text: args.slice(1).join(' ') }).toString(), 'application/x-www-form-urlencoded')).text,
      );
    case 'unfurl':
      await event({ type: 'link_shared', channel: 'C0HQ', message_ts: `${Date.now() / 1000}`, links: [{ url: args[0] ?? `${publicUrl}/?room=design` }] });
      await new Promise((r) => setTimeout(r, 200));
      return printOutbox(1);
    case 'outbox':
      return printOutbox(Number(args[0] ?? 10));
    default:
      console.log('usage: see the top of scripts/slack-simulate.ts');
      process.exitCode = 1;
  }
}

async function printOutbox(n: number) {
  const { outbox } = (await (await fetch(`${base}/api/slack/dev/outbox`)).json()) as { outbox: Array<{ method: string; args: unknown; at: string }> };
  for (const c of outbox.slice(-n)) console.log(`${c.at}  ${c.method}\n${JSON.stringify(c.args, null, 2)}\n`);
  if (!outbox.length) console.log('(nothing sent yet)');
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
