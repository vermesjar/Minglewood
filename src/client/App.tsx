import { useEffect } from 'react';
import { BRAND } from '@shared/brand';
import { setState, useStore } from './app/store';
import { game } from './app/game';
import { Landing } from './ui/Landing';
import { WorldScreen } from './ui/WorldScreen';
import { AdminConsole } from './admin/AdminConsole';

export function App() {
  const phase = useStore((s) => s.phase);
  const view = useStore((s) => s.view);
  const prefs = useStore((s) => s.prefs);

  useEffect(() => {
    const onHash = () => {
      const view = location.hash === '#/admin' ? 'admin' : 'world';
      setState({ view });
      if (view === 'world') void game.refreshBoot();
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('hc', prefs.highContrast);
    document.body.classList.toggle('rm', prefs.reducedMotion);
  }, [prefs.highContrast, prefs.reducedMotion]);

  if (phase === 'loading') {
    return (
      <div className="loading-screen" role="status">
        <div className="loading-mark" aria-hidden>
          🌲
        </div>
        <p>Opening the doors at {BRAND.name}…</p>
      </div>
    );
  }
  if (phase === 'landing') return <Landing />;
  return view === 'admin' ? <AdminConsole /> : <WorldScreen />;
}
