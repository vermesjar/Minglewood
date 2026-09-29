/**
 * A board's notes (a whiteboard): what people have left for the room, oldest first, and a line to add one.
 * Your own notes — anyone's, for an admin — can be taken down.
 */
import { useState } from 'react';
import { NOTE_MAX_CHARS, NOTES_PER_BOARD } from '@shared/protocol';
import { noteColor } from '@shared/world/uses';
import type { SceneObject } from '@shared/world/scene';
import { game } from '../app/game';
import { setState, useStore } from '../app/store';
import { AvatarCanvas, Popover, timeAgo } from './common';

export function NotesBoard({ o, x, y }: { o: SceneObject; x: number; y: number }) {
  const all = useStore((s) => s.notes);
  const members = useStore((s) => s.membersById);
  const me = useStore((s) => s.boot?.me);
  const [text, setText] = useState('');
  const notes = all.filter((n) => n.objectId === o.id);
  const admin = me?.role === 'admin' || me?.role === 'owner';
  const info = o.actions?.find((a) => a.kind === 'info');
  const title = info?.kind === 'info' ? info.title : (o.label ?? 'Whiteboard');
  const post = () => {
    if (!text.trim()) return;
    game.postNote(o.id, text);
    setText('');
  };
  return (
    <Popover x={x} y={y} onClose={() => setState({ selection: null })} label={title}>
      <div className="notes-board">
        <h3>📝 {title}</h3>
        {info?.kind === 'info' && <p className="muted small">{info.body}</p>}
        {notes.length === 0 ? (
          <p className="muted">Nothing pinned up yet — leave the first note.</p>
        ) : (
          <ul className="notes">
            {notes.map((n) => {
              const m = members.get(n.by);
              return (
                <li key={n.id} className="note" style={{ background: noteColor(n.by) }}>
                  <p className="note-text">{n.text}</p>
                  <p className="note-by">
                    {m && <AvatarCanvas loadout={m.avatar} head scale={1} />}
                    <span>
                      {m?.displayName.split(' ')[0] ?? 'Someone'} · {timeAgo(n.at)}
                    </span>
                    {(n.by === me?.id || admin) && (
                      <button className="note-down" onClick={() => game.removeNote(n.id)} aria-label="Take this note down">
                        Take down
                      </button>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <form
          className="note-form"
          onSubmit={(e) => {
            e.preventDefault();
            post();
          }}
        >
          <input value={text} maxLength={NOTE_MAX_CHARS} onChange={(e) => setText(e.target.value)} placeholder="Leave a note for the room…" aria-label="Your note" />
          <button className="btn primary" disabled={!text.trim()}>
            Pin it
          </button>
        </form>
        <p className="fineprint">
          Short and kind — everyone in the room sees it. The board holds {NOTES_PER_BOARD}; the oldest comes down to make room.
        </p>
      </div>
    </Popover>
  );
}
