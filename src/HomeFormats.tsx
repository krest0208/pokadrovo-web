import * as React from 'react';
import { Check } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { Mode, Ratio } from './editor/model';
import { t } from './editor/copy';
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
  const choose=(mode:Mode,ratio:Ratio,id:string)=>{this.props.onChoose(mode,ratio);this.setState({selected:id});};
  return createPortal(<section id="pkh-formats" className="ph" aria-labelledby="ph-title">
   <header><div><span className="ph-kicker">{'ФОРМАТЫ ПЛОЩАДОК'}</span><h2 id="ph-title">{'Одна идея. Любой экран.'}</h2><p>{'Для Reels, большого экрана или ленты. Выберите площадку — размер кадра уже настроен.'}</p></div>
   <div className="ph-modes" role="group" aria-label={t.regular+' / Reels'}><button type="button" aria-pressed={this.props.mode==='video'} onClick={()=>choose('video','16:9','')}>{t.regular}<small>16:9</small></button><button type="button" aria-pressed={this.props.mode==='reels'} onClick={()=>choose('reels','9:16','')}>{t.reels}<small>9:16</small></button></div></header>
   <div className="ph-platforms">{platforms.map(([name,type,mode,ratio,glyph])=><button type="button" key={name+type} className={this.state.selected===name+type?'chosen':''} onClick={()=>choose(mode,ratio,name+type)} aria-pressed={this.state.selected===name+type}>
    <span className={'ph-icon '+glyph} aria-hidden="true"><PlatformIcon kind={glyph}/></span><span><strong>{name}</strong><small>{type}</small></span><b>{ratio}</b>{this.state.selected===name+type&&<Check className="ph-selected-icon" size={16} aria-hidden="true"/>}
   </button>)}</div>
   <div className="ph-status" role="status"><span>{'Новый проект: '}{this.props.mode==='reels'?t.reels:t.regular} / {this.props.ratio}</span><button type="button" onClick={()=>this.props.onStart?.()}>{'Создать проект'} <span aria-hidden="true">{'\u2197'}</span></button></div>
  </section>,this.target);
 }
}
