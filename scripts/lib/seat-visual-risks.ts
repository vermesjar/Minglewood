/** Independently reconstruct required visual questions; flags do not decide aesthetics. */
export function visualRisks(original:Set<string>,visible:Set<string>,contact:number[]) {
  const xy=(p:string)=>p.split(',').map(Number),key=(x:number,y:number)=>`${x},${y}`;
  const neighbors=(p:string)=>{const [x,y]=xy(p);return [key(x-1,y),key(x+1,y),key(x,y-1),key(x,y+1)];};
  const groups=(points:Set<string>)=>{const left=new Set(points),out:Set<string>[]=[];while(left.size){const seed=left.values().next().value!;left.delete(seed);const group=new Set([seed]),queue=[seed];while(queue.length)for(const q of neighbors(queue.pop()!))if(left.delete(q)){group.add(q);queue.push(q);}out.push(group);}return out;};
  const pixels=(s:Set<string>)=>[...s].map(xy).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const comparePixels=(a:number[][],b:number[][])=>{for(let i=0;i<Math.min(a.length,b.length);i++){const d=a[i][0]-b[i][0]||a[i][1]-b[i][1];if(d)return d;}return a.length-b.length;};
  const hidden=new Set([...original].filter(p=>!visible.has(p))),risks:any[]=[];
  for(const group of groups(hidden)){const boundary=new Set([...group].flatMap(neighbors).filter(p=>!group.has(p)));if(group.size<=12&&boundary.size&&[...boundary].every(p=>visible.has(p)))risks.push({kind:'enclosed-furniture-pixels',pixels:pixels(group)});}
  for(const group of groups(original)){const fragments=groups(new Set([...group].filter(p=>visible.has(p)))).sort((a,b)=>b.size-a.size||comparePixels(pixels(a),pixels(b)));if(fragments.length>1)for(const fragment of fragments.slice(1))if(fragment.size<=24)risks.push({kind:'new-disconnected-body-fragment',pixels:pixels(fragment)});}
  if(!Array.isArray(contact)||contact.length!==2||contact.some(v=>!Number.isFinite(v)))throw Error('Exact original contact geometry is missing.');
  const [x,y]=contact,near=new Set<string>();for(let xx=Math.floor(x)-2;xx<Math.ceil(x)+3;xx++)for(let yy=Math.floor(y)-2;yy<Math.ceil(y)+3;yy++)near.add(key(xx,yy));
  const evenRound=(v:number)=>{const f=Math.floor(v);return v-f===.5?(f%2?f+1:f):Math.round(v);};
  if(![...near].some(p=>visible.has(p))||![...near].some(p=>hidden.has(p)))risks.push({kind:'support-contact-transition-unconfirmed',pixels:[[evenRound(x),evenRound(y)]]});
  return risks.sort((a,b)=>a.kind.localeCompare(b.kind)||comparePixels(a.pixels,b.pixels)).map((r,i)=>({...r,id:`risk-${i}`}));
}
