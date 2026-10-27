import type {Clip} from './model';

export const MIN_TIMELINE_ZOOM=.35,MAX_TIMELINE_ZOOM=3;
export const timelineZoom=(value:number)=>Number.isFinite(value)?Math.min(MAX_TIMELINE_ZOOM,Math.max(MIN_TIMELINE_ZOOM,Math.round(value*10000)/10000)):1;
export function freeOverlayLayer(clips:Pick<Clip,'layer'>[]){
 const occupied=new Set(clips.map(c=>c.layer));
 for(let layer=1;layer<=8;layer++)if(!occupied.has(layer))return layer;
 return null;
}

/** Zoom changes only the viewport. The source time under the pointer stays put. */
export class TimelineNavigation {
 private frame=0;private pending:number|null=null;private anchor=0;private disposed=false;
 constructor(private scroll:HTMLElement,private labels:HTMLElement,private current:()=>number,private apply:(zoom:number)=>void,private busy:()=>boolean){
  scroll.addEventListener('wheel',this.wheel,{passive:false});
 }
 private wheel=(event:WheelEvent)=>{
  if(this.disposed||this.busy()||event.buttons||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||!event.deltaY||Math.abs(event.deltaX)>Math.abs(event.deltaY))return;
  const rect=this.scroll.getBoundingClientRect(),labelWidth=this.labels.getBoundingClientRect().width;
  // Track labels remain an ordinary vertical scroll area; browser/pinch zoom is untouched.
  if(event.clientX<rect.left+labelWidth)return;
  event.preventDefault();
  const unit=event.deltaMode===1?16:event.deltaMode===2?Math.max(100,this.scroll.clientHeight):1;
  const delta=Math.max(-240,Math.min(240,event.deltaY*unit));
  this.pending=timelineZoom((this.pending??this.current())*Math.exp(-delta*.0018));this.anchor=event.clientX;
  if(!this.frame)this.frame=requestAnimationFrame(()=>{
   this.frame=0;const next=this.pending;this.pending=null;
   if(!this.disposed&&!this.busy()&&next!==null)this.setZoom(next,this.anchor);
  });
 };
 setZoom(value:number,clientX?:number){
  cancelAnimationFrame(this.frame);this.frame=0;this.pending=null;
  if(this.disposed||this.busy())return;
  const next=timelineZoom(value),previous=this.current();if(next===previous)return;
  const rect=this.scroll.getBoundingClientRect(),labelWidth=this.labels.getBoundingClientRect().width;
  const x=Math.max(0,Math.min(rect.width-labelWidth,(clientX??rect.left+(rect.width+labelWidth)/2)-rect.left-labelWidth));
  const time=(this.scroll.scrollLeft+x)/(62*previous);
  this.apply(next);this.scroll.scrollLeft=Math.max(0,time*62*next-x);
 }
 dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.frame=0;this.pending=null;this.scroll.removeEventListener('wheel',this.wheel);}
}
