import { useCallback, useEffect, useState } from 'react';
import type { AdminOverview, ExternalChannel, ProviderCapabilities } from '@shared/api';
import type { Room } from '@shared/domain/types';
import { BRAND } from '@shared/brand';
import { MEMORY_SLOTS } from '@shared/world/memory';
import { api } from '../app/api';
import { useStore } from '../app/store';

type Tab = 'overview' | 'rooms' | 'memory' | 'discord' | 'events' | 'audit';

/** [capability, label, how, possible on Discord at all] — verified against current Discord docs. */
const CAPS: Array<[keyof ProviderCapabilities, string, string, boolean]> = [
  ['identity', 'Sign in with Discord', 'OAuth2 with identify + guilds.members.read; membership of the connected server is verified.', true],
  ['channelListing', 'List channels for binding', 'Bot token, GET /guilds/{id}/channels (View Channels permission only).', true],
  ['voicePresence', 'See who’s in voice', 'Gateway GUILD_VOICE_STATES intent (non-privileged). People in a bound voice channel appear in the room.', true],
  ['speakingIndicators', 'Live speaking indicators', 'Needs rpc.voice.read, which Discord grants only to approved partners. Shown as unavailable.', false],
  ['directVoiceJoin', 'Move people into voice automatically', 'Not possible: no API moves a user into voice unless already connected, and the SDK has no join command. We deep-link instead.', false],
  ['deepLinkJoin', 'Open the channel in Discord', 'discord.com/channels/{guild}/{channel} — one click in Discord to join voice.', true],
  ['embeddedApp', 'Run inside Discord as an Activity', 'Embedded App SDK; Activity launch in a bound voice channel drops people into that room.', true],
];

