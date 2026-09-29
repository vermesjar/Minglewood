import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMsg } from '@shared/protocol';
import { getScene } from '@shared/world';
import { GREET_MS, NpcDirector } from './npcs';

type NpcMsg = Extract<ServerMsg, { t: 'npc' }>;

describe('room NPCs', () => {
  let sent: ServerMsg[];
  let npcs: NpcDirector;
  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    npcs = new NpcDirector({ scene: (id) => getScene(id), toScene: (_s, m) => sent.push(m) }, Date.now, (xs) => xs[0]);
  });
  afterEach(() => {
    npcs.dispose();
    vi.useRealTimers();
  });
  const said = (id: string) => sent.filter((m): m is NpcMsg => m.t === 'npc' && m.npc.id === id && !!m.npc.say);

  it('greets someone who comes in — once a visit, turned toward them and waving', () => {
    npcs.statesIn('hq');
    npcs.arrived('hq', 'ada', [0, 9]);
    vi.advanceTimersByTime(1000);
    const hello = said('receptionist');
    expect(hello).toHaveLength(1);
    expect(hello[0].npc).toMatchObject({ doing: 'greet', say: 'Welcome to Northstar!' });
    vi.advanceTimersByTime(GREET_MS + 100);
    const back = sent.filter((m): m is NpcMsg => m.t === 'npc' && m.npc.id === 'receptionist').pop()!;
    expect(back.npc.doing).not.toBe('greet');
    expect(back.npc.say).toBeUndefined();
    // walking up again right away doesn't get another hello
    npcs.approached('hq', 'ada', [7, 3]);
    expect(said('receptionist')).toHaveLength(1);
  });

  it('says hello at most every few seconds however busy the door is', () => {
    npcs.statesIn('hq');
    npcs.arrived('hq', 'ada', [0, 9]);
    npcs.arrived('hq', 'bo', [0, 9]);
    vi.advanceTimersByTime(1000);
    expect(said('receptionist')).toHaveLength(1);
  });

  it('keeps the librarian quiet', () => {
    npcs.statesIn('focus');
    npcs.arrived('focus', 'ada', [0, 5]);
    vi.advanceTimersByTime(1000);
    expect(said('librarian')).toHaveLength(0);
  });

  it('works at a work spot and sits at a seat spot', () => {
    const hq = getScene('hq')!;
    const margot = hq.npcs!.find((n) => n.id === 'receptionist')!;
    const seat = margot.spots.find((s) => s.sit)!;
    expect(hq.objects.some((o) => o.id === seat.sit)).toBe(true);
    // Margot's chair is hers: guests can't take it
    expect(hq.objects.find((o) => o.id === seat.sit)!.actions?.some((a) => a.kind === 'sit')).toBeFalsy();
    const random = vi.spyOn(Math, 'random');
    npcs.statesIn('hq');
    let seated = false;
    let worked = false;
    for (let i = 0; i < 12 && !(seated && worked); i++) {
      random.mockReturnValue((i % 3) / 3 + 0.01);
      vi.advanceTimersByTime(40_000);
      npcs.tick();
      vi.advanceTimersByTime(5000);
      const st = npcs.statesIn('hq').find((s) => s.id === 'receptionist')!;
      if (st.sittingOn === seat.sit) seated = true;
      if (st.doing === 'work') worked = true;
    }
    random.mockRestore();
    expect(seated).toBe(true);
    expect(worked).toBe(true);
  });

  it('has the attendant hand over a prize from the counter', () => {
    const arcade = getScene('arcade')!;
    const counter = arcade.objects.find((o) => o.sprite === 'prize-counter')!;
    expect(npcs.serverFor('arcade', counter)?.id).toBe('attendant');
    const done = vi.fn();
    npcs.serve('arcade', counter, 'ada', done, 'plush');
    vi.advanceTimersByTime(5000);
    expect(done).toHaveBeenCalledOnce();
    const handing = sent.find((m): m is NpcMsg => m.t === 'npc' && m.npc.doing === 'serve');
    expect(handing?.npc).toMatchObject({ id: 'attendant', holding: 'plush' });
  });
});
