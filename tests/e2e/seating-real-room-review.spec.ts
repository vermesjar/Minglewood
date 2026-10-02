/** Observe real room draw calls without changing models, ordering, pixels, lighting, or overlays. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { rendererSources } from '../../scripts/lib/seat-source-receipt';
import { test, expect, type Player } from './helpers';
import { readPng, writePng } from '../../scripts/lib/png';
import { scaled } from '../../scripts/lib/draw';
const root=process.cwd().replace(/\\/g,'/');
const out=process.env.REAL_SEAT_REVIEW_OUT??'art/review/real-room-events-red';mkdirSync(out,{recursive:true});

async function startRoomFilm(player:Player,seatId:string){
 await player.ev(async({seatId,root})=>{
  const {avatarSprite}=await import(`/@fs/${root}/src/client/engine/sprites/avatar.ts`);
  const {renderAvatarLayers}=await import(`/@fs/${root}/src/client/engine/sprites/avatarQa.ts`);
  const g=(window as any).__mw,w=g.world,st=w.statics.find((s:any)=>s.obj.id===seatId);
  const film=(window as any).__realSeatFilm={on:true,phase:'approach',frames:[],last:'',count:0,
    originals:{draw:w.draw,drawActor:w.drawActor,figureOf:w.figureOf,pose:w.pose,legsOf:w.legsOf,buildDrawOrder:w.buildDrawOrder},
    observing:null,inActor:false,drawn:null,order:[],object:st.obj,roomId:w.scene.id,
    sourceArt:st.sprite.canvas.toDataURL('image/png'),model:w.modelOf(st.obj,st.obj.facing)?.model};
  w.buildDrawOrder=function(...args:any[]){const order=film.originals.buildDrawOrder.apply(w,args);
    film.order=order.map((d:any,i:number)=>d.obj?{index:i,kind:'object',id:d.obj.id,sprite:d.obj.sprite,variant:d.obj.variant,box:d.box,rect:d.rect,dx:d.dx,dy:d.dy}:
      {index:i,kind:'actor',id:d.occ.memberId,seat:d.onSeat,serverSeat:d.occ.sittingOn,rect:d.rect,at:d.at});return order;};
  w.pose=function(...args:any[]){const value=film.originals.pose.apply(w,args);if(film.observing)film.observing.poses.push(value);return value;};
  w.legsOf=function(...args:any[]){const value=film.originals.legsOf.apply(w,args);if(film.observing){film.observing.legs=value;film.observing.legPoseCount=film.observing.poses.length;}return value;};
  w.figureOf=function(...args:any[]){if(!film.inActor)return film.originals.figureOf.apply(w,args);
    const observe={poses:[],legs:undefined,legPoseCount:0,expr:args[1]};film.observing=observe;
    try{const sprite=film.originals.figureOf.apply(w,args);film.drawn={...observe,sprite};return sprite;}finally{film.observing=null;}};
  w.drawActor=function(...args:any[]){film.inActor=args[0].occ.memberId===g.meId;try{return film.originals.drawActor.apply(w,args);}finally{film.inActor=false;}};
  w.draw=function(...args:any[]){film.drawn=null;const result=film.originals.draw.apply(w,args);
   if(!film.on||!film.drawn)return result;film.count++;
   const a=w.actors.get(g.meId),drawn=film.drawn,pose=drawn.poses[drawn.legPoseCount]??drawn.poses[0],facing=w.viewFacing(a),look=w.look(a),legs=drawn.legs;
   const sprite=drawn.sprite,actual=Array.from(sprite.canvas.getContext('2d').getImageData(0,0,sprite.canvas.width,sprite.canvas.height).data);
   let hash=2166136261;for(const b of actual as number[]){hash^=b;hash=Math.imul(hash,16777619)>>>0;}
   const signature=JSON.stringify([film.phase,pose,a.at,a.onSeat,a.occ.sittingOn,hash,w.camera.zoom]);
   if(signature===film.last||film.frames.length>=180)return result;film.last=signature;
   const original=avatarSprite(look,facing,pose,drawn.expr,legs),layers=renderAvatarLayers(look,facing,pose,legs);
   const rgba=Array.from(original.canvas.getContext('2d').getImageData(0,0,original.canvas.width,original.canvas.height).data);
   const scale=w.camera.zoom*w.dpr,tx=Math.round(w.dpr*(w.vw/2-w.camera.x*w.camera.zoom)),ty=Math.round(w.dpr*(w.vh/2-w.camera.y*w.camera.zoom));
   const size=Math.min(360,w.canvas.width,w.canvas.height),x=Math.max(0,Math.min(w.canvas.width-size,Math.round(tx+(a.at?.x??a.sx)*scale-size/2))),
     y=Math.max(0,Math.min(w.canvas.height-size,Math.round(ty+((a.at?.y??a.sy)-18)*scale-size/2)));
   const crop=document.createElement('canvas');crop.width=size;crop.height=size;crop.getContext('2d')!.drawImage(w.canvas,x,y,size,size,0,0,size,size);
   const neighbors=film.order.filter((o:any)=>o.kind==='object'&&o.id!==seatId&&o.rect&&o.rect.l<a.rect.r&&o.rect.r>a.rect.l&&o.rect.t<a.rect.b&&o.rect.b>a.rect.t);
   film.frames.push({phase:film.phase,frame:film.count,time:performance.now(),pose,facing,look,legs,expression:drawn.expr,
     poseCalls:drawn.poses,poseRace:new Set(drawn.poses).size>1,moving:a.moving,at:a.at,lift:a.lift,seat:a.onSeat,serverSeat:a.occ.sittingOn,
     actorId:g.meId,objectId:seatId,ownSeatIndex:film.order.findIndex((o:any)=>o.id===seatId),actorIndex:film.order.findIndex((o:any)=>o.id===g.meId),
     proxyDepth:w.proxyDepth,neighborObjects:neighbors,drawOrder:film.order,
     feet:[((a.at?.x??a.sx)-st.dx)*2,((a.at?.y??a.sy)-st.dy)*2],
     canvasPlacement:{art:{x:tx+st.dx*scale,y:ty+st.dy*scale,pixelScale:scale/(st.sprite.scale??1)},
       figure:{x:tx+((a.at?.x??a.sx)-sprite.ax/(sprite.scale??1))*scale,y:ty+((a.at?.y??a.sy)-sprite.ay/(sprite.scale??1))*scale,pixelScale:scale/(sprite.scale??1)}},
     camera:{x:w.camera.x,y:w.camera.y,zoom:w.camera.zoom},canvasSize:{width:w.canvas.width,height:w.canvas.height},crop:{x,y,width:size,height:size},png:crop.toDataURL('image/png'),
     figure:{w:original.canvas.width,h:original.canvas.height,ax:original.ax,ay:original.ay,rgba,actual,owner:Array.from(layers.owner)}});
   return result;
  };
 },{seatId,root});
}
async function stopRoomFilm(player:Player){return player.ev(()=>{const w=(window as any).__mw.world,f=(window as any).__realSeatFilm;f.on=false;
 for(const [key,value] of Object.entries(f.originals))w[key]=value;
 return {scope:'Actual live room, unchanged art/models, real clicks and original completed WorldView draws; screenshots include lighting and neighboring objects.',
 object:f.object,model:f.model,sourceArt:f.sourceArt,roomId:f.roomId,renderedFrames:f.count,frames:f.frames};});}

test('real room seats preserve seating and neighboring draw evidence',async({player})=>{
 test.setTimeout(240_000);
 const captureFile='tests/e2e/seating-real-room-review.spec.ts';
 const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
 const sourcesBefore={...rendererSources(),[captureFile]:sha(readFileSync(captureFile))};
 const renderingErrors:string[]=[];
 player.page.on('pageerror',error=>renderingErrors.push(String(error)));
 player.page.on('console',message=>{if(message.text().includes('[world] frame failed'))renderingErrors.push(message.text());});
 if(process.env.SEAT_CANDIDATE_MODELS)expect(process.env.REAL_SEAT_ALLOW_CANDIDATE,'Candidate models must be explicitly authorized for this comparison').toBe('1');
 writeFileSync(`${out}/scope.json`,JSON.stringify({url:process.env.PLAYTEST_URL,candidateModels:process.env.SEAT_CANDIDATE_MODELS??null,worldLayout:'actual room, unchanged',interactions:'real clicks'}));
 const room=process.env.REAL_SEAT_ROOM??'events',key=process.env.REAL_SEAT_KEY??'chair.red';
 const scene=await player.roomScene(room);expect(scene.id).toBe(room);
 const red=scene.objects.filter(o=>`${o.sprite}${o.variant?'.'+o.variant:''}`===key);expect(red.length).toBeGreaterThan(0);
 writeFileSync(`${out}/scene.json`,JSON.stringify(scene,null,2));
 const targets=process.env.REAL_SEAT_KEY?red:[red.find(o=>o.x===3&&o.y===6),red.find(o=>o.x===4&&o.y===6),red.find(o=>o.x===6&&o.y===8)].filter(Boolean)!;
 for(const target of targets){const object=target!;await player.reset();await player.settle();
  const point=await player.objectPoint(object.id,{x:object.x,y:object.y,z:9});expect(point,object.id).toBeTruthy();
  await startRoomFilm(player,object.id);
  try{
   await player.click(point!);const sit=await player.until(m=>m.sittingOn===object.id,20_000);expect(sit.ok,JSON.stringify(sit)).toBe(true);await player.settle();
   await player.ev(()=>{(window as any).__realSeatFilm.phase='settled-play';});await player.page.waitForTimeout(350);
   const play=await player.shot(`red-room-${object.id}-play`,undefined,360);writeFileSync(`${out}/${object.id}-play.png`,await (await import('node:fs/promises')).readFile(play));
   // A nearest-neighbor 4x inspection preserves the actual play-scale final pixels.
   writePng(`${out}/${object.id}-play-4x.png`,scaled(readPng(`${out}/${object.id}-play.png`),4));
   await player.ev(()=>{(window as any).__realSeatFilm.phase='stand-exit';});await player.reset();await player.still();await player.page.waitForTimeout(300);
  }finally{
   const film=await stopRoomFilm(player) as any;film.candidateModels=process.env.SEAT_CANDIDATE_MODELS??null;
   if(film.candidateModels)film.scope='Actual live room/layout/art and real clicks, with explicitly authorized browser-only candidate models; original completed WorldView draws.';
   const folder=`${out}/${object.id}`;mkdirSync(folder,{recursive:true});
   for(let i=0;i<film.frames.length;i++){const f=film.frames[i];writeFileSync(`${folder}/${String(i).padStart(3,'0')}.png`,Buffer.from(f.png.split(',')[1],'base64'));delete f.png;}
   const evidence=JSON.stringify(film);writeFileSync(`${folder}/evidence.json`,evidence);
   const sourcesAfter={...rendererSources(),[captureFile]:sha(readFileSync(captureFile))};
   const sourceStable=JSON.stringify(sourcesBefore)===JSON.stringify(sourcesAfter);
   writeFileSync(`${folder}/capture-receipt.json`,JSON.stringify({version:1,
    scope:'Ordinary-room integration recording; hashes and original draw observations, not publication approval or independent pixel expectations.',
    evidenceSha256:sha(evidence),sourcesBefore,sourcesAfter,sourceStable,
    modelSha256:sha(JSON.stringify(film.model)),sourceArtSha256:sha(film.sourceArt),
    renderingErrors,frames:film.frames.length,poseRaces:film.frames.filter((f:any)=>f.poseRace).length,
    screenshots:film.frames.map((_:any,i:number)=>({path:`${String(i).padStart(3,'0')}.png`,sha256:sha(readFileSync(`${folder}/${String(i).padStart(3,'0')}.png`))}))},null,2));
   const phases=[...new Set(film.frames.map((f:any)=>f.phase))];console.log({object:object.id,frames:film.frames.length,phases,
     settled:film.frames.filter((f:any)=>f.phase==='settled-play').map((f:any)=>({pose:f.pose,at:f.at,proxy:f.proxyDepth,order:[f.ownSeatIndex,f.actorIndex],neighbors:f.neighborObjects.map((o:any)=>o.id)}))});
   expect(film.frames.some((f:any)=>f.phase==='settled-play'&&f.serverSeat===object.id)).toBe(true);
   expect(sourceStable,'Renderer or recorder changed during ordinary-room capture').toBe(true);
   expect(renderingErrors,'Rendering errors during ordinary-room capture').toEqual([]);
   expect(film.frames.filter((f:any)=>f.poseRace),'A frame used inconsistent avatar poses').toEqual([]);
  }
 }
});