export function AdminConsole() {
  const me = useStore((s) => s.boot?.me);
  const [data, setData] = useState<AdminOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const load = useCallback(() => {
    api<AdminOverview>('/admin/overview')
      .then(setData)
      .catch((e) => setErr((e as Error).message));
  }, []);
  useEffect(load, [load]);

  if (me && me.role === 'member') {
    return (
      <div className="admin admin-gate">
        <section className="apanel">
          <h2>Admins only</h2>
          <p className="amuted">The admin console configures rooms, channels and events for {BRAND.name}. Ask an admin if you need a change.</p>
          <a className="abtn primary" href="#/">
            ← Back to the world
          </a>
        </section>
      </div>
    );
  }

  return (
    <div className="admin">
      <header className="admin-head">
        <div>
          <p className="admin-kicker">{BRAND.name} admin</p>
          <h1>{data?.org.name ?? '…'}</h1>
        </div>
        <a className="abtn" href="#/">
          ← Back to the world
        </a>
      </header>
      <nav className="admin-tabs" role="tablist">
        {(
          [
            ['overview', 'Organization'],
            ['rooms', 'Rooms & channels'],
            ['memory', 'Company memory'],
            ['discord', 'Discord'],
            ['events', 'Events'],
            ['audit', 'Audit log'],
          ] as Array<[Tab, string]>
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>
      {err && <p className="aerror">{err}</p>}
      {data && (
        <main className="admin-body">
          {tab === 'overview' && <OrgTab data={data} reload={load} />}
          {tab === 'rooms' && <RoomsTab data={data} reload={load} />}
          {tab === 'memory' && <MemoryTab data={data} reload={load} />}
          {tab === 'discord' && <DiscordTab data={data} reload={load} />}
          {tab === 'events' && <EventsTab data={data} reload={load} />}
          {tab === 'audit' && <AuditTab data={data} />}
        </main>
      )}
    </div>
  );
}

type TabProps = { data: AdminOverview; reload: () => void };

function OrgTab({ data, reload }: TabProps) {
  const [name, setName] = useState(data.org.name);
  const [tagline, setTagline] = useState(data.org.tagline);
  const [saved, setSaved] = useState(false);
  return (
    <div className="agrid">
      <section className="apanel">
        <h2>Organization</h2>
        <label className="afield">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="afield">
          Tagline
          <input value={tagline} onChange={(e) => setTagline(e.target.value)} />
        </label>
        <button
          className="abtn primary"
          onClick={async () => {
            await api('/admin/org', { method: 'PUT', json: { name, tagline } });
            setSaved(true);
            reload();
          }}
        >
          Save
        </button>
        {saved && <span className="asaved">Saved</span>}
      </section>
      <section className="apanel">
        <h2>At a glance</h2>
        <dl className="astats">
          <div>
            <dt>Members</dt>
            <dd>{data.memberCount}</dd>
          </div>
          <div>
            <dt>Rooms</dt>
            <dd>{data.rooms.length}</dd>
          </div>
          <div>
            <dt>Bound channels</dt>
            <dd>{data.bindings.length}</dd>
          </div>
          <div>
            <dt>Teams</dt>
            <dd>{data.teams.length}</dd>
          </div>
        </dl>
        <p className="amuted">
          By design, there are no per-person activity reports here. {BRAND.name} measures the health of the place — not
          the people in it.
        </p>
      </section>
      <section className="apanel wide">
        <h2>Teams</h2>
        <table className="atable">
          <thead>
            <tr>
              <th>Team</th>
              <th>Department</th>
              <th>Home room</th>
            </tr>
          </thead>
          <tbody>
            {data.teams.map((t) => (
              <tr key={t.id}>
                <td>
                  {t.emoji} {t.name}
                </td>
                <td>{data.departments.find((d) => d.id === t.departmentId)?.name}</td>
                <td>{data.rooms.find((r) => r.id === t.homeRoomId)?.name ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function RoomRow({ room, data, channels, reload }: { room: Room; data: AdminOverview; channels: Record<string, ExternalChannel[]>; reload: () => void }) {
  const binding = data.bindings.find((b) => b.roomId === room.id);
  const [provider, setProvider] = useState<'demo' | 'discord'>(binding?.provider === 'discord' ? 'discord' : 'demo');
  const [channelId, setChannelId] = useState(binding?.externalChannelId ?? '');
  const [desc, setDesc] = useState(room.description);
  const [status, setStatus] = useState('');
  const list = channels[provider] ?? [];
  const save = async () => {
    try {
      if (!channelId) await api(`/admin/bindings/${room.id}`, { method: 'PUT', json: { remove: true } });
      else {
        const ch = list.find((c) => c.id === channelId);
        await api(`/admin/bindings/${room.id}`, {
          method: 'PUT',
          json: {
            provider,
            kind: ch?.kind === 'stage' ? 'stage' : ch?.kind === 'text' ? 'text' : 'voice',
            externalChannelId: channelId,
            label: ch ? `${ch.kind === 'text' ? '#' : '🔊 '}${ch.name}` : channelId,
          },
        });
      }
      if (desc !== room.description) await api(`/admin/rooms/${room.id}`, { method: 'PUT', json: { description: desc } });
      setStatus('Saved');
      reload();
    } catch (e) {
      setStatus((e as Error).message);
    }
  };
  return (
    <tr>
      <td>
        <strong>
          {room.emoji} {room.name}
        </strong>
        <div className="amuted">{room.purpose}</div>
      </td>
      <td>
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} />
      </td>
      <td>
        <select value={provider} onChange={(e) => (setProvider(e.target.value as 'demo' | 'discord'), setChannelId(''))}>
          <option value="demo">Demo</option>
          <option value="discord" disabled={!data.connections.some((c) => c.provider === 'discord')}>
            Discord
          </option>
        </select>
      </td>
      <td>
        <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
          <option value="">— none —</option>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.parentName ? `${c.parentName} / ` : ''}
              {c.kind === 'text' ? '#' : '🔊 '}
              {c.name}
            </option>
          ))}
        </select>
        {binding && <div className="amuted">now: {binding.label}</div>}
      </td>
      <td>
        <button className="abtn" onClick={save}>
          Save
        </button>
        {status && <div className="amuted">{status}</div>}
      </td>
    </tr>
  );
}

function RoomsTab({ data, reload }: TabProps) {
  const [channels, setChannels] = useState<Record<string, ExternalChannel[]>>({});
  useEffect(() => {
    void api<{ channels: ExternalChannel[] }>('/admin/channels?provider=demo').then((r) => setChannels((c) => ({ ...c, demo: r.channels })));
    if (data.connections.some((c) => c.provider === 'discord'))
      void api<{ channels: ExternalChannel[] }>('/admin/channels?provider=discord')
        .then((r) => setChannels((c) => ({ ...c, discord: r.channels })))
        .catch(() => undefined);
  }, [data.connections]);
  return (
    <section className="apanel wide">
      <h2>Rooms & conversation bindings</h2>
      <p className="amuted">
        Each room in the world can point at a conversation on your communication platform. Entering the room offers a
        one-click way into that channel. The world model never depends on the provider — bindings are the only link.
      </p>
      <table className="atable">
        <thead>
          <tr>
            <th>Room</th>
            <th>Description</th>
            <th>Provider</th>
            <th>Channel</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.rooms.map((r) => (
            <RoomRow key={r.id} room={r} data={data} channels={channels} reload={reload} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function DiscordTab({ data, reload }: TabProps) {
  const conn = data.connections.find((c) => c.provider === 'discord');
  const [guilds, setGuilds] = useState<Array<{ id: string; name: string }> | null>(null);
  const [msg, setMsg] = useState('');
  const d = data.discord;
  return (
    <div className="agrid">
      <section className="apanel">
        <h2>Connection</h2>
        {!d.configured ? (
          <>
            <p>
              Discord isn’t configured on this server. Set <code>DISCORD_CLIENT_ID</code>, <code>DISCORD_CLIENT_SECRET</code>{' '}
              and <code>DISCORD_BOT_TOKEN</code> in <code>.env</code> and restart. Step-by-step: <code>docs/DISCORD.md</code>.
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
              <li>
                <a className="abtn" href={d.installUrl ?? '#'} target="_blank" rel="noreferrer">
                  Add the {BRAND.name} bot to your server
                </a>
                <div className="amuted">Requests only “View Channels”.</div>
              </li>
              <li>
                <button className="abtn" disabled={!d.botConfigured} onClick={async () => setGuilds((await api<{ guilds: Array<{ id: string; name: string }> }>('/admin/discord/guilds')).guilds)}>
                  Find servers the bot is in
                </button>
                {!d.botConfigured && <div className="amuted">Needs DISCORD_BOT_TOKEN.</div>}
              </li>
              {guilds && (
                <li>
                  {guilds.length === 0 && <span>No servers yet — add the bot first.</span>}
                  {guilds.map((g) => (
                    <button
                      key={g.id}
                      className="abtn primary"
                      onClick={async () => {
                        try {
                          await api('/admin/discord/connect', { method: 'POST', json: { guildId: g.id } });
                          reload();
                        } catch (e) {
                          setMsg((e as Error).message);
                        }
                      }}
                    >
                      Connect “{g.name}”
                    </button>
                  ))}
                </li>
              )}
            </ol>
            {msg && <p className="aerror">{msg}</p>}
          </>
        )}
      </section>
      <section className="apanel">
        <h2>What Discord lets us do</h2>
        <p className="amuted">Verified against Discord’s current developer docs. Where the platform says no, we degrade gracefully instead of hacking around it.</p>
        <ul className="acaps">
          {CAPS.map(([k, label, how, possible]) => {
            const on = possible && d.capabilities[k];
            const state = on ? 'yes' : possible ? 'setup' : 'no';
            return (
              <li key={k} className={state}>
                <span className="acap-mark">{on ? '✓' : possible ? '○' : '✕'}</span>
                <div>
                  <strong>{label}</strong>
                  <span className="acap-state">{on ? 'enabled' : possible ? 'needs configuration' : 'not offered by Discord'}</span>
                  <div className="amuted">{how}</div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function EventsTab({ data, reload }: TabProps) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('social');
  const [roomId, setRoomId] = useState('events');
  const [start, setStart] = useState(() => new Date(Date.now() + 3600_000).toISOString().slice(0, 16));
  const [dur, setDur] = useState(60);
  const [description, setDescription] = useState('');
  const [msg, setMsg] = useState('');
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api('/admin/events', { method: 'POST', json: { title, kind, roomId, startsAt: new Date(start).toISOString(), durationMin: dur, description } });
      setTitle('');
      setMsg('Created — the world will transform when it starts.');
      reload();
    } catch (x) {
      setMsg((x as Error).message);
    }
  };
  return (
    <div className="agrid">
      <section className="apanel">
        <h2>Create an event</h2>
        <form onSubmit={create}>
          <label className="afield">
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={80} />
          </label>
          <label className="afield">
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {['social', 'birthday', 'anniversary', 'launch', 'allhands', 'demo-day'].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label className="afield">
            Room
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              {data.rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="afield">
            Starts
            <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="afield">
            Duration (minutes)
            <input type="number" min={5} max={1440} value={dur} onChange={(e) => setDur(Number(e.target.value))} />
          </label>
          <label className="afield">
            Description
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </label>
          <button className="abtn primary">Create event</button>
          {msg && <p className="amuted">{msg}</p>}
        </form>
      </section>
      <section className="apanel">
        <h2>Scheduled</h2>
        <ul className="alist">
          {[...data.events]
            .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
            .map((e) => (
              <li key={e.id}>
                <strong>{e.title}</strong>
                <div className="amuted">
                  {new Date(e.startsAt).toLocaleString()} · {data.rooms.find((r) => r.id === e.roomId)?.name} · {e.kind}
                </div>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}

function AuditTab({ data }: { data: AdminOverview }) {
  return (
    <section className="apanel wide">
      <h2>Audit log</h2>
      <p className="amuted">Configuration changes only. Member activity is never logged.</p>
      <table className="atable">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>What</th>
            <th>Target</th>
          </tr>
        </thead>
        <tbody>
          {data.audit.length === 0 && (
            <tr>
              <td colSpan={4} className="amuted">
                Nothing yet.
              </td>
            </tr>
          )}
          {data.audit.map((a) => (
            <tr key={a.id}>
              <td>{new Date(a.at).toLocaleString()}</td>
              <td>{a.actorId}</td>
              <td>{a.action}</td>
              <td>
                {a.target} {a.detail && <span className="amuted">{a.detail}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function MemoryTab({ data, reload }: TabProps) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('launch');
  const [roomId, setRoomId] = useState('launch');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [story, setStory] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const placedIn = (id: string) => data.artifacts.filter((a) => a.sceneId === id && a.placement).length;
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api('/admin/artifacts', {
        method: 'POST',
        json: { title, kind, roomId, occurredAt: date, story, contributorIds: people, teamIds: teams },
      });
      setTitle('');
      setStory('');
      setPeople([]);
      setMsg('Added. Everyone in the world just got a little note about it.');
      reload();
    } catch (x) {
      setMsg((x as Error).message);
    }
  };
  const multi = (e: React.ChangeEvent<HTMLSelectElement>) => [...e.target.selectedOptions].map((o) => o.value);
  return (
    <div className="agrid">
      <section className="apanel">
        <h2>Commemorate a moment</h2>
        <p className="amuted">
          Launches, awards, offsites and milestones become artifacts on a room’s memory wall — with the story and the
          people behind them. Over the years, the world fills with your company’s history.
        </p>
        <form onSubmit={create}>
          <label className="afield">
            What happened?
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Aurora 2.0 shipped" required maxLength={80} />
          </label>
          <div className="agrid2">
            <label className="afield">
              Kind
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {['launch', 'award', 'offsite', 'milestone', 'tenure', 'tradition'].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label className="afield">
              When
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <label className="afield">
            Where it lives
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              {data.rooms.map((r) => (
                <option key={r.id} value={r.id} disabled={placedIn(r.id) >= (MEMORY_SLOTS[r.id]?.length ?? 0)}>
                  {r.name} ({(MEMORY_SLOTS[r.id]?.length ?? 0) - placedIn(r.id)} spots left)
                </option>
              ))}
            </select>
          </label>
          <label className="afield">
            The story
            <textarea value={story} onChange={(e) => setStory(e.target.value)} rows={3} required maxLength={600} placeholder="Eleven weeks, one very stubborn sync bug, and a launch party in Lantern Hall." />
          </label>
          <div className="agrid2">
            <label className="afield">
              People (ctrl/cmd-click)
              <select multiple size={6} value={people} onChange={(e) => setPeople(multi(e))}>
                {[...data.members].sort((a, b) => a.displayName.localeCompare(b.displayName)).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="afield">
              Teams
              <select multiple size={6} value={teams} onChange={(e) => setTeams(multi(e))}>
                {data.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.emoji} {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="abtn primary">Add to the world</button>
          {msg && <p className="amuted">{msg}</p>}
        </form>
      </section>
      <section className="apanel">
        <h2>The company’s history so far</h2>
        <ul className="alist">
          {[...data.artifacts]
            .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
            .map((a) => (
              <li key={a.id}>
                <strong>{a.title}</strong>
                <div className="amuted">
                  {a.occurredAt} · {a.kind} · {data.rooms.find((r) => r.id === a.sceneId)?.name ?? 'Town'}
                </div>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}
