/**
 * Capture real seat interactions: all four review looks, cushion changes, entry and exit.
 * Each run writes art/review/models-live/<run>/<key>-<facing>.png and a film.json
 * containing every changed render state observed inside the actual WorldView draw.
 * Raw seated screenshots live under <run>/raw. Renderer/model/art fingerprints bind
 * the evidence to the captured implementation; these captures alone are not approval.
 *
 * PLAYTEST_URL=http://localhost:5195 PLAYTEST_TAG=models-<label>
 * SEAT_MODEL_RUN=<unique-label> SEAT_MODEL_KEYS=chair.cafe,stool
 * npx playwright test seat-models --workers 2
 *
 * SEAT_MODEL_KEYS defaults to the complete catalog; SEAT_MODEL_FACINGS defaults to
 * se,sw,ne,nw. SEAT_CANDIDATE_MODELS injects an isolated candidate through helpers.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { rendererSources } from '../../scripts/lib/seat-source-receipt';
import { motionCandidate, motionRoom } from '../../scripts/lib/seat-motion-candidate';
import { test, type Player } from './helpers';
import { SEAT_LOOKS } from '../../src/shared/world/seatModels';
import { normalizeLoadout } from '../../src/shared/avatar';
import type { AvatarLoadout } from '../../src/shared/domain/types';
import { blank, writePng, type Img } from '../../scripts/lib/png';
import { text } from '../../scripts/lib/font';
import { paste, row, stack } from '../../scripts/lib/draw';

const RUN = process.env.SEAT_MODEL_RUN ?? new Date().toISOString().replace(/[:.]/g, '-');
if (!/^[a-zA-Z0-9_-]+$/.test(RUN)) throw new Error('SEAT_MODEL_RUN must be a simple run label');
const LIVE = `art/review/models-live/${RUN}`;
const RAW = `${LIVE}/raw`;
mkdirSync(RAW, { recursive: true });

const KEYS = (process.env.SEAT_MODEL_KEYS ?? Object.keys(JSON.parse(readFileSync('art/seat-models.json', 'utf8')) as Record<string, unknown>).join(','))
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);
const FACINGS = (process.env.SEAT_MODEL_FACINGS ?? 'se,sw,ne,nw').split(',');
const REVIEW_LOOKS: AvatarLoadout[] = [...SEAT_LOOKS, JSON.parse(readFileSync('tests/fixtures/seating-cardigan.json', 'utf8'))]
  .map(look => ({ ...look, pet: 'pet.none' }));
const FILM_LOOKS = new Set((process.env.SEAT_MODEL_FILM_LOOKS ?? '0,1,2,3').split(',').map(Number));
if ([...FILM_LOOKS].some(k => !Number.isInteger(k) || k < 0 || k >= REVIEW_LOOKS.length)) throw new Error('Invalid SEAT_MODEL_FILM_LOOKS');
const FRONT: Record<string, [number, number]> = { se: [1, 0], sw: [0, 1], ne: [0, -1], nw: [-1, 0] };

test.describe.configure({ mode: 'parallel' });

interface Grab {
  w: number;
  h: number;
  /** RGBA, base64 */
  data: string;
  /** Where the seat drawing's (0, 0) is in the grab, in its px. */
  origin: [number, number];
}

const toImg = (g: Grab): Img => ({ w: g.w, h: g.h, d: new Uint8Array(Buffer.from(g.data, 'base64')) });

/**
 * The live canvas around a seat at a zoom (2: one drawing px per canvas px; 4: two), on the drawing's own pixel grid,
 * with nothing but the world in it: no hover highlight, no name labels, no blink. `region`: drawing px [l, t, r, b]
 * relative to the drawing's (0, 0); by default the seat and whoever is in it.
 */
