/** Unapproved source-pixel evidence from the actual WorldView, including every overlapping pixel. */
import { seatShots, type SeatShotOpts } from './seatShots';
import { seatDepth } from '../engine/sprites/seatModel';
import { sitterMask } from '../engine/sprites/seatLayers';
import { avatarSprite } from '../engine/sprites/avatar';
import { renderAvatarLayers } from '../engine/sprites/avatarQa';
import { FIG, poseDrop } from '@shared/world/seatFigure';
import { seatSpots } from '@shared/world/seats';
import { verifySeatCanvas, type CanvasLayer } from './seatCanvasCheck';
import { setSkyOverride } from '../engine/weather';

export async function seatEvidence(o: SeatShotOpts) {
  const records: unknown[] = [];
  // Source RGBA is comparable only under neutral light. This is an isolated lab capture,
  // with the real final draw path retained; no draw routine is replaced or bypassed.
  setSkyOverride({phase:'day',weather:'clear',sun:1,lamp:0});
  // The game accessibility setting freezes glints/blinks without replacing draw routines.
  // Moving lighting and effects remain a separate audit; source-RGBA checks are static.
  try { await seatShots({...o, reducedMotion:true}, (view, id) => {
    // This dev-only inspector intentionally reads the same private state as WorldView's draw pass.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = view as any;
    const st = w.statics.find((s: {obj: {id: string}}) => s.obj.id === id);
    const screenScale=w.camera.zoom*w.dpr;
    const screenX=Math.round(w.dpr*(w.vw/2-w.camera.x*w.camera.zoom));
    const screenY=Math.round(w.dpr*(w.vh/2-w.camera.y*w.camera.zoom));
    const occupants: Array<{depth:number;layer:CanvasLayer}> = [];
    const frameRecords: Array<Record<string,unknown>>=[];
    let furniture: CanvasLayer | undefined;
    for (const a of w.actors.values()) {
      if (a.onSeat?.id !== id) continue;
      const mv = w.modelOf(st.obj, a.onSeat.facing);
      if (!mv) throw new Error(`Missing compiled model: ${id}`);
      const pose = w.pose(a), facing = w.viewFacing(a), look = w.look(a), legs = w.legsOf(a);
      const feet: [number, number] = [((a.at?.x ?? a.sx)-st.dx)*2, ((a.at?.y ?? a.sy)-st.dy)*2];
      const height = (a.lift ?? 0)-(st.obj.z ?? 0)+(FIG.feet-FIG.hip-poseDrop(pose))/2;
      const mask = sitterMask(mv,look,facing,pose,feet,legs,height);
      const sprite = avatarSprite(look,facing,pose,undefined,legs), actual = w.figureOf(a);
      const rgba = (s: typeof sprite) => Array.from(s.canvas.getContext('2d')!.getImageData(0,0,s.canvas.width,s.canvas.height).data);
      const original = rgba(sprite), pixels = rgba(actual);
      furniture ??= {width:mv.art.px.w,height:mv.art.px.h,rgba:mv.art.px.d,
        x:screenX+st.dx*screenScale,y:screenY+st.dy*screenScale,pixelScale:screenScale/(st.sprite.scale??1)};
      const density=sprite.scale??1;
      const occupant={depth:a.occ.x+a.occ.y,layer:{width:sprite.canvas.width,height:sprite.canvas.height,
        rgba:original,mask,x:screenX+((a.at?.x??Math.round(a.sx))-sprite.ax/density)*screenScale,
        y:screenY+((a.at?.y??Math.round(a.sy))-sprite.ay/density)*screenScale,pixelScale:screenScale/density}};
      occupants.push(occupant);
      for (let i=0;i<mask.length;i++) if (pixels[i*4+3] !== (mask[i] ? 0 : original[i*4+3]))
        throw new Error(`Actual game sprite differs from inspected mask: ${id}, pixel ${i}`);
      const depth = seatDepth(mv), figure = renderAvatarLayers(look,facing,pose,legs);
      const cushion = seatSpots(st.obj, w.scene).find(s => s.x === a.occ.x && s.y === a.occ.y)?.index;
      if (cushion === undefined) throw new Error(`Cannot identify cushion: ${id}`);
      frameRecords.push({id, object:st.obj, facing, pose, look, legs, feet, height, cushion,
        canvasPlacement:{art:{x:furniture.x,y:furniture.y,pixelScale:furniture.pixelScale},
          figure:{x:occupant.layer.x,y:occupant.layer.y,pixelScale:occupant.layer.pixelScale},order:occupant.depth},
        canvasSize:{width:w.ctx.canvas.width,height:w.ctx.canvas.height},
        model:mv.model, art:{w:mv.art.px.w,h:mv.art.px.h,ax:mv.art.ax,ay:mv.art.ay,rgba:Array.from(mv.art.px.d)},
        figure:{w:sprite.canvas.width,h:sprite.canvas.height,ax:sprite.ax,ay:sprite.ay,
          rgba:original,actual:pixels,owner:Array.from(figure.owner),mask:Array.from(mask)},
        depth:{part:Array.from(depth.part),face:Array.from(depth.face),z:Array.from(depth.z),how:Array.from(depth.how)},
        screenshot:w.ctx.canvas.toDataURL('image/png'),lighting:'neutral-daylight',reducedMotion:true,
        captureScope:'Static source-pixel composition through real WorldView; dynamic lighting, glints and expressions excluded.',
        visualStatus:'UNREVIEWED'});
    }
    if (furniture && frameRecords.length) {
      // Do not consult WorldView.buildDrawOrder: independent ordering is the assertion here.
      const check=verifySeatCanvas(w.ctx.canvas,[furniture,...occupants.sort((a,b)=>a.depth-b.depth).map(a=>a.layer)]);
      frameRecords[0].finalCanvas=check;
      for (const record of frameRecords.slice(1)) record.finalCanvasReference=id;
      records.push(...frameRecords);
    }
  }); } finally { setSkyOverride(null); }
  return records;
}
