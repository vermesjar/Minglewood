import { Fragment, useState } from 'react';

const PLAY_HINT: Partial<Record<string, string>> = {
  highfive: 'select someone first, then high-five',
  dance: 'two or more dancers start a disco',
  plane: 'select someone to throw it at them',
};
import { EMOTES, EMOTE_IDS } from '@shared/presence';
import { game } from '../app/game';
import { setState, useStore } from '../app/store';

export function ActionBar() {
  const [text, setText] = useState('');
  const sceneId = useStore((s) => s.sceneId);
  const rooms = useStore((s) => s.boot?.rooms);
  const selection = useStore((s) => s.selection);
  const meId = useStore((s) => s.boot?.me.id);
  const sitting = useStore((s) => (meId ? s.occupants[meId]?.sittingOn : undefined));
  const quiet = rooms?.find((r) => r.id === sceneId)?.quiet;
  const target = selection?.kind === 'member' ? selection.id : undefined;
  const prefs = useStore((s) => s.prefs);

  return (
    <div className="action-bar card" role="toolbar" aria-label="Actions">
      <div className="emotes">
        {EMOTE_IDS.map((id, i) => (
          <Fragment key={id}>
            {id === 'highfive' && <span className="emote-sep" aria-hidden />}
            <button
              className="emote-btn"
              onClick={() => game.emote(id, target)}
              title={`${EMOTES[id].label}${i < 9 ? ` (${i + 1})` : ''}${PLAY_HINT[id] ? ` — ${PLAY_HINT[id]}` : ''}`}
              aria-label={EMOTES[id].label}
            >
              {EMOTES[id].emoji}
            </button>
          </Fragment>
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
      <button
        className="icon-btn"
        onClick={() => {
          setState({ prefs: { ...prefs, sound: !prefs.sound } });
          game.applyPrefs();
        }}
        aria-pressed={!!prefs.sound}
        aria-label={prefs.sound ? 'Mute sound effects' : 'Turn on sound effects'}
        title={prefs.sound ? 'Sound on' : 'Sound off'}
      >
        {prefs.sound ? '🔊' : '🔈'}
      </button>
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