async function grab(p: Player, seatId: string, zoom: number, region?: [number, number, number, number]): Promise<Grab> {
  return p.ev(
    async ([seatId, zoom, region]) => {
      const g = (window as any).__mw;
      const w = g.world as any;
      const st = w.statics.find((s: any) => s.obj.id === seatId);
      const me = w.actors.get(g.meId);
      w.hover = null;
      w.hoverTile = null;
      const overlays = w.drawActorOverlays;
      w.drawActorOverlays = () => undefined;
      const rm = w.reducedMotion;
      w.reducedMotion = true;
      w.camera.maxZoom = Math.max(w.camera.maxZoom, zoom);
      const sw = st.sprite.canvas.width;
      const sh = st.sprite.canvas.height;
      w.camera.jump(st.dx + sw / 4, st.dy + sh / 4 - 16, zoom);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      const dpr = window.devicePixelRatio || 1;
      const z = w.camera.zoom;
      const s = z * dpr;
      const tx = Math.round(dpr * (w.vw / 2 - w.camera.x * z));
      const ty = Math.round(dpr * (w.vh / 2 - w.camera.y * z));
      const k = s / 2;
      const X0 = Math.round(st.dx * s + tx);
      const Y0 = Math.round(st.dy * s + ty);
      let box = region;
      if (!box) {
        // the seat, and the person in it (their figure is 88 × 112 drawing px, feet at its (45, 104))
        const fx = Math.round(((me.at?.x ?? me.sx) - st.dx) * 2);
        const fy = Math.round(((me.at?.y ?? me.sy) - st.dy) * 2);
        box = [Math.min(0, fx - 44) - 6, Math.min(0, fy - 90) - 6, Math.max(sw, fx + 44) + 6, Math.max(sh, fy + 4) + 6];
      }
      const [l, t, r, b] = box;
      const W = Math.round((r - l) * k);
      const H = Math.round((b - t) * k);
      const img = w.ctx.getImageData(X0 + Math.round(l * k), Y0 + Math.round(t * k), W, H);
      w.drawActorOverlays = overlays;
      w.reducedMotion = rm;
      let bin = '';
      const d = img.data as Uint8ClampedArray;
      for (let i = 0; i < d.length; i += 0x8000) bin += String.fromCharCode(...d.subarray(i, i + 0x8000));
      return { w: W, h: H, data: btoa(bin), origin: [Math.round(-l * k), Math.round(-t * k)] as [number, number] };
    },
    [seatId, zoom, region ?? null] as const,
  );
}

/**
 * Put a look on the bot (the wardrobe's own message, a full loadout) and wait for the room to see it. Returns the
 * look as the server kept it (it swaps out anything the bot hasn't unlocked): the probe composes exactly that.
 */
async function wear(p: Player, k: number): Promise<Record<string, unknown>> {
  const look = normalizeLoadout(REVIEW_LOOKS[k]) as unknown as Record<string, string>;
  await p.ev((l) => (window as any).__mw.rt?.send({ t: 'avatar', loadout: l }), look);
  await p.page.waitForFunction(
    (l: Record<string, string>) => {
      const g = (window as any).__mw;
      const a = (g.world as any).actors.get(g.meId);
      return !!a && a.occ.avatar?.hairColor === l.hairColor && a.occ.avatar?.topColor === l.topColor && a.occ.avatar?.bottomColor === l.bottomColor;
    },
    look,
    { timeout: 10_000 },
  );
  return p.ev(() => {
    const g = (window as any).__mw;
    return JSON.parse(JSON.stringify((g.world as any).actors.get(g.meId).occ.avatar)) as Record<string, unknown>;
  });
}

/** Page retries reset module state. Restore neutral lighting on the current page. */
async function neutralSky(p: Player) {
  await p.ev(async () => {
    const m = await import(/* @vite-ignore */ '/engine/weather.ts' as string);
    const expected = { phase: 'day', weather: 'clear', sun: 0, lamp: 0 };
    m.setSkyOverride(expected);
    const actual = m.skyAt();
    if (Object.entries(expected).some(([key,value]) => actual[key] !== value))
      throw new Error('Motion review neutral lighting was not restored');
  });
}

