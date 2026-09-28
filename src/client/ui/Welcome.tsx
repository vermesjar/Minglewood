import { useEffect } from 'react';
import { game } from '../app/game';
import { setState, useStore } from '../app/store';
import { AvatarCanvas, Modal } from './common';

/** First day: arriving somewhere, not reading a handbook. */
export function Welcome() {
  const open = useStore((s) => s.welcomeOpen);
  const boot = useStore((s) => s.boot);
  if (!open || !boot) return null;
  const me = boot.me;
  const team = boot.teams.find((t) => t.id === me.teamId);
  const manager = boot.members.find((m) => m.id === me.managerId);
  const buddy = boot.members.find((m) => m.id === 'm-rosa');
  const markSeen = () => localStorage.setItem(`mw.welcomed.${me.id}`, '1');
  const start = () => {
    markSeen();
    setState({ welcomeOpen: false, panel: 'avatar', tour: { active: false, step: 0 } });
  };
  const skip = () => {
    markSeen();
    setState({ welcomeOpen: false });
  };
  return (
    <Modal onClose={skip} label="Welcome">
      <div className="welcome">
        <p className="kicker">Day one</p>
        <h2 className="pixel">Welcome to {boot.org.name}, {me.displayName.split(' ')[0]}!</h2>
        <p>
          This is the company — as a place. Everyone you see is a real coworker, and the buildings are where conversations
          happen. Nothing to read first; just look around.
        </p>
        <ul className="welcome-list">
          {team && (
            <li>
              <span aria-hidden>{team.emoji}</span> You’re joining <strong>{team.name}</strong>
              {team.homeRoomId && <> — they hang out in {boot.rooms.find((r) => r.id === team.homeRoomId)?.name}</>}.
            </li>
          )}
          {manager && (
            <li>
              <AvatarCanvas loadout={manager.avatar} head scale={2} /> <span>{manager.displayName} is your manager.</span>
            </li>
          )}
          {buddy && (
            <li>
              <AvatarCanvas loadout={buddy.avatar} head scale={2} /> <span>{buddy.displayName.split(' ')[0]} is your onboarding buddy — watch for a wave.</span>
            </li>
          )}
        </ul>
        <div className="row end">
          <button className="btn" onClick={skip}>
            Just let me explore
          </button>
          <button className="btn primary" onClick={start}>
            Make my avatar →
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface Step {
  roomId?: string;
  title: string;
  text: (ctx: { team?: string; teamRoom?: string }) => string;
}

const STEPS: Step[] = [
  { roomId: 'hq', title: 'Northstar HQ', text: () => 'The lobby holds the history wall: the garage, the first customer, the Lisbon offsite. Every big moment leaves something behind.' },
  { roomId: 'team', title: 'Your team’s space', text: ({ team, teamRoom }) => `${team ?? 'Your team'} hangs out in ${teamRoom ?? 'their room'}. The faces on the sign show who’s in right now.` },
  { roomId: 'cafe', title: 'Tidewater Café', text: () => 'Where people drift in for a chat. If a few people are inside, that’s your cue — walk in and say hi. The conversation runs in Discord.' },
  { roomId: 'events', title: 'Lantern Hall', text: () => 'All-hands, demo days and celebrations. Right now: Jonah’s birthday. Everyone’s welcome; there’s a party hat with your name on it.' },
  { roomId: 'focus', title: 'The Quiet Grove', text: () => 'For deep work. Everyone inside shows as focused and knocks wait until they’re free. Focus is respected here.' },
  { title: 'You’re all set', text: () => 'Green dots mean “open to chat”. Click anyone to see who they are — and knock before you interrupt. Your optional first-week quests are in the sidebar.' },
];

export function TourGuide() {
  const tour = useStore((s) => s.tour);
  const boot = useStore((s) => s.boot);
  const sceneId = useStore((s) => s.sceneId);
  const step = tour?.active ? STEPS[tour.step] : undefined;
  const team = boot?.teams.find((t) => t.id === boot.me.teamId);
  const teamRoomId = team?.homeRoomId;
  const roomId = step?.roomId === 'team' ? teamRoomId : step?.roomId;

  useEffect(() => {
    if (!tour?.active) return;
    if (sceneId !== 'town') {
      game.goTo('town');
      return;
    }
    if (roomId) game.focusRoom(roomId);
  }, [tour?.active, tour?.step, roomId, sceneId]);

  if (!tour?.active || !step || !boot) return null;
  const last = tour.step === STEPS.length - 1;
  const next = () => setState({ tour: last ? null : { active: true, step: tour.step + 1 } });
  return (
    <div className="tour card" role="dialog" aria-label="Town tour">
      <div className="guide-mark" aria-hidden>
        🧭
      </div>
      <div>
        <p className="kicker">
          Town tour · {tour.step + 1}/{STEPS.length}
        </p>
        <h3>{step.roomId === 'team' ? (boot.rooms.find((r) => r.id === teamRoomId)?.name ?? step.title) : step.title}</h3>
        <p>{step.text({ team: team?.name, teamRoom: boot.rooms.find((r) => r.id === teamRoomId)?.name })}</p>
        <div className="row">
          {roomId && (
            <button className="btn small" onClick={() => (setState({ tour: null }), game.enterRoom(roomId))}>
              Go inside
            </button>
          )}
          <button className="btn small primary" onClick={next}>
            {last ? 'Start exploring' : 'Next →'}
          </button>
          {!last && (
            <button className="link" onClick={() => setState({ tour: null })}>
              Skip tour
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
