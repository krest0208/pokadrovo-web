import * as React from 'react';
import {createThemeIconMotion,themeAction,themeIconMarkup,type Theme} from './theme-icon';

export default function ThemeToggle({theme,onToggle,className='',label=false}:{theme:Theme;onToggle:()=>void;className?:string;label?:boolean}){
 const icon=React.useRef<HTMLSpanElement>(null),controller=React.useRef<ReturnType<typeof createThemeIconMotion>|null>(null);
 const [markup]=React.useState(themeIconMarkup);
 React.useEffect(()=>{if(!icon.current)return;const motion=createThemeIconMotion(icon.current,theme);controller.current=motion;return()=>{motion.dispose();controller.current=null;};},[]);
 React.useEffect(()=>{controller.current?.update(theme);},[theme]);
 return <button className={'pk-theme-control '+className} type="button" onClick={onToggle} aria-label={themeAction(theme)} title={themeAction(theme)}><span ref={icon} className="pk-theme-icon" data-theme={theme} aria-hidden="true" dangerouslySetInnerHTML={{__html:markup}}/>{label&&<span>{theme==='light'?'Тёмная тема':'Светлая тема'}</span>}</button>;
}