/** Film the canvas around a seat at play scale, a frame whenever the person on it moves or changes pose. */
async function startFilm(p: Player, seatId: string) {
  await neutralSky(p);
  await p.ev(async ({seatId,root}) => {
    const {avatarSprite}=await import(`/@fs/${root}/src/client/engine/sprites/avatar.ts`);
    const {renderAvatarLayers}=await import(`/@fs/${root}/src/client/engine/sprites/avatarQa.ts`);
    const g = (window as any).__mw;
    const w = g.world as any;
    const st = w.statics.find((s: any) => s.obj.id === seatId);
    const film = ((window as any).__modelFilm = { on: true, frames: [] as any[], last: '', phase:'entry',
      renderedFrames:0, skippedOtherZoom:0, overlays: w.drawActorOverlays, draw:w.draw,
      drawActor:w.drawActor,figureOf:w.figureOf,pose:w.pose,legsOf:w.legsOf,
      inActorDraw:false,observing:null as any,drawnFigure:null as any,
      model:JSON.parse(JSON.stringify(w.modelOf(st.obj,st.obj.facing).model)),
      object:st.obj,art:{width:st.sprite.canvas.width,height:st.sprite.canvas.height,png:st.sprite.canvas.toDataURL('image/png')} });
    // no name labels in the film
    w.drawActorOverlays = () => undefined;
    const sw = st.sprite.canvas.width;
    const sh = st.sprite.canvas.height;
    const tick = () => {
      if (!film.on) return;
      film.renderedFrames++;
      const a = w.actors.get(g.meId);
      if(!a)return;
      // Static 4x screenshots are a different capture stream. All motion is
      // recorded after an actual draw at play scale, including the final exit.
      if(Math.abs(w.camera.zoom-2)>1e-8){film.skippedOtherZoom++;return;}
      const drawn=film.drawnFigure;
      if(!drawn)return;
      const actual=drawn.sprite,pose=drawn.poses[drawn.legPoseCount]??drawn.poses[0],facing=w.viewFacing(a),look=w.look(a),legs=drawn.legs;
      const bytes=actual.canvas.getContext('2d').getImageData(0,0,actual.canvas.width,actual.canvas.height).data;
      let hash=2166136261;for(const b of bytes){hash^=b;hash=Math.imul(hash,16777619)>>>0;}
      const on = !!a && (a.onSeat?.id === seatId || a.seat?.objId === seatId);
      const state={phase:film.phase,pose,facing,look,legs,onSeat:on,seat:a.onSeat??null,serverSeat:a.occ.sittingOn??null,
        at:a.at??null,sx:a.sx,sy:a.sy,lift:a.lift??0,world:[a.occ.x,a.occ.y],
        camera:{x:w.camera.x,y:w.camera.y,zoom:w.camera.zoom},figureHash:hash,
        poseCalls:drawn.poses,poseRace:new Set(drawn.poses).size>1,expression:drawn.expr};
      const sig=JSON.stringify(state);
      if (sig !== film.last) {
        w.hover = null;
        film.last = sig;
        const dpr = window.devicePixelRatio || 1;
        const z = w.camera.zoom;
        const s = z * dpr;
        const tx = Math.round(dpr * (w.vw / 2 - w.camera.x * z));
        const ty = Math.round(dpr * (w.vh / 2 - w.camera.y * z));
        const k = s / 2;
        const artX = st.dx * s + tx, artY = st.dy * s + ty;
        const figureScale = s / (actual.scale ?? 1);
        const figureX = (a.at?.x ?? Math.round(a.sx)) * s + tx - actual.ax * figureScale;
        const figureY = (a.at?.y ?? Math.round(a.sy)) * s + ty - actual.ay * figureScale;
        const left = Math.floor(Math.min(artX, figureX) - 6 * k);
        const top = Math.floor(Math.min(artY, figureY) - 6 * k);
        const right = Math.ceil(Math.max(artX + sw*k, figureX + actual.canvas.width*figureScale) + 6*k);
        const bottom = Math.ceil(Math.max(artY + sh*k, figureY + actual.canvas.height*figureScale) + 6*k);
        const c = document.createElement('canvas');
        c.width = right - left;
        c.height = bottom - top;
        if(left < 0 || top < 0 || right > w.canvas.width || bottom > w.canvas.height) throw new Error('Motion capture source is clipped outside the actual viewport');
        c.getContext('2d')!.drawImage(w.canvas, left, top, c.width, c.height, 0, 0, c.width, c.height);
        const original=avatarSprite(look,facing,pose,drawn.expr,legs),figure=renderAvatarLayers(look,facing,pose,legs);
        const rgba=Array.from(original.canvas.getContext('2d').getImageData(0,0,original.canvas.width,original.canvas.height).data);
        film.frames.push({png:c.toDataURL('image/png'),state,renderedFrame:film.renderedFrames,time:performance.now(),
          figure:{width:original.canvas.width,height:original.canvas.height,ax:original.ax,ay:original.ay,
            rgba,actual:Array.from(bytes),owner:Array.from(figure.owner)},
          crop:{x:left,y:top,width:c.width,height:c.height},
          placement:{art:{x:artX,y:artY,pixelScale:k},figure:{x:figureX,y:figureY,pixelScale:figureScale}},
          canvasSize:{width:w.canvas.width,height:w.canvas.height}});
      }
    };
    // Observe the completed game draw. No draw ordering, mask, or pose logic is replaced.
    w.pose=function(...args:any[]){const value=film.pose.apply(w,args);if(film.observing)film.observing.poses.push(value);return value;};
    w.legsOf=function(...args:any[]){const value=film.legsOf.apply(w,args);if(film.observing){film.observing.legs=value;film.observing.legPoseCount=film.observing.poses.length;}return value;};
    w.figureOf=function(...args:any[]){
      if(!film.inActorDraw)return film.figureOf.apply(w,args);
      const observed={poses:[] as string[],legPoseCount:0,legs:undefined,expr:args[1]};film.observing=observed;
      try{const sprite=film.figureOf.apply(w,args);film.drawnFigure={...observed,sprite};return sprite;}finally{film.observing=null;}
    };
    w.drawActor=function(...args:any[]){film.inActorDraw=args[0].occ.memberId===g.meId;try{return film.drawActor.apply(w,args);}finally{film.inActorDraw=false;}};
    w.draw=function(...args:any[]){film.drawnFigure=null;film.draw.apply(w,args);tick();};
  }, {seatId,root:process.cwd().replace(/\\/g,'/')});
  await p.page.waitForFunction(()=>((window as any).__modelFilm?.frames.length??0)>0);
}

