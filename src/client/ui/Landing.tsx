import { useEffect, useRef, useState } from 'react';
import { BRAND } from '@shared/brand';
import type { Bootstrap } from '@shared/api';
import { TEAMS } from '@shared/seed/northstar';
import { getScene, TOWN_ID } from '@shared/world';
import { api } from '../app/api';
import { game } from '../app/game';
import { useStore } from '../app/store';
import { WorldView } from '../engine/WorldView';

const INTERESTS = ['coffee', 'climbing', 'board games', 'film', 'hiking', 'cooking', 'music', 'cycling', 'reading', 'gaming', 'plants', 'running'];

const ERRORS: Record<string, string> = {
  not_member: 'That Discord account isn’t a member of the company server.',
  no_guild: 'No Discord server is connected yet — an admin needs to connect one.',
  no_install: 'Minglewood isn’t in any of your Discord servers yet. Ask a server admin to add it — it takes a minute.',
  oauth_state: 'The sign-in link expired. Please try again.',
  oauth_failed: 'Discord sign-in failed. Please try again.',
  slack_no_install: 'Minglewood isn’t connected to that Slack workspace yet. Ask a workspace admin to add it.',
  slack_failed: 'Slack sign-in failed. Please try again.',
  activity_auth: 'Minglewood needs your OK in Discord to know who you are. Relaunch the Activity to try again.',
};

/** Slowly drifting preview of the town behind the sign-in card. */
function WorldBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const scene = getScene(TOWN_ID);
    if (!canvas || !scene) return;
    const view = new WorldView(canvas, {
      onGroundClick: () => undefined,
      onActorClick: () => undefined,
      onObjectClick: () => undefined,
      onObjectActivate: () => undefined,
      nameOf: () => '',
    });
    view.loadScene(scene, [], { meId: '', activeDecor: new Set(['balloons']), festiveRooms: new Set(['events']), party: false });
    const start = view.camera.x;
    let t = 0;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    view.camera.jump(start, view.camera.y, window.innerWidth < 700 ? 1.2 : 1.6);
    const id = window.setInterval(() => {
      if (reduced) return;
      t += 0.016;
      view.camera.panTo(start + Math.sin(t * 0.15) * 220, view.camera.ty);
    }, 16);
    return () => {
      clearInterval(id);
      view.destroy();
    };
  }, []);
  return <canvas ref={ref} className="landing-world" aria-hidden />;
}

export function Landing() {
  const config = useStore((s) => s.config);
  const guild = new URLSearchParams(location.search).get('guild');
  const discordHref = `/api/auth/discord/start${guild ? `?guild=${encodeURIComponent(guild)}` : ''}`;
  const authError = useStore((s) => s.authError);
  const inDiscord = useStore((s) => s.inDiscord);
  const [name, setName] = useState('');
  const [teamId, setTeamId] = useState('team-aurora');
  const [interests, setInterests] = useState<string[]>(['coffee']);
  const [admin, setAdmin] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(() => {
    const e = authError ?? new URLSearchParams(location.search).get('error');
    return e ? (ERRORS[e] ?? 'Something went wrong signing in.') : null;
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api('/auth/demo', { method: 'POST', json: { name: name.trim(), teamId, interests, admin } });
      const boot = await api<Bootstrap>('/bootstrap');
      history.replaceState(null, '', '/');
      game.begin(boot);
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };

  const toggle = (i: string) => setInterests((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].slice(0, 6)));

  return (
    <div className="landing">
      <WorldBackdrop />
      <div className="landing-glow" aria-hidden />
      <main className="landing-card card">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden>
            🌲
          </span>
          <div>
            <h1 className="pixel">{BRAND.name}</h1>
            <p className="tagline">{BRAND.tagline}</p>
          </div>
        </div>
        <p className="pitch">
          See who’s around. Drop into conversations. Meet the people you’d bump into at an office — and let your company
          build a place with its own history.
        </p>

        {inDiscord && err && (
          <p className="error" role="alert">
            {err}
          </p>
        )}
        <form onSubmit={submit} className="landing-form" hidden={inDiscord}>
          <h2>
            Start your first day at <span className="hl">Northstar Labs</span>
            <span className="demo-chip">demo company</span>
          </h2>
          <label className="field">
            <span>What should coworkers call you?</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" maxLength={40} autoFocus required />
          </label>
          <label className="field">
            <span>Which team are you joining?</span>
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              {TEAMS.filter((t) => t.id !== 'team-leadership').map((t) => (
                <option key={t.id} value={t.id}>
                  {t.emoji} {t.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="field">
            <legend>A few things you’re into (helps coworkers find common ground)</legend>
            <div className="chips">
              {INTERESTS.map((i) => (
                <button type="button" key={i} className={`chip ${interests.includes(i) ? 'on' : ''}`} aria-pressed={interests.includes(i)} onClick={() => toggle(i)}>
                  {i}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="check">
            <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
            <span>Also let me peek at the admin console</span>
          </label>
          {err && (
            <p className="error" role="alert">
              {err}
            </p>
          )}
          <button className="btn primary big" disabled={busy || !name.trim()}>
            {busy ? 'Opening the doors…' : 'Walk in →'}
          </button>
        </form>

        <div className="or">
          <span>or</span>
        </div>
        {config?.slack?.enabled && (
          <a className="btn slack big" href="/api/slack/auth/start">
            <span aria-hidden>💬</span> Continue with Slack
          </a>
        )}
        {config?.discord.enabled ? (
          <>
            <a className="btn discord big" href={discordHref}>
              <span aria-hidden>🎮</span> {guild ? 'Enter your company town' : 'Continue with Discord'}
            </a>
            {config.installUrl && (
              <p className="muted small center-text">
                Running a team? <a href={config.installUrl}>Add Minglewood to your Discord server</a>.
              </p>
            )}
          </>
        ) : config?.slack?.enabled ? null : (
          <p className="muted small">
            Discord sign-in isn’t configured on this server yet. Add your app credentials to <code>.env</code> — see{' '}
            <code>docs/DISCORD.md</code>.
          </p>
        )}
        <p className="promise">
          <strong>Presence without surveillance.</strong> Minglewood never tracks activity, time online, or productivity. You
          choose what you share.
        </p>
      </main>
    </div>
  );
}
