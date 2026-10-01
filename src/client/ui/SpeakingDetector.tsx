/**
 * Runs the mic-level talk detector while it's wanted: the member turned "show when I'm talking" on, and
 * they're actually in voice (or trying it in the demo). Renders nothing.
 */
import { useEffect, useRef } from 'react';
import { MicActivity } from '../app/micActivity';
import { game } from '../app/game';
import { setState, toast, useStore } from '../app/store';

export function SpeakingDetector() {
  const wanted = useStore((s) => !!s.prefs.talkLight);
  const meId = useStore((s) => s.boot?.me.id);
  const inVoice = useStore((s) => (meId ? !!s.occupants[meId]?.voice : false));
  const demo = useStore((s) => !!s.config?.demoMode && !s.boot?.discordConnected && !s.boot?.slackConnected);
  const mic = useRef<MicActivity | null>(null);
  const run = wanted && (inVoice || demo);

  useEffect(() => {
    if (!run) return;
    const m = new MicActivity((on) => game.rt?.send({ t: 'speaking', on }));
    mic.current = m;
    let cancelled = false;
    void m.start().then((ok) => {
      if (cancelled) return m.stop();
      if (!ok) {
        toast('Couldn’t use your microphone — allow it for this site to show when you’re talking.', 'info', undefined, 7000);
        setState((s) => ({ prefs: { ...s.prefs, talkLight: false } }));
      }
    });
    return () => {
      cancelled = true;
      m.stop();
      mic.current = null;
    };
  }, [run]);

  return null;
}