async function stopFilm(p: Player): Promise<any> {
  return p.ev(() => {
    const f = (window as any).__modelFilm;
    if (!f) return [];
    f.on = false;
    const w=(window as any).__mw.world as any;
    w.drawActorOverlays = f.overlays;w.draw=f.draw;w.drawActor=f.drawActor;w.figureOf=f.figureOf;w.pose=f.pose;w.legsOf=f.legsOf;
    return {frames:f.frames,renderedFrames:f.renderedFrames,skippedOtherZoom:f.skippedOtherZoom,model:f.model,object:f.object,art:f.art};
  });
}

/** A PNG data URL as pixels (decoded in the page, where there's a PNG decoder). */
async function decode(p: Player, url: string): Promise<Img> {
  const g = await p.ev(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const x = c.getContext('2d')!;
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let bin = '';
    for (let i = 0; i < d.length; i += 0x8000) bin += String.fromCharCode(...d.subarray(i, i + 0x8000));
    return { w: c.width, h: c.height, data: btoa(bin), origin: [0, 0] as [number, number] };
  }, url);
  return toImg(g);
}

function label(s: string, img: Img): Img {
  const out = blank(Math.max(img.w, s.length * 8 + 4), img.h + 16, [24, 20, 30], 255);
  text(out, 2, 2, s, [200, 190, 210], 2);
  paste(out, img, 0, 16);
  return out;
}

