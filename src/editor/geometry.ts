import { Asset, Clip, clamp, patchClip } from './model';

export type Handle = 'move'|'rotate'|'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w';
export interface Box {
  cx:number; cy:number; width:number; height:number; angle:number;
  sx:number; sy:number; sw:number; sh:number;
}
/** One geometry function for preview, transform handles and rendered export. */
export function mediaBox(c:Clip,a:Pick<Asset,'width'|'height'>,w:number,h:number):Box {
  const aw=Math.max(1,a.width),ah=Math.max(1,a.height);
  const sx=aw*c.cropLeft,sy=ah*c.cropTop;
  const sw=aw*(1-c.cropLeft-c.cropRight),sh=ah*(1-c.cropTop-c.cropBottom);
  const turn=Math.abs(Math.sin(c.rotation*Math.PI/180))>.999;
  const rw=turn?sh:sw,rh=turn?sw:sh;
  const k=(c.fit==='cover'?Math.max(w/rw,h/rh):Math.min(w/rw,h/rh))*c.zoom;
  return {cx:w*(.5+c.x/100),cy:h*(.5+c.y/100),width:sw*k*c.scaleX,height:sh*k*c.scaleY,angle:c.rotation,
    sx,sy,sw,sh};
}
export function clipPath(ctx:CanvasRenderingContext2D,c:Clip,w:number,h:number){
  ctx.beginPath();
  if(c.shape==='ellipse')ctx.ellipse(0,0,w/2,h/2,0,0,Math.PI*2);
  else if(c.shape==='round'){
    const x=-w/2,y=-h/2,r=Math.min(w,h)*c.corner;
    ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
  }else ctx.rect(-w/2,-h/2,w,h);
  ctx.clip();
}
export function dragTransform(c:Clip,b:Box,handle:Handle,dx:number,dy:number,w:number,h:number,lock:boolean):Clip{
  if(handle==='move')return patchClip(c,{x:c.x+dx/w*100,y:c.y+dy/h*100});
  if(handle==='rotate')return c;
  const rad=b.angle*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad);
  const lx=dx*cos+dy*sin,ly=-dx*sin+dy*cos;
  const hx=handle.includes('e')?1:handle.includes('w')?-1:0;
  const hy=handle.includes('s')?1:handle.includes('n')?-1:0;
  let fx=hx?1+hx*lx/b.width:1,fy=hy?1+hy*ly/b.height:1;
  if(lock){
    const f=hx&&hy?(Math.abs(fx-1)>=Math.abs(fy-1)?fx:fy):hx?fx:fy;
    const k=clamp(f,Math.max(.05/c.scaleX,.05/c.scaleY),Math.min(8/c.scaleX,8/c.scaleY));
    fx=k;fy=k;
  }else{fx=clamp(fx,.05/c.scaleX,8/c.scaleX);fy=clamp(fy,.05/c.scaleY,8/c.scaleY);}
  const ox=hx*b.width*(fx-1)/2,oy=hy*b.height*(fy-1)/2;
  return patchClip(c,{scaleX:c.scaleX*fx,scaleY:c.scaleY*fy,
    x:c.x+(ox*cos-oy*sin)/w*100,y:c.y+(ox*sin+oy*cos)/h*100});
}
export const resetTransform:Partial<Clip>={zoom:1,scaleX:1,scaleY:1,x:0,y:0,rotation:0,flip:false,
  shape:'rect',corner:.12,cropLeft:0,cropRight:0,cropTop:0,cropBottom:0};
