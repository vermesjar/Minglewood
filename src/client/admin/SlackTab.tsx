import { useEffect, useState } from 'react';
import type { AdminOverview, ExternalChannel, ProviderCapabilities } from '@shared/api';
import { BRAND } from '@shared/brand';
import { api } from '../app/api';

/** [capability, label, how, possible on Slack at all] — checked against Slack's current API docs. */
const CAPS: Array<[keyof ProviderCapabilities, string, string, boolean]> = [
  ['identity', 'Sign in with Slack', 'OpenID Connect (openid, profile, email). People match members by Slack id, then by verified email.', true],
  ['channelListing', 'List channels for binding', 'Bot token, conversations.list (channels:read; groups:read for private channels the app was added to).', true],
  ['voicePresence', 'See who’s in a huddle', 'Events API: user_huddle_changed plus the channel’s huddle thread (channels:history). People in a huddle in a bound channel appear in the room; if they were already walking around, their avatar walks over.', true],
  ['chatBridge', 'Each space’s chat is its channel', 'What’s said in a space is posted to its channel under your name and picture (chat:write.customize); the channel’s messages appear in the space (message events); history loads when you walk in (channels:history). The app must be in the channel.', true],
  ['speakingIndicators', 'Live speaking indicators', 'Slack exposes no audio or speaking state for huddles.', false],
  ['directVoiceJoin', 'Put people into a huddle automatically', 'No Slack API starts or joins a huddle for someone. We deep-link instead.', false],
  ['voiceFollow', 'Move you between huddles as you walk', 'No Slack API moves someone between huddles. Walking into a space shows a one-click “Switch to the huddle in #…” instead.', false],
  ['deepLinkJoin', 'Open the channel’s huddle in Slack', 'app.slack.com/huddle/{team}/{channel} — one click to join.', true],
  ['embeddedApp', 'Run inside Slack', 'Slack has no embedded-app surface like Discord Activities; link previews and /minglewood cover it.', false],
];

/** What Slack adds beyond the shared provider seam (all need the bot token). */
const EXTRAS: Array<[string, string]> = [
  ['Slack status → world status', 'Calendar “in a meeting” → In a meeting, DND and headphones → Focused, vacation/lunch → Away. Shown only while someone is around.'],
  ['/minglewood', 'who’s around · where is @someone · join @someone · wave at @someone · knock @someone · room <name>'],
  ['Link previews', `Room and person links to ${BRAND.name} unfurl with who’s there and a way in.`],
  ['Knocks as DMs', 'People can opt in (profile) to get knocks as a Slack DM when they aren’t in the world.'],
  ['Channels follow Slack', 'Rename a linked channel and the space’s label follows; archive or delete it and the link goes.'],
];

type Props = { data: AdminOverview; reload: () => void };

