/** Detect and deform the original textured string without changing the source PNG. */
import { inverse, multiply, transformPoint } from "../rig/matrix.ts"
import type { Matrix2D, Point } from "../rig/types.ts"
import type { LayerImage } from "./paint.ts"
export interface BowString { top: Point; bottom: Point; halfWidth: number }
const cache = new WeakMap<LayerImage, BowString | null>()
export function detectBowStringPixels(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number): BowString | null {
  const limit=Math.max(5,Math.floor(width*0.035))
  let samples: {x:number;y:number;width:number}[]=[]
  const alpha=(x:number,y:number)=>pixels[(y*width+x)*4+3]
  for(let y=0;y<height;y++) {
    let x=width-1
    while(x>=0 && alpha(x,y)<30)x--
    const end=x
    while(x>=0 && alpha(x,y)>=30)x--
    const start=x+1
    if(end-start<=0 || end-start>=limit)continue
    const gap=x
    while(x>=0 && alpha(x,y)<30)x--
    if(x>=0 && gap-x>Math.max(5,limit)) samples.push({x:(start+end)/2,y,width:end-start+1})
  }
  if(samples.length<=Math.max(12,height/6))return null
  const fit=()=> {
    const mx=samples.reduce((s,p)=>s+p.x,0)/samples.length, my=samples.reduce((s,p)=>s+p.y,0)/samples.length
    const m=samples.reduce((s,p)=>s+(p.y-my)*(p.x-mx),0)/Math.max(1,samples.reduce((s,p)=>s+(p.y-my)**2,0))
    return {m,b:mx-m*my}
  }
  let line=fit()
  samples=samples.filter(p=>Math.abs(p.x-(line.m*p.y+line.b))<limit)
  if(samples.length<=Math.max(12,height/6) || samples.at(-1)!.y-samples[0].y<height*0.35)return null
  line=fit()
  const half=Math.ceil(Math.max(...samples.map(p=>p.width))/2)
  const endpoint=(start:number,step:number)=> {
    let end=start,empty=0
    for(let y=start+step;y>=0&&y<height;y+=step) {
      const x=Math.round(line.m*y+line.b),lo=Math.max(0,x-half),hi=Math.min(width-1,x+half)
      let seed=-1
      for(let xx=lo;xx<=hi;xx++)if(alpha(xx,y)>=30){seed=xx;break}
      if(seed>=0) {
        let l=seed,r=seed
        while(l>0&&alpha(l-1,y)>=30)l--
        while(r<width-1&&alpha(r+1,y)>=30)r++
        if(r-l+1>Math.max(6,half*4))break
        end=y;empty=0
      } else if(++empty>=3)break
    }
    return {x:line.m*end+line.b,y:end}
  }
  return {top:endpoint(samples[0].y,-1),bottom:endpoint(samples.at(-1)!.y,1),halfWidth:Math.max(...samples.map(p=>p.width))/2+2}
}
export function bowStringFor(image: LayerImage): BowString | null {
  if(cache.has(image))return cache.get(image)!
  if(typeof document==="undefined" || !image.width || !image.height)return null
  const canvas=document.createElement("canvas");canvas.width=image.width;canvas.height=image.height
  const context=canvas.getContext("2d",{willReadFrequently:true})
  if(!context)return null
  context.drawImage(image,0,0)
  const result=detectBowStringPixels(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height)
  cache.set(image,result);return result
}
export function straightStringContact(span: BowString, point: Point): Point {
  const dx=span.bottom.x-span.top.x,dy=span.bottom.y-span.top.y
  const t=Math.min(0.95,Math.max(0.05,((point.x-span.top.x)*dx+(point.y-span.top.y)*dy)/Math.max(1e-8,dx*dx+dy*dy)))
  return {x:span.top.x+dx*t,y:span.top.y+dy*t}
}
const apply=(c:CanvasRenderingContext2D,m:Matrix2D)=>c.transform(m.a,m.b,m.c,m.d,m.e,m.f)
export function drawBowBody(c: CanvasRenderingContext2D, image: LayerImage, matrix: Matrix2D, span: BowString) {
  c.save();apply(c,matrix);c.beginPath();c.rect(-1,-1,image.width+2,image.height+2)
  c.moveTo(span.top.x-span.halfWidth,span.top.y);c.lineTo(span.bottom.x-span.halfWidth,span.bottom.y)
  c.lineTo(span.bottom.x+span.halfWidth,span.bottom.y);c.lineTo(span.top.x+span.halfWidth,span.top.y);c.closePath()
  c.clip("evenodd");c.drawImage(image,0,0);c.restore()
}
export function drawBowString(c: CanvasRenderingContext2D, image: LayerImage, matrix: Matrix2D, span: BowString, contact: Point) {
  const nock=transformPoint(inverse(matrix),contact)
  const t=Math.min(0.95,Math.max(0.05,(nock.y-span.top.y)/Math.max(1,span.bottom.y-span.top.y)))
  const middle={x:span.top.x+(span.bottom.x-span.top.x)*t,y:span.top.y+(span.bottom.y-span.top.y)*t}
  const basis=(a:Point,b:Point):Matrix2D=> {
    const length=Math.max(1e-8,Math.hypot(b.x-a.x,b.y-a.y))
    return {a:(b.y-a.y)/length,b:-(b.x-a.x)/length,c:b.x-a.x,d:b.y-a.y,e:a.x,f:a.y}
  }
  for(const [a,b,start,end] of [[span.top,middle,span.top,nock],[middle,span.bottom,nock,span.bottom]]) {
    const from=basis(a,b),to=basis(start,end)
    c.save();apply(c,matrix);apply(c,multiply(to,inverse(from)))
    const points=[{x:-span.halfWidth,y:0},{x:span.halfWidth,y:0},{x:span.halfWidth,y:1},{x:-span.halfWidth,y:1}].map(p=>transformPoint(from,p))
    c.beginPath();c.moveTo(points[0].x,points[0].y);points.slice(1).forEach(p=>c.lineTo(p.x,p.y));c.closePath()
    c.clip();c.drawImage(image,0,0);c.restore()
  }
}
