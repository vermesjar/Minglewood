import { useCallback, useEffect, useState } from 'react';
import type { AdminOverview, ExternalChannel, ProviderCapabilities, SlackReadiness, SlackSetupItem } from '@shared/api';
import type { Room } from '@shared/domain/types';
import { BRAND } from '@shared/brand';
import { MEMORY_SLOTS } from '@shared/world/memory';
import { api } from '../app/api';
import { useStore } from '../app/store';
import { SlackTab } from './SlackTab';

type Tab = 'overview' | 'rooms' | 'memory' | 'slack' | 'discord' | 'events' | 'audit';

/** [capability, label, how, possible on Discord at all] — verified against current Discord docs. */
const CAPS: Array<[keyof ProviderCapabilities, string, string, boolean]> = [
  ['identity', 'Sign in with Discord', 'OAuth2 with identify + guilds.members.read; membership of the connected server is verified.', true],
  ['channelListing', 'List channels for binding', 'Bot token, GET /guilds/{id}/channels (View Channels).', true],
  ['voicePresence', 'See who’s in voice', 'Gateway GUILD_VOICE_STATES intent (non-privileged). People in a bound voice channel appear in the room.', true],
  ['speakingIndicators', 'Live speaking indicators', 'Needs rpc.voice.read, which Discord grants only to approved partners. Shown as unavailable.', false],
  ['directVoiceJoin', 'Pull people into voice from nothing', 'Not possible: no API connects someone to voice who isn’t already connected, and the SDK has no join command. We deep-link for the first join.', false],
  ['voiceFollow', 'Voice follows you between spaces', 'Once you’re connected to any voice channel, the bot moves you (Move Members) into each space’s voice channel as you walk in; switching in Discord walks your avatar over.', true],
  ['chatBridge', 'Each space’s chat is its text channel', 'What’s said in a space is posted to its channel under your name (webhook); the channel’s messages appear in the space (GUILD_MESSAGES + Message Content intent). History loads when you walk in.', true],
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
            ['rooms', 'Spaces & channels'],
            ['memory', 'Company memory'],
            ['slack', 'Slack'],
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
          {tab === 'slack' && <SlackTab data={data} reload={load} />}
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

type Provider = 'demo' | 'discord' | 'slack';
/** A binding's label prefix: Discord by channel type; Slack by slot (a channel is both a space's text and its huddle). */
const channelMark = (provider: Provider, c: ExternalChannel, slot: 'voice' | 'text') =>
  provider === 'slack' ? (slot === 'text' ? '#' : '🎧 #') : c.kind === 'text' ? '#' : '🔊 ';

/** A place in the world that can have channels: the town (the company's "general") and every room. */
interface SpaceRow {
  id: string;
  name: string;
  emoji: string;
  purpose: string;
  room?: Room;
}

function ChannelSelect({ list, provider, value, onChange, slot }: { list: ExternalChannel[]; provider: Provider; value: string; onChange: (v: string) => void; slot: 'voice' | 'text' }) {
  // Slack: any channel can be a space's text (its messages) or voice (its huddle). Discord: by type.
  const options = provider === 'slack' ? list : list.filter((c) => (slot === 'text' ? c.kind === 'text' : c.kind === 'voice' || c.kind === 'stage'));
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${slot} channel`}>
      <option value="">— none —</option>
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {c.parentName ? `${c.parentName} / ` : ''}
          {channelMark(provider, c, slot)}
          {c.name}
        </option>
      ))}
    </select>
  );
}

function SpaceRowView({ space, data, channels, reload }: { space: SpaceRow; data: AdminOverview; channels: Record<string, ExternalChannel[]>; reload: () => void }) {
  const voice = data.bindings.find((b) => b.roomId === space.id && b.kind !== 'text');
  const text = data.bindings.find((b) => b.roomId === space.id && b.kind === 'text');
  const [provider, setProvider] = useState<Provider>(voice?.provider ?? text?.provider ?? (data.connections.some((c) => c.provider === 'discord') ? 'discord' : 'demo'));
  const [voiceId, setVoiceId] = useState(voice?.externalChannelId ?? '');
  const [textId, setTextId] = useState(text?.externalChannelId ?? '');
  const [desc, setDesc] = useState(space.room?.description ?? '');
  const [status, setStatus] = useState('');
  const list = channels[provider] ?? [];
  const quiet = !!space.room?.quiet;

  const saveSlot = async (slot: 'voice' | 'text', id: string, current?: { externalChannelId: string; provider: string }) => {
    if (current?.externalChannelId === id && current.provider === provider) return;
    if (!id) {
      if (current) await api(`/admin/bindings/${space.id}`, { method: 'PUT', json: { remove: true, slot } });
      return;
    }
    const ch = list.find((c) => c.id === id);
    await api(`/admin/bindings/${space.id}`, {
      method: 'PUT',
      json: {
        provider,
        kind: slot === 'text' ? 'text' : ch?.kind === 'stage' ? 'stage' : 'voice',
        externalChannelId: id,
        label: ch ? `${channelMark(provider, ch, slot)}${ch.name}` : id,
      },
    });
  };
  const save = async () => {
    try {
      await saveSlot('voice', voiceId, voice);
      await saveSlot('text', textId, text);
      if (space.room && desc !== space.room.description) await api(`/admin/rooms/${space.id}`, { method: 'PUT', json: { description: desc } });
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
          {space.emoji} {space.name}
        </strong>
        <div className="amuted">{space.purpose}</div>
      </td>
      <td>
        <select value={provider} onChange={(e) => (setProvider(e.target.value as Provider), setVoiceId(''), setTextId(''))} disabled={quiet}>
          <option value="demo">Demo</option>
          <option value="slack" disabled={!data.slack.team}>
            Slack
          </option>
          <option value="discord" disabled={!data.connections.some((c) => c.provider === 'discord')}>
            Discord
          </option>
        </select>
      </td>
      {quiet ? (
        <td colSpan={2} className="amuted">
          Quiet room — no channels, on purpose.
        </td>
      ) : (
        <>
          <td>
            <ChannelSelect list={list} provider={provider} value={voiceId} onChange={setVoiceId} slot="voice" />
            {voice && <div className="amuted">now: {voice.label}</div>}
          </td>
          <td>
            <ChannelSelect list={list} provider={provider} value={textId} onChange={setTextId} slot="text" />
            {text && <div className="amuted">now: {text.label}</div>}
          </td>
        </>
      )}
      <td>{space.room ? <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} /> : <span className="amuted">The open world</span>}</td>
      <td>
        <button className="abtn" onClick={save}>
          Save
        </button>
        {status && <div className="amuted">{status}</div>}
      </td>
    </tr>
  );
}

interface PermissionReport {
  connected: boolean;
  guild?: { id: string; name: string };
  items: Array<{ name: string; ok: boolean; neededFor: string }>;
  messageContent?: boolean;
  installUrl: string | null;
}

interface SetupItem {
  spaceName: string;
  slot: 'voice' | 'text';
  action: 'kept' | 'matched' | 'create' | 'skip';
  channelName: string;
}

/** One click: a text and a voice channel for every space, matched by name or created, plus a permissions check. */
function DiscordSetup({ reload }: { reload: () => void }) {
  const [perms, setPerms] = useState<PermissionReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ plan: SetupItem[]; failed: Array<SetupItem & { error: string }> } | null>(null);
  const [err, setErr] = useState('');
  const check = useCallback(() => {
    void api<PermissionReport>('/admin/discord/permissions')
      .then(setPerms)
      .catch((e) => setErr((e as Error).message));
  }, []);
  useEffect(check, [check]);
  const run = async (create: boolean) => {
    setBusy(true);
    setErr('');
    try {
      setResult(await api('/admin/discord/setup', { method: 'POST', json: { create } }));
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const missing = perms?.items.filter((i) => !i.ok) ?? [];
  const verb: Record<SetupItem['action'], string> = { kept: 'kept', matched: 'linked', create: 'created', skip: 'no match' };
  return (
    <section className="apanel wide">
      <h2>Discord: channels for every space</h2>
      <p className="amuted">
        Each space is its channels. Walk into the café and you’re in the café’s voice channel (once you’ve joined voice in
        Discord); what you say there is posted in its text channel, and what’s posted there shows up in the world. The town
        is your server’s <strong>#general</strong>. Discord stays the record: renames and deletions there are followed here.
      </p>
      <div className="arow">
        <button className="abtn" disabled={busy} onClick={() => void run(false)}>
          Link matching channels
        </button>
        <button className="abtn primary" disabled={busy} onClick={() => void run(true)}>
          Link, and create what’s missing
        </button>
        <span className="amuted">Creates a “Minglewood” category with a #text and a voice channel per space. Existing links are kept.</span>
      </div>
      {result && (
        <ul className="alist">
          {result.plan
            .filter((p) => p.action !== 'kept')
            .map((p, i) => (
              <li key={i}>
                {p.spaceName} · {p.slot}: {verb[p.action]} {p.action !== 'skip' ? p.channelName : ''}
              </li>
            ))}
          {result.failed.map((f, i) => (
            <li key={`f${i}`} className="aerror">
              {f.spaceName} · {f.slot}: failed — {f.error}
            </li>
          ))}
          {result.plan.every((p) => p.action === 'kept') && <li>Every space already has its channels.</li>}
        </ul>
      )}
      {err && <p className="aerror">{err}</p>}
      <h3>Bot permissions{perms?.guild ? ` in ${perms.guild.name}` : ''}</h3>
      {!perms ? (
        <p className="amuted">Checking…</p>
      ) : !perms.connected ? (
        <p className="amuted">Connect a Discord server (Discord tab) to check.</p>
      ) : (
        <>
          <ul className="alist perms">
            {perms.items.map((i) => (
              <li key={i.name}>
                {i.ok ? '✅' : '❌'} <strong>{i.name}</strong> <span className="amuted">— {i.neededFor}</span>
              </li>
            ))}
            <li>
              {perms.messageContent ? '✅' : '❌'} <strong>Message Content intent</strong>{' '}
              <span className="amuted">— read what people post in Discord (Developer Portal → Bot → Privileged Gateway Intents)</span>
            </li>
          </ul>
          {missing.length > 0 && perms.installUrl && (
            <p>
              <a className="abtn" href={perms.installUrl} target="_blank" rel="noreferrer">
                Grant the missing permissions
              </a>{' '}
              <span className="amuted">Re-adding the bot updates its permissions; nothing else changes.</span>
            </p>
          )}
          <button className="abtn" onClick={check}>
            Check again
          </button>
        </>
      )}
    </section>
  );
}

interface SlackReadinessReport extends Partial<SlackReadiness> {
  connected: boolean;
}

/** One click: a channel for every space (its conversation and its huddle), plus what the workspace actually granted. */
function SlackSetup({ data, reload }: TabProps) {
  const [ready, setReady] = useState<SlackReadinessReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ plan: SlackSetupItem[]; failed: Array<SlackSetupItem & { error: string }> } | null>(null);
  const [err, setErr] = useState('');
  const check = useCallback(() => {
    void api<SlackReadinessReport>('/slack/admin/readiness')
      .then(setReady)
      .catch((e) => setErr((e as Error).message));
  }, []);
  useEffect(check, [check, data.bindings.length]);
  const run = async (create: boolean) => {
    setBusy(true);
    setErr('');
    try {
      setResult(await api('/slack/admin/setup', { method: 'POST', json: { create } }));
      reload();
      check();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const join = async (channelId: string) => {
    try {
      const r = await api<{ state: string }>('/slack/admin/join', { method: 'POST', json: { channelId } });
      if (r.state === 'private') setErr('That channel is private — invite the app from Slack: /invite @Minglewood.');
      check();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const [invited, setInvited] = useState('');
  const inviteAll = async () => {
    setInvited('…');
    try {
      const r = await api<{ invited: number; channels: number; failed: Array<{ channelId: string; error: string }> }>('/slack/admin/invite-all', { method: 'POST' });
      setInvited(r.failed.length ? `${r.invited} people into ${r.channels - r.failed.length} channels; ${r.failed.map((f) => f.error).join(', ')}` : `${r.invited} people are in all ${r.channels} linked channels.`);
    } catch (e) {
      setInvited((e as Error).message);
    }
  };
  const verb: Record<SlackSetupItem['action'], string> = { kept: 'kept', matched: 'linked', create: 'created', skip: 'no match' };
  const missing = ready?.scopes?.filter((s) => s.ok === false) ?? [];
  const notIn = ready?.channels?.filter((c) => c.inChannel === false) ?? [];
  return (
    <section className="apanel wide">
      <h2>Slack: a channel for every space</h2>
      <p className="amuted">
        In Slack a channel is both a space’s conversation and its huddle. What you say in a space is posted there under your
        name; what’s posted there shows up in the space; anyone in the channel’s huddle appears in the room. The town is your
        workspace’s <strong>#general</strong>. Slack stays the record: renames and archives there are followed here.
      </p>
      <div className="arow">
        <button className="abtn" disabled={busy} onClick={() => void run(false)}>
          Link matching channels
        </button>
        <button className="abtn primary" disabled={busy} onClick={() => void run(true)}>
          Link, and create what’s missing
        </button>
        <span className="amuted">Creates a public channel per space that has none, and joins every channel it links. Existing links are kept.</span>
      </div>
      <div className="arow">
        <button className="abtn" onClick={() => void inviteAll()}>
          Add everyone to the linked channels
        </button>
        <span className="amuted">
          Everyone who has signed in with Slack joins every linked channel (a channel the setup created holds only the app, and a huddle can’t be started in a channel you’re not in). {invited}
        </span>
      </div>
      {result && (
        <ul className="alist">
          {result.plan
            .filter((p) => p.action !== 'kept')
            .map((p, i) => (
              <li key={i}>
                {p.spaceName}: {verb[p.action]} {p.action !== 'skip' ? `#${p.channelName}` : ''}
                {p.joined ? ' (joined)' : ''}
              </li>
            ))}
          {result.failed.map((f, i) => (
            <li key={`f${i}`} className="aerror">
              {f.spaceName}: failed — {f.error}
            </li>
          ))}
          {result.plan.every((p) => p.action === 'kept') && <li>Every space already has its channel.</li>}
        </ul>
      )}
      {err && <p className="aerror">{err}</p>}
      <h3>What the workspace granted{ready?.teamName ? ` (${ready.teamName})` : ''}</h3>
      {!ready ? (
        <p className="amuted">Checking…</p>
      ) : !ready.connected ? (
        <p className="amuted">Connect a Slack workspace (Slack tab) to check.</p>
      ) : (
        <>
          {!ready.scopesKnown && <p className="amuted">Slack didn’t report the token’s scopes, so they can’t be checked from here.</p>}
          <ul className="alist perms">
            {ready.scopes?.map((s) => (
              <li key={s.scope}>
                {s.ok === null ? '○' : s.ok ? '✅' : '❌'} <strong>{s.scope}</strong> <span className="amuted">— {s.neededFor}</span>
              </li>
            ))}
          </ul>
          {missing.length > 0 && data.slack.installUrl && (
            <p>
              <a className="abtn" href={data.slack.installUrl}>
                Re-add to Slack with the missing scopes
              </a>{' '}
              <span className="amuted">Update the app’s manifest first (docs/slack.md), then reinstall; nothing else changes.</span>
            </p>
          )}
          <h3>Is the app in each linked channel?</h3>
          {ready.channels?.length ? (
            <ul className="alist perms">
              {ready.channels.map((c) => (
                <li key={`${c.spaceId}:${c.channelId}`}>
                  {c.inChannel === null ? '○' : c.inChannel ? '✅' : '❌'} <strong>#{c.channelName}</strong>{' '}
                  <span className="amuted">
                    — {c.spaceName} ({c.slots.join(' + ')}){c.isPrivate ? ', private' : ''}
                  </span>
                  {c.inChannel === false &&
                    (c.isPrivate ? (
                      <span className="amuted"> · in Slack: /invite @Minglewood</span>
                    ) : (
                      <button className="abtn" onClick={() => void join(c.channelId)}>
                        Join
                      </button>
                    ))}
                </li>
              ))}
            </ul>
          ) : (
            <p className="amuted">No spaces are linked to Slack channels yet.</p>
          )}
          {notIn.length > 0 && <p className="amuted">Slack only sends a channel’s messages and huddles to apps that are in it.</p>}
          <button className="abtn" onClick={check}>
            Check again
          </button>
        </>
      )}
    </section>
  );
}

