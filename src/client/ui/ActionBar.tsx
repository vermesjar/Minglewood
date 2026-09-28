import { useState } from 'react';
import { EMOTES, EMOTE_IDS } from '@shared/presence';
import { game } from '../app/game';
import { useStore } from '../app/store';

export function ActionBar() {
  const [text, setText] = useState('');
  const sceneId = useStore((s) => s.sceneId);
  const rooms = useStore((s) => s.boot?.rooms);
  const selection = useStore((s) => s.selection);
  const meId = useStore((s) => s.boot?.me.id);
  const sitting = useStore((s) => (meId ? s.occupants[meId]?.sittingOn : undefined));
  const quiet = rooms?.find((r) => r.id === sceneId)?.quiet;
  const target = selection?.kind === 'member' ? selection.id : undefined;

  return (
    <div className="action-bar card" role="toolbar" aria-label="Actions">
      <div className="emotes">
        {EMOTE_IDS.map((id, i) => (
          <button key={id} className="emote-btn" onClick={() => game.emote(id, target)} title={`${EMOTES[id].label} (${i + 1})`} aria-label={EMOTES[id].label}>
            {EMOTES[id].emoji}
          </button>
        ))}
      </div>
      <form
        className="chat"
        onSubmit={(e) => {
          e.preventDefault();
          game.say(text);
          setText('');
          (document.activeElement as HTMLElement)?.blur();
        }}
      >
        <input
          id="mw-chat"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={120}
          disabled={quiet}
          placeholder={quiet ? 'Quiet room — emotes only 🤫' : 'Say something to the room… (Enter)'}
          aria-label="Say something to people in this room"
        />
      </form>
      {sitting && (
        <button className="btn small" onClick={() => game.rt?.send({ t: 'stand' })}>
          Stand up
        </button>
      )}
      <div className="zoom">
        <button className="icon-btn" onClick={() => game.world?.zoomBy(0.8)} aria-label="Zoom out">
          −
        </button>
        <button className="icon-btn" onClick={() => game.world?.zoomBy(1.25)} aria-label="Zoom in">
          +
        </button>
      </div>
    </div>
  );
}
