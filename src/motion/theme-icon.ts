import {animate} from 'motion/mini';
import './theme-toggle.css';

export type Theme='light'|'dark';
export const themeAction=(theme:Theme)=>theme==='light'?'Включить тёмную тему':'Включить светлую тему';
let iconId=0;
export function themeIconMarkup(){
 const mask='pk-theme-mask-'+(++iconId);
 return `<span class="pk-theme-orbit"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><defs><mask id="${mask}" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="white"/><circle class="pk-theme-cutout" cx="12" cy="12" r="7" fill="black"/></mask></defs><g class="pk-theme-rays" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 2v1.5M12 20.5V22M2 12h1.5M20.5 12H22M4.93 4.93 6 6M18 18l1.07 1.07M4.93 19.07 6 18M18 6l1.07-1.07"/></g><g mask="url(#${mask})"><circle class="pk-theme-core" cx="12" cy="12" r="7" fill="currentColor"/></g></svg></span>`;
}

export function createThemeIconMotion(element:HTMLElement,initialTheme:Theme){
 const orbit=element.querySelector<HTMLElement>('.pk-theme-orbit');
 const preference=element.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
 let theme=initialTheme,animation:ReturnType<typeof animate>|undefined,disposed=false;
 const target=()=>`translateX(0px) rotate(${theme==='dark'?180:0}deg)`;
 const settle=()=>{animation?.stop();animation=undefined;if(orbit)orbit.style.transform=target();};
 const onPreference=()=>{if(preference?.matches)settle();};
 preference?.addEventListener?.('change',onPreference);
 element.dataset.theme=theme;
 settle();
 return {
  update(next:Theme){
   if(disposed||next===theme)return;
   theme=next;element.dataset.theme=theme;
   animation?.stop();animation=undefined;
   if(!orbit)return;
   if(preference?.matches||typeof orbit.animate!=='function'){settle();return;}
   try{animation=animate(orbit,{transform:[null,`translateX(${theme==='dark'?6:-6}px) rotate(90deg)`,target()]},{duration:.4,times:[0,.45,1],ease:[.22,1,.36,1]});}
   catch{settle();}
  },
  dispose(){disposed=true;settle();preference?.removeEventListener?.('change',onPreference);}
 };
}