export function SlackTab({ data, reload }: Props) {
  const s = data.slack;
  const conn = data.connections.find((c) => c.provider === 'slack' && c.status === 'active');
  const [msg, setMsg] = useState('');
  const [channels, setChannels] = useState<ExternalChannel[]>([]);
  const [dailyChannelId, setDailyChannelId] = useState(conn?.settings?.dailyChannelId ?? '');
  const [dailyHour, setDailyHour] = useState(conn?.settings?.dailyHour ?? 9);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!conn) return;
    void api<{ channels: ExternalChannel[] }>('/slack/admin/channels')
      .then((r) => setChannels(r.channels))
      .catch(() => undefined);
  }, [conn]);

  const connect = async () => {
    try {
      await api('/slack/admin/connect', { method: 'POST' });
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const saveDaily = async () => {
    try {
      await api('/slack/admin/settings', { method: 'PUT', json: { dailyChannelId: dailyChannelId || null, dailyHour } });
      setSaved(true);
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="agrid">
      <section className="apanel">
        <h2>Connection</h2>
        {s.mock && <p className="amuted">Mock mode (SLACK_MOCK): nothing is sent to Slack; calls are recorded at /api/slack/dev/outbox.</p>}
        {!s.configured && !s.mock && !s.botConfigured ? (
          <>
            <p>
              Slack isn’t configured on this server. Set <code>SLACK_CLIENT_ID</code>, <code>SLACK_CLIENT_SECRET</code> and{' '}
              <code>SLACK_SIGNING_SECRET</code> in <code>.env</code> and restart. Step-by-step: <code>docs/slack.md</code>.
            </p>
            <p className="amuted">Demo mode keeps working without it.</p>
          </>
        ) : conn ? (
          <p>
            ✅ Connected to <strong>{conn.displayName}</strong> since {new Date(conn.connectedAt).toLocaleDateString()}.
          </p>
        ) : (
          <>
            <ol className="asteps">
              {s.installUrl && (
                <li>
                  <a className="abtn primary" href={s.installUrl}>
                    Add to Slack
                  </a>
                  <div className="amuted">Installs the {BRAND.name} app to your workspace and connects it here.</div>
                </li>
              )}
              <li>
                <button className="abtn" disabled={!s.botConfigured} onClick={connect}>
                  Connect using SLACK_BOT_TOKEN
                </button>
                <div className="amuted">{s.botConfigured ? 'For one-workspace servers where the app was installed from Slack’s settings.' : 'Needs SLACK_BOT_TOKEN.'}</div>
              </li>
            </ol>
            {s.team && <p className="amuted">Rooms can already bind to workspace {s.team} (SLACK_TEAM_ID).</p>}
          </>
        )}
        {s.addUrl && (
          <p className="amuted">
            Anyone can also add {BRAND.name} from the landing page: <code>{s.addUrl}</code> — a new workspace becomes its own company (Minglewood Cloud), or connects this server’s workspace.
          </p>
        )}
        {msg && <p className="aerror">{msg}</p>}
      </section>

      <section className="apanel">
        <h2>Daily “who’s around” post</h2>
        {conn ? (
          <>
            <label className="afield">
              Channel
              <select value={dailyChannelId} onChange={(e) => (setDailyChannelId(e.target.value), setSaved(false))}>
                <option value="">— off —</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="afield">
              Time ({data.org.timezone || 'UTC'})
              <select value={dailyHour} onChange={(e) => (setDailyHour(Number(e.target.value)), setSaved(false))}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>
            <button className="abtn primary" onClick={saveDaily}>
              Save
            </button>
            {saved && <span className="asaved">Saved</span>}
            <p className="amuted">Invite the app to the channel first (/invite @{BRAND.name}). Posts once a day: who’s in which room, and today’s events.</p>
          </>
        ) : (
          <p className="amuted">Connect a workspace first.</p>
        )}
      </section>

      <section className="apanel">
        <h2>What Slack lets us do</h2>
        <p className="amuted">Where the platform says no, we degrade gracefully instead of hacking around it.</p>
        <ul className="acaps">
          {CAPS.map(([k, label, how, possible]) => {
            const on = possible && s.capabilities[k];
            const state = on ? 'yes' : possible ? 'setup' : 'no';
            return (
              <li key={k} className={state}>
                <span className="acap-mark">{on ? '✓' : possible ? '○' : '✕'}</span>
                <div>
                  <strong>{label}</strong>
                  <span className="acap-state">{on ? 'enabled' : possible ? 'needs configuration' : 'not offered by Slack'}</span>
                  <div className="amuted">{how}</div>
                </div>
              </li>
            );
          })}
          {EXTRAS.map(([label, how]) => (
            <li key={label} className={s.botConfigured ? 'yes' : 'setup'}>
              <span className="acap-mark">{s.botConfigured ? '✓' : '○'}</span>
              <div>
                <strong>{label}</strong>
                <span className="acap-state">{s.botConfigured ? 'enabled' : 'needs the bot token'}</span>
                <div className="amuted">{how}</div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="apanel">
        <h2>URLs for your Slack app</h2>
        <p className="amuted">Paste these into api.slack.com/apps → your app. Details in docs/slack.md.</p>
        <dl className="aurls">
          {(
            [
              ['Event Subscriptions → Request URL', s.endpoints.events],
              ['Slash command /minglewood → Request URL', s.endpoints.commands],
              ['Interactivity → Request URL', s.endpoints.interactions],
              ['OAuth → Redirect URL (sign in)', s.endpoints.signInRedirect],
              ['OAuth → Redirect URL (install)', s.endpoints.installRedirect],
            ] as Array<[string, string]>
          ).map(([label, url]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                <code>{url}</code>
                <button className="abtn" onClick={() => void navigator.clipboard?.writeText(url)}>
                  Copy
                </button>
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
