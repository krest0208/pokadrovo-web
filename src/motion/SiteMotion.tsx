import {useEffect} from 'react';
import {createPageMotion} from './page-motion';
import './site-motion.css';

export default function SiteMotion({screen}:{screen:string}){
  useEffect(()=>{
    if(screen==='editor'||screen==='home')return;
    const root=document.querySelector<HTMLElement>('.pkh,.pk-plans,.pk-library,.au-profile');
    if(root)return createPageMotion(root);
  },[screen]);
  return null;
}
