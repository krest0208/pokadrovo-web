import { animate } from 'motion/mini';

const targets=[
  '.pk-hero-copy > *','.pk-principles > div','.pk-section-heading > *','.pk-process-card','.pk-feature-grid > article',
  '.pk-start > div','.pkh-composer','.pk-pack','.pk-trial-strip','.pk-inline-heading',
  '.pk-project-list > button','.pk-empty-projects','.pk-faq details','.pk-final > div:first-child',
  '.pk-footer-top > *','.ph header','.ph-platforms > button',
  '.pk-plans-hero > *','.pk-plan-card','.pk-russia-grid > article','.pk-plans-rules > div',
  '.pk-plans-comparison > h2','.pk-plans-context','.pk-plans-coins > div:first-child',
  '.pk-plans-faq details','.pk-plans-cta',
  '.pk-library > header','.pk-library-actions','.pk-library-grid > *',
  '.au-profile-title','.au-profile-stats > div','.au-project-grid > *'
].join(',');

export function createPageMotion(root:HTMLElement):()=>void {
  if(typeof root.animate!=='function'||typeof IntersectionObserver==='undefined'||typeof window.matchMedia!=='function')return ()=>{};
  const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
  const inside=new WeakSet<Element>();let registered=new WeakSet<Element>();
  const active=new Map<HTMLElement,()=>void>();
  let observer:IntersectionObserver|null=null,mutations:MutationObserver|null=null,disposed=false;

  const stopAll=()=>{for(const stop of [...active.values()])stop();};
  const reveal=(node:HTMLElement,upward=false)=>{
    if(disposed||preference.matches||!node.isConnected)return;
    active.get(node)?.();
    if(node.contains(document.activeElement)||document.visibilityState==='hidden')return;
    const opacity=node.style.getPropertyValue('opacity'),opacityPriority=node.style.getPropertyPriority('opacity');
    const transform=node.style.getPropertyValue('transform'),transformPriority=node.style.getPropertyPriority('transform');
    let animation:ReturnType<typeof animate>|undefined,finished=false;
    const restore=()=>{
      if(finished)return;finished=true;active.delete(node);
      animation?.cancel();
      if(opacity)node.style.setProperty('opacity',opacity,opacityPriority);else node.style.removeProperty('opacity');
      if(transform)node.style.setProperty('transform',transform,transformPriority);else node.style.removeProperty('transform');
    };
    try{
      const index=node.parentElement?Array.prototype.indexOf.call(node.parentElement.children,node):0;
      animation=animate(node,{opacity:[0,1],transform:[upward?'translateY(-16px)':'translateY(18px)','none']},{duration:.44,delay:Math.min(index,3)*.055,ease:[.22,1,.36,1]});
      active.set(node,restore);animation.then(restore,restore);
    }catch{restore();}
  };
  const register=(node:HTMLElement)=>{
    if(registered.has(node))return;
    registered.add(node);observer?.observe(node);
  };
  const scan=(node:HTMLElement)=>{
    if(node.matches(targets))register(node);
    node.querySelectorAll<HTMLElement>(targets).forEach(register);
  };
  const disconnect=()=>{observer?.disconnect();mutations?.disconnect();observer=null;mutations=null;stopAll();};
  const connect=()=>{
    disconnect();if(disposed||preference.matches)return;
    registered=new WeakSet();
    try{
    observer=new IntersectionObserver(entries=>{
      for(const entry of entries){
        const node=entry.target as HTMLElement;
        if(!entry.isIntersecting){inside.delete(node);active.get(node)?.();continue;}
        if(inside.has(node)||entry.intersectionRatio!==undefined&&entry.intersectionRatio<.08)continue;
        inside.add(node);reveal(node,(entry.boundingClientRect?.top??0)<0);
      }
    },{threshold:.08});
    scan(root);
    if(typeof MutationObserver!=='undefined'){
      mutations=new MutationObserver(records=>{
        if(disposed||preference.matches)return;
        for(const record of records)for(const node of record.addedNodes)if(node instanceof HTMLElement)scan(node);
        for(const [node,stop] of active)if(!node.isConnected)stop();
      });
      mutations.observe(root,{childList:true,subtree:true});
    }
    }catch{disconnect();}
  };
  const focused=(event:FocusEvent)=>{for(const [node,stop] of active)if(node.contains(event.target as Node))stop();};
  const visibility=()=>{if(document.visibilityState==='hidden')stopAll();};
  if(preference.addEventListener)preference.addEventListener('change',connect);else preference.addListener?.(connect);
  root.addEventListener('focusin',focused);document.addEventListener('visibilitychange',visibility);
  connect();
  return ()=>{
    disposed=true;disconnect();
    if(preference.removeEventListener)preference.removeEventListener('change',connect);else preference.removeListener?.(connect);
    root.removeEventListener('focusin',focused);document.removeEventListener('visibilitychange',visibility);
  };
}
