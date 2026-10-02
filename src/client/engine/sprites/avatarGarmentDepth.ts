import type { LowerGarmentSource } from './pixkit';
type Point=readonly [number,number];
const cross=(a:Point,b:Point,c:Point)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
export function barycentric(p:Point,a:Point,b:Point,c:Point):[number,number,number]|null {
  const d=cross(a,b,c);if(Math.abs(d)<1e-10)return null;
  const v=cross(a,p,c)/d,w=cross(a,b,p)/d,u=1-v-w;
  return Math.min(u,v,w)>=-1e-8?[u,v,w]:null;
}
/** Ear clipping preserves the original concave garment polygon, including a draped lap. */
export function garmentTriangles(points:Point[]):Array<[number,number,number]> {
 const indices=points.map((_,i)=>i),result:Array<[number,number,number]>=[];
 const area=points.reduce((s,a,i)=>{const b=points[(i+1)%points.length];return s+a[0]*b[1]-a[1]*b[0];},0),sign=Math.sign(area);
 while(indices.length>3){let found=false;
  for(let j=0;j<indices.length;j++){
   const a=indices[(j+indices.length-1)%indices.length],b=indices[j],c=indices[(j+1)%indices.length];
   if(cross(points[a],points[b],points[c])*sign<=1e-9)continue;
   if(indices.some(i=>i!==a&&i!==b&&i!==c&&barycentric(points[i],points[a],points[b],points[c])))continue;
   result.push([a,b,c]);indices.splice(j,1);found=true;break;
  }
  if(!found)throw Error('Original lower-garment polygon cannot be triangulated');
 }
 result.push(indices as [number,number,number]);return result;
}
/** Explicit thin cloth surface: seam/knee/hem anchors, independent of any furniture. */
export function garmentHeight(source:LowerGarmentSource,x:number,y:number,anchors:Record<LowerGarmentSource['vertices'][number]['anchor'],number>):number {
 for(const triangle of source.triangles){
  const vertices=triangle.map(i=>source.vertices[i]),weights=barycentric([x,y],vertices[0].point,vertices[1].point,vertices[2].point);
  if(weights)return vertices.reduce((z,v,i)=>z+weights[i]*(anchors[v.anchor]-v.drop/2),0)+.25;
 }
 return NaN;
}
