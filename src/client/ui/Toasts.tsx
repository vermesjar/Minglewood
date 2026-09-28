import { game } from '../app/game';
import { setState, useStore } from '../app/store';
import { AvatarCanvas } from './common';

function KnockPrompt() {
  const knocks = useStore((s) => s.knocks);
  const members = useStore((s) => s.membersById);
  const k = knocks[0];
  if (!k) return null;
  const m = members.get(k.fromId);
  const first = m?.displayName.split(' ')[0] ?? 'Someone';
  return (
    <div className="knock card" role="alertdialog" aria-label={`${first} is knocking`}>
      {m && (
        <div className="knock-avatar">
          <AvatarCanvas loadout={m.avatar} scale={2} />
        </div>
      )}
      <div className="knock-body">
        <p className="knock-title">
          {k.kind === 'coffee' ? (
            <>
              ☕ <strong>{first}</strong> is inviting you for a coffee
            </>
          ) : (
            <>
              🚪 <strong>{first}</strong> is nearby and wants to chat
            </>
          )}
        </p>
        <p className="muted small">{m?.title}</p>
        <div className="row">
          <button className="btn primary" onClick={() => game.replyKnock(k.knockId, 'join')}>
            Join {first}
          </button>
          <button className="btn" onClick={() => game.replyKnock(k.knockId, 'soon')}>
            In a few minutes
          </button>
          <button className="btn ghost-btn" onClick={() => game.replyKnock(k.knockId, 'no')}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <>
      <KnockPrompt />
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast card ${t.tone ?? 'info'}`}>
            <span>{t.text}</span>
            {t.action && (
              <button
                className="btn small primary"
                onClick={() => {
                  t.action!.run();
                  setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