function RoomsTab({ data, reload }: TabProps) {
  const [channels, setChannels] = useState<Record<string, ExternalChannel[]>>({});
  const discord = data.connections.some((c) => c.provider === 'discord');
  useEffect(() => {
    void api<{ channels: ExternalChannel[] }>('/admin/channels?provider=demo').then((r) => setChannels((c) => ({ ...c, demo: r.channels })));
    if (discord)
      void api<{ channels: ExternalChannel[] }>('/admin/channels?provider=discord')
        .then((r) => setChannels((c) => ({ ...c, discord: r.channels })))
        .catch(() => undefined);
    if (data.slack.team)
      void api<{ channels: ExternalChannel[] }>('/admin/channels?provider=slack')
        .then((r) => setChannels((c) => ({ ...c, slack: r.channels })))
        .catch(() => undefined);
  }, [discord, data.slack.team, data.bindings.length]);
  const spaces: SpaceRow[] = [
    { id: 'town', name: 'Town', emoji: '🏘️', purpose: 'The open world — your “general”' },
    ...data.rooms.map((r) => ({ id: r.id, name: r.name, emoji: r.emoji, purpose: r.purpose, room: r })),
  ];
  return (
    <>
      {discord && <DiscordSetup reload={reload} />}
      {data.slack.team && <SlackSetup data={data} reload={reload} />}
      <section className="apanel wide">
        <h2>Spaces & channels</h2>
        <p className="amuted">
          Every space can have a <strong>voice</strong> channel (where you are when you’re there) and a <strong>text</strong>{' '}
          channel (its conversation, both ways). The world never depends on the platform — these links are the only
          connection, and the platform stays the record.
        </p>
        <table className="atable">
          <thead>
            <tr>
              <th>Space</th>
              <th>Platform</th>
              <th>Voice</th>
              <th>Text</th>
              <th>Description</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {spaces.map((sp) => (
              <SpaceRowView key={`${sp.id}:${data.bindings.filter((b) => b.roomId === sp.id).map((b) => b.externalChannelId).join(',')}`} space={sp} data={data} channels={channels} reload={reload} />
            ))}
          </tbody>
        </table>
      </section>
    </>
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
