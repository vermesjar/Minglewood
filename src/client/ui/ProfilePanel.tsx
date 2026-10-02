import { useState } from 'react';
import type { MemberSettings } from '@shared/domain/types';
import { api } from '../app/api';
import { game } from '../app/game';
import { setState, toast, useStore } from '../app/store';
import { Modal } from './common';

const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

export function ProfilePanel() {
  const me = useStore((s) => s.boot?.me);
  const prefs = useStore((s) => s.prefs);
  const slackConnected = useStore((s) => s.boot?.slackConnected);
  const [knockDms, setKnockDms] = useState(me?.settings.slackKnockDms ?? false);
  const discordLinked = useStore((s) => !!s.boot?.discordConnected);
  const [f, setF] = useState(() => ({
    displayName: me?.displayName ?? '',
    title: me?.title ?? '',
    pronouns: me?.pronouns ?? '',
    location: me?.location ?? '',
    interests: me?.interests.join(', ') ?? '',
    askMeAbout: me?.askMeAbout.join(', ') ?? '',
    locationVisibility: me?.settings.locationVisibility ?? 'everyone',
    knocksWhileFocused: me?.settings.knocksWhileFocused ?? false,
    voiceFollow: me?.settings.voiceFollow !== false,
  }));
  if (!me) return null;
  const close = () => setState({ panel: null });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await game.updateProfile({
        displayName: f.displayName,
        title: f.title,
        pronouns: f.pronouns,
        location: f.location,
        interests: list(f.interests).slice(0, 8),
        askMeAbout: list(f.askMeAbout).slice(0, 6),
        settings: { locationVisibility: f.locationVisibility as MemberSettings['locationVisibility'], knocksWhileFocused: f.knocksWhileFocused, voiceFollow: f.voiceFollow },
      });
      toast('Profile saved', 'info', undefined, 2500);
      close();
    } catch (x) {
      toast(`Couldn’t save: ${(x as Error).message}`);
    }
  };
  const pref = (k: keyof typeof prefs) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setState((s) => ({ prefs: { ...s.prefs, [k]: e.target.checked } }));
    setTimeout(() => game.applyPrefs(), 0);
  };

  return (
    <Modal onClose={close} label="Profile and privacy" wide>
      <form className="profile-form" onSubmit={save}>
        <div className="cols">
          <section>
            <h2 className="pixel">You</h2>
            <label className="field">
              <span>Name</span>
              <input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} maxLength={40} required />
            </label>
            <label className="field">
              <span>What you do</span>
              <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={60} />
            </label>
            <div className="row">
              <label className="field">
                <span>Pronouns</span>
                <input value={f.pronouns} onChange={(e) => setF({ ...f, pronouns: e.target.value })} maxLength={20} placeholder="optional" />
              </label>
              <label className="field">
                <span>Where you are</span>
                <input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} maxLength={40} />
              </label>
            </div>
            <label className="field">
              <span>Ask me about (comma separated)</span>
              <input value={f.askMeAbout} onChange={(e) => setF({ ...f, askMeAbout: e.target.value })} />
            </label>
            <label className="field">
              <span>Interests (comma separated)</span>
              <input value={f.interests} onChange={(e) => setF({ ...f, interests: e.target.value })} />
            </label>
          </section>
          <section>
            <h2 className="pixel">Privacy</h2>
            <fieldset className="field">
              <legend>Who can see which room I’m in?</legend>
              {(
                [
                  ['everyone', 'Everyone at the company'],
                  ['team', 'Just my team'],
                  ['nobody', 'Nobody — just show my status'],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className="radio">
                  <input type="radio" name="vis" checked={f.locationVisibility === v} onChange={() => setF({ ...f, locationVisibility: v })} />
                  {label}
                </label>
              ))}
            </fieldset>
            <label className="check">
              <input type="checkbox" checked={f.knocksWhileFocused} onChange={(e) => setF({ ...f, knocksWhileFocused: e.target.checked })} />
              <span>Let knocks through even when I’m focused</span>
            </label>
            {(discordLinked || slackConnected) && (
              <label className="check">
                <input type="checkbox" checked={f.voiceFollow} onChange={(e) => setF({ ...f, voiceFollow: e.target.checked })} />
                <span>
                  {discordLinked
                    ? 'Voice follows me — while I’m in Discord voice, walking into a space moves me into its voice channel; switching channels in Discord walks me over'
                    : 'Voice follows me — when I join a huddle in Slack, my avatar walks into that huddle’s space'}
                </span>
              </label>
            )}
            {slackConnected && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={knockDms}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setKnockDms(enabled);
                    api('/slack/me/knock-dms', { method: 'PUT', json: { enabled } }).catch((x) => (setKnockDms(!enabled), toast(`Couldn’t save: ${(x as Error).message}`)));
                  }}
                />
                <span>When I’m not here, send knocks to me as a Slack DM (needs Sign in with Slack once)</span>
              </label>
            )}
            <div className="promise-box">
              <strong>What Minglewood never does</strong>
              <ul>
                <li>No activity tracking, keystrokes, or “time online”.</li>
                <li>No productivity scores, rankings, or attendance reports.</li>
                <li>Presence is live only — it’s never stored as history.</li>
              </ul>
            </div>
            <h2 className="pixel">Comfort</h2>
            <label className="check">
              <input type="checkbox" checked={prefs.reducedMotion} onChange={pref('reducedMotion')} />
              <span>Reduce motion</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={prefs.highContrast} onChange={pref('highContrast')} />
              <span>High-contrast interface</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={prefs.showAllNames} onChange={pref('showAllNames')} />
              <span>Always show everyone’s names</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={!!prefs.talkLight} onChange={pref('talkLight')} />
              <span>Light up my avatar when I talk in voice — uses my mic level on this device only; no audio is recorded or sent</span>
            </label>
          </section>
        </div>
        <div className="row end">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}
