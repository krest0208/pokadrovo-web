import { Clip, Project, clone, visibleClips, clamp } from './model';
import { Box, Handle, mediaBox, dragTransform } from './geometry';
import type { ToolPort } from './tool-port';

const labels:Record<Handle,string>={move:'Переместить изображение',rotate:'Повернуть изображение',
  nw:'Левый верхний маркер',n:'Верхний маркер',ne:'Правый верхний маркер',e:'Правый маркер',
  se:'Правый нижний маркер',s:'Нижний маркер',sw:'Левый нижний маркер',w:'Левый маркер'};
export class TransformControls {
  private layer:HTMLDivElement;private box:HTMLDivElement;
  private draft:Project|null=null;private cancelDrag:(()=>void)|null=null;
  lock=true;
  constructor(private port:ToolPort){
    this.layer=document.createElement('div');this.layer.className='pe-transform-layer';this.layer.hidden=true;
    this.box=document.createElement('div');this.box.className='pe-transform-box';this.box.tabIndex=0;
    this.box.role='group';this.box.ariaLabel='Изменить размер и положение изображения';
    this.box.dataset.handle='move';
    for(const handle of ['nw','n','ne','e','se','s','sw','w','rotate'] as Handle[]){
      const button=document.createElement('button');button.type='button';button.className='pe-transform-handle h-'+handle;
      button.dataset.handle=handle;button.ariaLabel=labels[handle];button.title=labels[handle];this.box.append(button);
    }
    const badge=document.createElement('span');badge.className='pe-transform-badge';badge.textContent='Перетащите · Shift: пропорции';
    this.box.append(badge);this.layer.append(this.box);port.canvas.parentElement!.append(this.layer);
    this.layer.addEventListener('pointerdown',this.pointer);
    this.layer.addEventListener('keydown',this.key);
  }
  private current(p=this.port.project()):Clip|undefined{
    const sel=this.port.selected();if(sel?.track!=='video')return;
    return visibleClips(p,this.port.cursor()).find(c=>c.clip.id===sel.id)?.clip;
  }
  sync(p=this.draft||this.port.project()){
    if(this.cancelDrag)return;
    const c=this.current(p);const a=c&&this.port.assets.get(c.assetId);
    this.layer.hidden=!c||!a||this.port.playing()||this.port.busy();
    if(!c||!a)return;
    this.place(mediaBox(c,a,this.port.canvas.width,this.port.canvas.height),c);
  }
  private place(b:Box,c:Clip){
    const w=this.port.canvas.width,h=this.port.canvas.height;
    this.box.style.left=b.cx/w*100+'%';this.box.style.top=b.cy/h*100+'%';
    this.box.style.width=b.width/w*100+'%';this.box.style.height=b.height/h*100+'%';
    this.box.style.transform=`translate(-50%,-50%) rotate(${b.angle}deg)`;
    this.box.dataset.shape=c.shape;
  }
  private pointer=(e:PointerEvent)=>{
    if(e.button!==0||this.port.busy()||this.cancelDrag)return;
    const handle=(e.target as HTMLElement).closest<HTMLElement>('[data-handle]')?.dataset.handle as Handle;
    const c=this.current(),a=c&&this.port.assets.get(c.assetId);if(!c||!a||!handle)return;
    e.preventDefault();e.stopPropagation();this.port.pause();
    const canvas=this.port.canvas,r=canvas.getBoundingClientRect(),w=canvas.width,h=canvas.height;
    const b=mediaBox(c,a,w,h),original=clone(this.port.project());
    const x0=(e.clientX-r.left)*w/r.width,y0=(e.clientY-r.top)*h/r.height;
    const angle0=Math.atan2(y0-b.cy,x0-b.cx);this.draft=clone(original);
    const handleNode=(e.target as Element).closest<HTMLElement>('[data-handle]')!;
    handleNode.setPointerCapture(e.pointerId);let changed=false;
    const move=(ev:PointerEvent)=>{
      if(ev.pointerId!==e.pointerId)return;
      const x=(ev.clientX-r.left)*w/r.width,y=(ev.clientY-r.top)*h/r.height;
      let next:Clip;
      if(handle==='rotate'){
        let delta=(Math.atan2(y-b.cy,x-b.cx)-angle0)*180/Math.PI;
        let angle=((c.rotation+delta+540)%360)-180;if(ev.shiftKey)angle=Math.round(angle/15)*15;
        next={...c,rotation:clamp(angle,-180,180)};
      }else next=dragTransform(c,b,handle,x-x0,y-y0,w,h,ev.shiftKey?!this.lock:this.lock);
      changed=Math.hypot(x-x0,y-y0)>.5;
      this.draft!.clips=this.draft!.clips.map(item=>item.id===c.id?next:item);
      this.place(mediaBox(next,a,w,h),next);this.port.preview(this.draft!);
    };
    const cleanup=()=>{
      handleNode.removeEventListener('pointermove',move);handleNode.removeEventListener('pointerup',end);
      handleNode.removeEventListener('pointercancel',cancel);handleNode.removeEventListener('lostpointercapture',cancel);
      document.removeEventListener('keydown',escape,true);
      if(handleNode.hasPointerCapture(e.pointerId))handleNode.releasePointerCapture(e.pointerId);
      this.cancelDrag=null;
    };
    const cancel=()=>{const base=original;cleanup();this.draft=null;this.port.preview(base);this.sync();};
    const end=(ev:PointerEvent)=>{
      if(ev.pointerId!==e.pointerId)return;const result=this.draft;cleanup();this.draft=null;
      if(changed&&result)this.port.commit(result,'Положение и форма сохранены.');
      else{this.port.preview(original);this.sync();if(window.matchMedia('(max-width: 900px)').matches)this.port.run('mobile-inspector');}
    };
    const escape=(ev:KeyboardEvent)=>{if(ev.key==='Escape'){ev.preventDefault();ev.stopImmediatePropagation();cancel();}};
    this.cancelDrag=cancel;
    handleNode.addEventListener('pointermove',move);handleNode.addEventListener('pointerup',end);
    handleNode.addEventListener('pointercancel',cancel);handleNode.addEventListener('lostpointercapture',cancel);
    document.addEventListener('keydown',escape,true);
  };
  private key=(e:KeyboardEvent)=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)||this.port.busy())return;
    const c=this.current(),a=c&&this.port.assets.get(c.assetId);if(!c||!a)return;
    e.preventDefault();e.stopPropagation();
    const h=((e.target as HTMLElement).dataset.handle||'move') as Handle;
    const p=clone(this.port.project()),step=e.shiftKey?10:1;
    const dx=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,dy=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;
    const next=h==='rotate'?{...c,rotation:clamp(c.rotation+(dx||dy),-180,180)}:
      dragTransform(c,mediaBox(c,a,this.port.canvas.width,this.port.canvas.height),h,dx,dy,this.port.canvas.width,this.port.canvas.height,this.lock);
    p.clips=p.clips.map(item=>item.id===c.id?next:item);this.port.commit(p);
  };
  dispose(){this.cancelDrag?.();this.layer.removeEventListener('pointerdown',this.pointer);this.layer.removeEventListener('keydown',this.key);this.layer.remove();}
}
