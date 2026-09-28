import { useEffect, useRef, useState } from 'react';
import { game } from '../app/game';
import { useStore } from '../app/store';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { RoomPanel } from './RoomPanel';
import { ActionBar } from './ActionBar';
import { SelectionLayer } from './SelectionLayer';
import { Toasts } from './Toasts';
import { SearchPalette } from './SearchPalette';
import { PeoplePanel } from './PeoplePanel';
import { AvatarEditor } from './AvatarEditor';
import { ProfilePanel } from './ProfilePanel';
import { Welcome, TourGuide } from './Welcome';
import { DecoratePalette } from './DecoratePalette';

export function WorldScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panel = useStore((s) => s.panel);
  const hoverLabel = useStore((s) => s.hoverLabel);
  const announce = useStore((s) => s.announce);
  const org = useStore((s) => s.boot?.org.name);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    game.attach(c);
    return () => game.detach();
  }, []);

  return (
    <div className="world-screen" onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}>
      <canvas
        ref={canvasRef}
        className="world-canvas"
        role="application"
        aria-label={`${org ?? 'Company'} world map. Everything here is also available from the sidebar, the people directory and search (Ctrl+K).`}
      />
      {hoverLabel && (
        <div className="hover-label" style={{ left: mouse.x + 14, top: mouse.y + 16 }} aria-hidden>
          {hoverLabel}
        </div>
      )}
      <TopBar />
      <Sidebar />
      <RoomPanel />
      <ActionBar />
      <DecoratePalette />
      <SelectionLayer />
      <Toasts />
      <TourGuide />
      {panel === 'search' && <SearchPalette />}
      {panel === 'people' && <PeoplePanel />}
      {panel === 'avatar' && <AvatarEditor />}
      {panel === 'profile' && <ProfilePanel />}
      <Welcome />
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}
