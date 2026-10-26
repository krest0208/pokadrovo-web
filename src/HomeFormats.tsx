import * as React from 'react';
import { createPortal } from 'react-dom';
import type { Mode, Ratio } from './editor/model';
import { PlatformIcon } from './PlatformIcon';

type Props={mode:Mode;ratio:Ratio;onChoose:(mode:Mode,ratio:Ratio)=>void;onStart?:()=>void};
const platforms:[string,string,Mode,Ratio,string][]=[
 ['Instagram','Reels','reels','9:16','ig'],['TikTok','Короткие видео','reels','9:16','tt'],
 ['YouTube','Shorts','reels','9:16','yt'],['YouTube','Видео','video','16:9','yt'],
 ['VK','Клипы','reels','9:16','vk'],['Telegram','Видео','video','1:1','tg']
];
/** Portal keeps a new social-format section inside the existing main, without changing its motion controller. */
export default class HomeFormats extends React.Component<Props,{mounted:boolean;selected:string}>{
 state={mounted:false,selected:''};private target:HTMLElement|null=null;private observer:IntersectionObserver|null=null;
 componentDidMount(){
  const slot=document.querySelector('.ps-shell #pkh-formats-slot');if(!slot)return;
  this.target=document.createElement('div');this.target.className='ph-slot';slot.append(this.target);
  this.setState({mounted:true},()=>{if(this.target&&typeof IntersectionObserver!=='undefined'){this.observer=new IntersectionObserver(es=>es.forEach(e=>e.target.classList.toggle('ph-visible',e.isIntersecting)),{threshold:.1});this.observer.observe(this.target);}});
 }
 componentWillUnmount(){this.observer?.disconnect();this.target?.remove();}
 render(){if(!this.state.mounted||!this.target)return null;
  return createPortal(<section id="pkh-formats" className="ph" aria-labelledby="ph-title">
   <header><div><span className="ph-kicker">{'ФОРМАТЫ ПЛОЩАДОК'}</span><h2 id="ph-title">{'Одна идея. Любой экран.'}</h2><p>{'Для Reels, большого экрана или ленты. Настройте подходящий размер кадра в студии.'}</p></div>
   </header>
   <div className="ph-platforms" aria-label="Форматы для публикации">{platforms.map(([name,type,,,glyph])=><div className="ph-platform-card" key={name+type}>
    <span className={'ph-icon '+glyph} aria-hidden="true"><PlatformIcon kind={glyph}/></span><span><strong>{name}</strong><small>{type}</small></span>
   </div>)}</div>
  </section>,this.target);
 }
}