async function sitOn(p: Player, seatId: string, spot: { x: number; y: number }) {
  const at = await p.objectPoint(seatId, { x: spot.x, y: spot.y, z: 10 });
  if (!at) throw new Error(`can't click ${seatId}`);
  const clickAudit = await p.ev(([id, at, spots]) => {
    const g=(window as any).__mw, w=g.world, o=w.statics.find((s:any)=>s.obj.id===id).obj;
    const r=w.canvas.getBoundingClientRect(), sx=at.x-r.left, sy=at.y-r.top;
    const a=w.actors.get(g.meId);
    return {at, target:w.cushionAt(o,spots,sx,sy), near:w.nearFigure(a,sx,sy,2), points:spots.map((s:any)=>{const h=w.hipOf(o,s); const lift=w.modelSit(o,s)?.lift;return {s,h,lift,screen:w.camera.toScreen((h.x-h.y)*16,(h.x+h.y)*8-lift,w.vw,w.vh)};})};
  }, [seatId,at,await p.seatSpots(seatId)] as const);
  await p.click(at);
  // the pointer off it, so it isn't drawn hovered
  await p.page.mouse.move(4, 4);
  const ok = await p.until((m) => m.sittingOn === seatId && m.server?.x === spot.x && m.server?.y === spot.y && !m.moving, 15_000);
  if (!ok.ok) throw new Error(`didn't sit on ${seatId} at ${spot.x},${spot.y}: ${JSON.stringify({clickAudit,me:ok.me})}`);
  // settled into the seat (the sit-down takes 180 ms), the pointer off it
  await p.page.mouse.move(4, 4);
  await p.page.waitForTimeout(700);
}

