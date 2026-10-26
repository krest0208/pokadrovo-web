import {animate} from 'motion/mini';
import './theme-toggle.css';

export type Theme='light'|'dark';
export const themeAction=(theme:Theme)=>theme==='light'?'Включить тёмную тему':'Включить светлую тему';
export function themeIconMarkup(){
 return '<span class="pk-theme-orbit"><span class="pk-theme-phase pk-theme-sun"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4.8" fill="currentColor"/><path d="M12 2v1.5M12 20.5V22M2 12h1.5M20.5 12H22M4.93 4.93 6 6M18 18l1.07 1.07M4.93 19.07 6 18M18 6l1.07-1.07" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span><span class="pk-theme-dot"></span><span class="pk-theme-phase pk-theme-moon"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M20.5 14.2A8.8 8.8 0 0 1 9.8 3.5a9 9 0 1 0 10.7 10.7Z"/></svg></span></span>';
}

export function createThemeIconMotion(element:HTMLElement,initialTheme:Theme){
 const orbit=element.querySelector<HTMLElement>('.pk-theme-orbit');
 const sun=element.querySelector<HTMLElement>('.pk-theme-sun'),dot=element.querySelector<HTMLElement>('.pk-theme-dot'),moon=element.querySelector<HTMLElement>('.pk-theme-moon');
 const preference=element.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
 let theme=initialTheme,animations:ReturnType<typeof animate>[]=[],disposed=false;
 const stop=()=>{const current=animations;animations=[];for(const animation of current)try{animation.stop();}catch{try{animation.cancel();}catch{}}};
 const set=(node:HTMLElement|null,opacity:number,transform:string)=>{if(node){node.style.opacity=String(opacity);node.style.transform=transform;}};
 const settle=()=>{stop();if(orbit)orbit.style.transform='translateX(0px)';set(sun,theme==='light'?1:0,theme==='light'?'scale(1) rotate(0deg)':'scale(.16) rotate(90deg)');set(dot,0,'scale(0)');set(moon,theme==='dark'?1:0,theme==='dark'?'scale(1) rotate(0deg)':'scale(.16) rotate(-90deg)');};
 const onPreference=()=>{if(preference?.matches)settle();};
 preference?.addEventListener?.('change',onPreference);
 element.dataset.theme=theme;
 settle();
 return {
  update(next:Theme){
   if(disposed||next===theme)return;
   theme=next;element.dataset.theme=theme;
   stop();
   if(!orbit||!sun||!dot||!moon){settle();return;}
   if(preference?.matches||typeof orbit.animate!=='function'||element.getClientRects().length===0){settle();return;}
   const options={duration:.6,times:[0,.3,.6,1],ease:[.4,0,.2,1] as [number,number,number,number]};
   const outgoing=theme==='dark'?sun:moon,incoming=theme==='dark'?moon:sun;
   const collapsed=`scale(.16) rotate(${theme==='dark'?90:-90}deg)`,emerging=`scale(.16) rotate(${theme==='dark'?-90:90}deg)`;
   try{
    animations.push(animate(orbit,{transform:[null,`translateX(${theme==='dark'?5:-5}px)`,`translateX(${theme==='dark'?5:-5}px)`,'translateX(0px)']},options));
    animations.push(animate(outgoing,{transform:[null,collapsed,collapsed,collapsed],opacity:[null,0,0,0]},options));
    animations.push(animate(dot,{transform:[null,'scale(1)','scale(1)','scale(0)'],opacity:[null,1,1,0]},options));
    animations.push(animate(incoming,{transform:[null,emerging,emerging,'scale(1) rotate(0deg)'],opacity:[null,0,0,1]},options));
   }
   catch{settle();}
  },
  dispose(){disposed=true;settle();preference?.removeEventListener?.('change',onPreference);}
 };
}
