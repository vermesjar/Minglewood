/**
 * Try it in game: the draft piece in a small room, drawn by the real renderer (WorldView) from the draft's own
 * sprites (a virtual art root that swaps the draft into the published catalog: devLab.ts /art/:id). Turn it (R), walk
 * around it, sit on every cushion, use it, flip day and night, zoom, and fill the room with people.
 *
 * A seat's people are drawn the game's one way, from its model (sprites/seatLayers.ts): the draft's own model rides in
 * its sandbox manifest entry (`seatModel`, read by art.ts artSeatModel), so every change in How people sit in it shows
 * here as it will in the game once the draft is saved (the room is rebuilt on every save).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Occupant } from '@shared/protocol';
import { COUNTER_TOP, type ObjectAction, type SceneDef, type SceneObject } from '@shared/world/scene';
import { seatSpots } from '@shared/world/seats';
import { approach } from '@shared/world/interact';
import { findPath, type Tile } from '@shared/world/pathfinding';
import { WalkGrid } from '@shared/world/walkGrid';
import { buildSeed } from '@shared/seed/northstar';
import { WorldView } from '../engine/WorldView';
import { artCatalog, loadArt } from '../engine/sprites/art';
import { clearSpriteCache } from '../engine/sprites/registry';
import { setSkyOverride } from '../engine/weather';
import { lab, type Draft, type Facing } from './api';
import { footprintFor, TURN } from './pixels';

const ME = 'm-lab-you';
const seed = buildSeed();
const noop = () => undefined;

type Hooks = {
  camera: { zoom: number; tzoom: number; maxZoom: number; lastManual: number; snap(z: number): number };
  isMoving(id: string): boolean;
};

function actionsOf(d: Draft): ObjectAction[] {
  const f = d.furniture!;
  const out: ObjectAction[] = [];
  if (f.seat !== null) out.push({ kind: 'sit' });
  if (f.light) out.push({ kind: 'toggle', label: 'Switch on/off' });
  for (const a of f.actions) if (a.kind !== 'sit' && a.kind !== 'toggle') out.push(a as unknown as ObjectAction);
  return out;
}

export function sandboxScene(d: Draft, facing: Facing): SceneDef {
  const f = d.furniture!;
  const [w, dd] = footprintFor(f, facing);
  const label = f.name || d.title;
  const left = facing === 'se' || facing === 'nw';
  const piece: SceneObject =
    f.rotation === 'flat'
      ? // on a wall, turned (R) from one to the other, over the span the lab's manifest gives it: wide enough for its
        // drawing at 2:1 (the wall art standard grows a span, never squeezes a drawing)
        { id: 'draft', sprite: d.key, wall: left ? 'left' : 'right', x: left ? 0 : 3, y: left ? 3 : 0, w: artCatalog().find((a) => a.key === d.key)?.footprint[0] ?? f.footprint[0], label, actions: actionsOf(d) }
      : { id: 'draft', sprite: d.key, x: 4, y: 4, w, d: dd, facing, label, actions: actionsOf(d) };
  // a counter-top piece stands on a counter, as it would in a room
  const counter: SceneObject[] = [];
  if (f.layer === 'surface' && f.rotation !== 'flat') {
    piece.z = COUNTER_TOP;
    for (let x = 0; x < w; x++)
      for (let y = 0; y < dd; y++) counter.push({ id: `lab-counter-${x}-${y}`, sprite: 'counter', x: 4 + x, y: 4 + y, facing: facing === 'ne' || facing === 'nw' ? 'sw' : facing, variant: 'cafe', label: 'Counter' });
  }
  return {
    id: `lab-${d.id}`,
    kind: 'interior',
    name: 'Design Lab sandbox',
    width: 10,
    height: 10,
    tiles: Array.from({ length: 10 }, () => '.'.repeat(10)),
    spawn: { x: 1, y: 8 },
    objects: [
      { id: 'lab-rug', sprite: 'rug', x: 3, y: 3, w: 4, d: 4, flat: true, variant: 'oat' },
      { id: 'lab-plant', sprite: 'plant.b', x: 9, y: 0 },
      ...counter,
      piece,
    ],
    interior: { floor: '#c9a47e', floorAlt: '#bf9872', floorPattern: 'planks', wall: '#f3dcb8', wallTop: '#8a5a3b', trim: '#6b3f2a', doorY: 8, ambient: 'bright' },
  };
}

export function Sandbox({ draft, version, onNote }: { draft: Draft; version: string; onNote: (s: string) => void }) {
  const holder = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<WorldView | null>(null);
  const sceneRef = useRef<SceneDef | null>(null);
  const occRef = useRef<Map<string, Occupant>>(new Map());
  const [facing, setFacing] = useState<Facing>(draft.furniture?.rotation === 'mirror' && draft.furniture.footprint[0] !== draft.furniture.footprint[1] ? 'sw' : 'se');
  const [night, setNight] = useState(false);
  const [zoom, setZoom] = useState(2);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [ready, setReady] = useState(false);

  const me = (): Occupant => occRef.current.get(ME)!;

  const build = useCallback(async () => {
    const canvas = holder.current;
    if (!canvas) return;
    setReady(false);
    await loadArt(lab.artBase(draft.id));
    clearSpriteCache();
    viewRef.current?.destroy();
    const scene = sandboxScene(draft, facing);
    sceneRef.current = scene;
    const occ = new Map<string, Occupant>();
    occ.set(ME, { memberId: ME, x: 1, y: 8, facing: 'ne', status: 'available', avatar: seed.members[4].avatar, via: 'live' });
    occRef.current = occ;
    const view = new WorldView(canvas, {
      onGroundClick: (t) => walk(t),
      onActorClick: noop,
      onObjectClick: (o) => operate(o),
      onObjectActivate: noop,
      nameOf: (id) => (id === ME ? 'You' : (seed.members.find((m) => m.id === id)?.displayName ?? 'Someone')),
    });
    view.loadScene(scene, [...occ.values()], { meId: ME, activeDecor: new Set(), festiveRooms: new Set(), party: false });
    viewRef.current = view;
    (window as unknown as { labView?: WorldView }).labView = view; // for poking at it from the console
    // the room refits itself to the canvas on every resize; keep the zoom picked here after each refit
    const hooks = view as unknown as { resize(): void };
    const refit = hooks.resize.bind(view);
    hooks.resize = () => {
      refit();
      applyZoom(view, zoomRef.current);
    };
    applyZoom(view, zoomRef.current);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id, facing, version]);

  useEffect(() => {
    void build();
  }, [build]);
  useEffect(() => () => viewRef.current?.destroy(), []);
  useEffect(() => {
    setSkyOverride(night ? { phase: 'night', sun: 0, lamp: 1 } : { phase: 'day', weather: 'clear', sun: 0.8, lamp: 0.2 });
    return () => setSkyOverride(null);
  }, [night]);
  useEffect(() => {
    if (viewRef.current) applyZoom(viewRef.current, zoom);
  }, [zoom]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.key === 'r' || e.key === 'R') setFacing((f) => TURN[f]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Zoom as the game does, in whole art pixels (1–4 screen px per art px), about the room's centre. */
  function applyZoom(view: WorldView, z: number) {
    const cam = (view as unknown as Hooks).camera;
    cam.maxZoom = Math.max(cam.maxZoom, 4);
    cam.tzoom = cam.snap(z);
    cam.lastManual = performance.now();
  }

  function grid() {
    return new WalkGrid(sceneRef.current!);
  }

  function walkTo(goal: Tile, then?: () => void, allowGoal = false) {
    const view = viewRef.current;
    const m = me();
    if (!view) return;
    const from = view.actorTile(ME) ?? [m.x, m.y];
    const path = findPath(grid(), from as Tile, goal, { allowGoal });
    if (!path) {
      onNote('Can’t get there from here.');
      return;
    }
    if (m.sittingOn) view.patch(ME, { sittingOn: undefined });
    view.move(ME, path, Date.now());
    const done = () => {
      if ((view as unknown as Hooks).isMoving(ME)) {
        setTimeout(done, 60);
        return;
      }
      then?.();
    };
    setTimeout(done, 80);
  }

  function walk(t: Tile) {
    const scene = sceneRef.current!;
    const spot = scene.objects.flatMap((o) => seatSpots(o, scene).map((s) => ({ o, s }))).find(({ s }) => s.x === t[0] && s.y === t[1]);
    if (spot) return sitOn(spot.o, [spot.s.x, spot.s.y]);
    walkTo(t);
  }

  function sitOn(o: SceneObject, prefer?: Tile) {
    const scene = sceneRef.current!;
    const view = viewRef.current!;
    const taken = new Set([...occRef.current.values()].filter((p) => p.memberId !== ME && p.sittingOn === o.id).map((p) => `${p.x},${p.y}`));
    const spots = seatSpots(o, scene).filter((s) => !taken.has(`${s.x},${s.y}`));
    if (!spots.length) return onNote('Every cushion is taken.');
    const ref = prefer ?? view.actorTile(ME) ?? [0, 0];
    spots.sort((a, b) => Math.hypot(a.x - ref[0], a.y - ref[1]) - Math.hypot(b.x - ref[0], b.y - ref[1]));
    const s = spots[0];
    walkTo([s.x, s.y], () => {
      view.patch(ME, { sittingOn: o.id, x: s.x, y: s.y, facing: s.facing });
      occRef.current.set(ME, { ...me(), sittingOn: o.id, x: s.x, y: s.y, facing: s.facing });
      onNote(`Sitting on cushion ${s.index + 1} of ${seatSpots(o, scene).length}, facing ${s.facing}.`);
    }, true);
  }

  function operate(o: SceneObject) {
    const kinds = new Set((o.actions ?? []).map((a) => a.kind));
    if (kinds.has('sit')) return sitOn(o);
    const view = viewRef.current!;
    const from = view.actorTile(ME);
    const way = from ? approach(grid(), from, o) : null;
    if (!way) return onNote('It can’t be reached from any side: check its footprint and the room.');
    walkTo(way.tile, () => {
      view.faceObject(ME, o);
      for (const a of o.actions ?? []) {
        if (a.kind === 'toggle') {
          view.setObjState(o.id, !view.isOn(o.id));
          onNote(`Switched ${view.isOn(o.id) ? 'on' : 'off'}.`);
        } else if (a.kind === 'vend') {
          view.patch(ME, { carrying: a.item });
          onNote(`Got a ${a.item}.`);
        } else if (a.kind === 'ring') view.playObject(o.id, 'ring');
        else if (a.kind === 'info') onNote(`${a.title}: ${a.body}`);
        else if (a.kind === 'use') view.playObject(o.id, a.use as never, ME);
      }
      if (!o.actions?.length) onNote('Used from its front tile: this piece has no action yet.');
    });
  }

  function fillSeats() {
    const scene = sceneRef.current!;
    const view = viewRef.current!;
    let k = 0;
    for (const o of scene.objects)
      for (const s of seatSpots(o, scene)) {
        const m = seed.members[(k++ * 3 + 7) % seed.members.length];
        const occ: Occupant = { memberId: m.id, x: s.x, y: s.y, facing: s.facing, sittingOn: o.id, status: 'available', avatar: m.avatar, via: 'sim' };
        occRef.current.set(m.id, occ);
        view.upsert(occ);
      }
    onNote(k ? `Someone on every cushion (${k}).` : 'This piece has no seats.');
  }

  function addPeople() {
    const g = grid();
    const view = viewRef.current!;
    let added = 0;
    for (let i = 0; i < 40 && added < 4; i++) {
      const x = (i * 7 + 3) % 10;
      const y = (i * 3 + 1) % 10;
      if (!g.walkable(x, y) || [...occRef.current.values()].some((p) => p.x === x && p.y === y)) continue;
      const m = seed.members[(occRef.current.size * 5 + i) % seed.members.length];
      if (occRef.current.has(m.id)) continue;
      const occ: Occupant = { memberId: m.id, x, y, facing: (['se', 'sw', 'ne', 'nw'] as const)[i % 4], status: 'available', avatar: m.avatar, via: 'sim' };
      occRef.current.set(m.id, occ);
      view.upsert(occ);
      added++;
    }
  }

  function clearPeople() {
    const view = viewRef.current!;
    for (const id of [...occRef.current.keys()]) if (id !== ME) {
      view.remove(id);
      occRef.current.delete(id);
    }
  }

  return (
    <section className="lab-card sandbox">
      <header className="card-head">
        <h3>Try it in game</h3>
        <span className="muted">Click the floor to walk · click the piece to use or sit · R turns it</span>
        {draft.furniture?.category === 'seating' && !draft.furniture.seatModel && (
          <span className="chip bad" title="without a model the game can't draw people in this seat properly">
            no seat model yet: Auto-fit it in How people sit in it
          </span>
        )}
      </header>
      <div className="sandbox-stage">
        <canvas ref={holder} className="sandbox-canvas" />
        {!ready && <div className="sandbox-loading">Loading the room…</div>}
      </div>
      <div className="sandbox-bar">
        <div className="seg" role="group" aria-label="Facing">
          {(['se', 'sw', 'ne', 'nw'] as Facing[]).map((f) => (
            <button key={f} className={facing === f ? 'on' : ''} onClick={() => setFacing(f)}>
              {f}
            </button>
          ))}
        </div>
        <button className="btn ghost" onClick={() => setFacing((f) => TURN[f])} title="Turn it (R)">
          ↻ Turn
        </button>
        <div className="seg" role="group" aria-label="Zoom">
          {[1, 2, 3, 4].map((z) => (
            <button key={z} className={zoom === z ? 'on' : ''} onClick={() => setZoom(z)}>
              {z}×
            </button>
          ))}
        </div>
        <button className="btn ghost" onClick={() => setNight((n) => !n)}>
          {night ? '☀ Day' : '☾ Night'}
        </button>
        <span className="spacer" />
        <button className="btn ghost" onClick={fillSeats}>
          Fill seats
        </button>
        <button className="btn ghost" onClick={addPeople}>
          + People
        </button>
        <button className="btn ghost" onClick={clearPeople}>
          Clear
        </button>
      </div>
    </section>
  );
}