for (const KEY of KEYS)
  test(`seat model live: ${KEY}`, async ({ player }) => {
    test.setTimeout(900_000);
    const sourcesBefore=rendererSources();
    const captureCode=createHash('sha256').update(readFileSync('tests/e2e/seat-models.spec.ts')).digest('hex');
    const candidate=process.env.SEAT_CANDIDATE_MODELS;
    const candidateSha=candidate?createHash('sha256').update(readFileSync(candidate)).digest('hex'):null;
    const staged = motionCandidate();
    const room = motionRoom(KEY, staged, RUN);
    await player.enter(room);
    for (const facing of FACINGS) {
      const seatId = `${room}-${facing}`;
      const plays: Img[] = [];
      const bigs: Img[] = [];
      let film: Img[] = [];
      await player.step(room, `${KEY} ${facing}`, async () => {
        await neutralSky(player);
        const spots = await player.seatSpots(seatId);
        if (!spots.length) throw new Error(`${seatId}: no cushions`);
        for (let k = 0; k < REVIEW_LOOKS.length; k++) {
          const recordFilm = FILM_LOOKS.has(k);
          await player.reset();
          const worn = await wear(player, k);
          const requested = normalizeLoadout(REVIEW_LOOKS[k]);
          const swapped = Object.entries(requested).filter(([f, v]) => worn[f] !== v).map(([f]) => f);
          if (swapped.length) console.log(`[seat-models] look ${k}: the server swapped ${swapped.join(', ')} (not unlocked for this bot); the probe uses the look as worn`);
          if (swapped.length && process.env.SEAT_MODEL_STRICT_LOOKS === '1') throw new Error(`Requested look ${k} was not worn: ${swapped.join(', ')}`);
          // two steps in front of it, so every sit-down walks up the same way
          const [fx, fy] = FRONT[spots[0].facing];
          await player.page.evaluate((t) => (window as any).__mw.walkTo(t), [spots[0].x + 2 * fx, spots[0].y + 2 * fy] as [number, number]);
          await player.still(15_000);
          await player.ev(
            ([id, z]) => {
              const w = (window as any).__mw.world as any;
              const st = w.statics.find((s: any) => s.obj.id === id);
              w.camera.jump(st.dx + st.sprite.canvas.width / 4, st.dy + st.sprite.canvas.height / 4 - 16, z);
            },
            [seatId, 2] as const,
          );
          if (recordFilm) await startFilm(player, seatId);
          await sitOn(player, seatId, spots[0]);
          const cushions = spots;
          for (let c = 0; c < cushions.length; c++) {
            if (recordFilm) await player.ev(c=>{(window as any).__modelFilm.phase=c?'cushion-shift-'+c:'seated-0';},c);
            if (c > 0) await sitOn(player, seatId, cushions[c]);
            const g2 = await grab(player, seatId, 2);
            const name = `${KEY}-${facing}-L${k}-C${c}`;
            writePng(`${RAW}/${name}.png`, toImg(g2));
            writeFileSync(`${RAW}/${name}.json`, JSON.stringify({ key: KEY, facing, look: k, cushion: c, origin: g2.origin, loadout: worn }));
            plays.push(label(`look ${k}${cushions.length > 1 ? ` cushion ${c}` : ''}`, toImg(g2)));
            bigs.push(toImg(await grab(player, seatId, 4)));
            await player.ev(
              ([id, z]) => {
                const w = (window as any).__mw.world as any;
                const st = w.statics.find((s: any) => s.obj.id === id);
                w.camera.jump(st.dx + st.sprite.canvas.width / 4, st.dy + st.sprite.canvas.height / 4 - 16, z);
              },
              [seatId, 2] as const,
            );
          }
          if(recordFilm)await player.ev(()=>{(window as any).__modelFilm.phase='exit';});
          await player.ev(() => (window as any).__mw.rt?.send({ t: 'stand' }));
          await player.until((m) => !m.sittingOn, 6000);
          await player.page.waitForTimeout(800);
          if (recordFilm) {
            const captured=await stopFilm(player);
            const coverage={entryOutside:captured.frames.some((f:any)=>f.state.phase==='entry'&&!f.state.onSeat),
              entryOnSeat:captured.frames.some((f:any)=>f.state.phase==='entry'&&f.state.onSeat),
              exited:captured.frames.some((f:any)=>f.state.phase==='exit'&&!f.state.onSeat),
              settledCushions:spots.map(s=>captured.frames.some((f:any)=>f.state.pose.startsWith('sit')&&f.state.onSeat&&f.state.world[0]===s.x&&f.state.world[1]===s.y))};
            const candidateUnchanged=JSON.stringify(staged?.receipt??null)===JSON.stringify(motionCandidate()?.receipt??null);
            const unchanged=JSON.stringify(sourcesBefore)===JSON.stringify(rendererSources())&&candidateUnchanged;
            const evidence={version:1,key:KEY,facing,reviewLook:k,requestedLook:requested,wornLook:worn,swappedFields:swapped,run:RUN,captureCodeSha256:captureCode,candidateFile:candidate??null,candidateSha256:candidateSha,
              rendererSources:sourcesBefore,unchanged,candidateReceipt:staged?.receipt??null,candidateUnchanged,coverage,...captured};
            writeFileSync(`${LIVE}/${KEY}-${facing}-L${k}-film.json`,JSON.stringify(evidence));
            if(!unchanged)throw new Error('Renderer changed during live motion capture; this run cannot be approved');
            if(!coverage.entryOutside||!coverage.entryOnSeat||!coverage.exited||coverage.settledCushions.some(v=>!v))
              throw new Error(`Incomplete entry/settled/cushion/exit film: ${JSON.stringify(coverage)}`);
            const lookFilm = await Promise.all(captured.frames.map((f:any) => decode(player, f.png)));
            // Keep the combined overview bounded; the per-look JSON retains every changed state.
            writePng(`${LIVE}/${KEY}-${facing}-L${k}-film.png`, stack(Array.from({length:Math.ceil(lookFilm.length/8)},(_,i)=>row(lookFilm.slice(i*8,i*8+8)))));
            if(k===0) film = lookFilm;
          }
        }
      });
      const sheet = stack([
        label(`${KEY} ${facing}: PLAY SCALE (2X), LIVE`, row(plays)),
        label('4X, LIVE', row(bigs)),
        ...(film.length ? [label('SIT DOWN > SEATED > STAND UP (LIVE, PLAY SCALE)', row(film, [24, 20, 30], 4))] : []),
      ]);
      writePng(`${LIVE}/${KEY}-${facing}.png`, sheet);
      console.log(`[seat-models] ${LIVE}/${KEY}-${facing}.png`);
    }
    await player.ev(async () => {
      const m = await import(/* @vite-ignore */ '/engine/weather.ts' as string);
      m.setSkyOverride(null);
    });
    if (!existsSync(`${LIVE}/${KEY}-se.png`)) throw new Error(`no live shots for ${KEY}`);
  });
