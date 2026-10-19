import * as React from 'react';
import { createPortal } from 'react-dom';
import type { Mode, Ratio } from './editor/model';
import { t } from './editor/copy';

type Props={mode:Mode;ratio:Ratio;onChoose:(mode:Mode,ratio:Ratio)=>void;onStart?:()=>void};
const platforms:[string,string,Mode,Ratio,string][]=[
 ['Instagram','Reels','reels','9:16','ig'],['TikTok','Short video','reels','9:16','tt'],
 ['YouTube','Shorts','reels','9:16','yt'],['YouTube','Video','video','16:9','yt'],
 ['VK','Клипы','reels','9:16','vk'],['Telegram','Video','video','1:1','tg']
];
function PlatformIcon({kind}:{kind:string}){
 const paths:Record<string,string>={ig:'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm10 10a5 5 0 1 1-10 0 5 5 0 0 1 10 0M17.5 6.5h.01',tt:'M13 3v12a4 4 0 1 1-4-4M13 3c1 4 3 6 7 6',yt:'M4 5h16a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Zm6 3 7 4-7 4V8Z',vk:'M2 6c1 7 5 12 10 12V6m0 8c3 0 6 1 9 4m-9-5c4-1 6-4 8-7',tg:'m2 11 20-8-4 18-6-5-4 4 1-7 9-7-12 7Z'};
 return <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]}/></svg>;
}
/** Portal keeps a new social-format section inside the existing main, without changing its motion controller. */
export default class HomeFormats extends React.Component<Props,{mounted:boolean;selected:string}>{
 state={mounted:false,selected:''};private target:HTMLElement|null=null;private observer:IntersectionObserver|null=null;
 componentDidMount(){
  const hero=document.querySelector('.ps-shell .pkh-hero');if(!hero)return;
  this.target=document.createElement('div');this.target.className='ph-slot';hero.insertAdjacentElement('afterend',this.target);
  this.setState({mounted:true},()=>{if(this.target&&typeof IntersectionObserver!=='undefined'){this.observer=new IntersectionObserver(es=>es.forEach(e=>e.target.classList.toggle('ph-visible',e.isIntersecting)),{threshold:.1});this.observer.observe(this.target);}});
 }
 componentWillUnmount(){this.observer?.disconnect();this.target?.remove();}
 render(){if(!this.state.mounted||!this.target)return null;
  const choose=(mode:Mode,ratio:Ratio,id:string)=>{this.props.onChoose(mode,ratio);this.setState({selected:id});};
  return createPortal(<section className="ph" aria-labelledby="ph-title">
   <header><div><span className="ph-kicker">{'ВАШЕ ВИДЕО. ВАША ПЛОЩАДКА.'}</span><h2 id="ph-title">{'Одна идея. Любой экран.'}</h2><p>{'Для Reels, большого экрана или ленты. Выберите площадку — размер кадра уже настроен.'}</p></div>
   <div className="ph-modes" role="group" aria-label={t.regular+' / Reels'}><button type="button" aria-pressed={this.props.mode==='video'} onClick={()=>choose('video','16:9','')}>{t.regular}<small>16:9</small></button><button type="button" aria-pressed={this.props.mode==='reels'} onClick={()=>choose('reels','9:16','')}>{t.reels}<small>9:16</small></button></div></header>
   <div className="ph-platforms">{platforms.map(([name,type,mode,ratio,glyph])=><button type="button" key={name+type} className={this.state.selected===name+type?'chosen':''} onClick={()=>choose(mode,ratio,name+type)} aria-pressed={this.state.selected===name+type}>
    <span className={'ph-icon '+glyph}><PlatformIcon kind={glyph}/></span><span><strong>{name}</strong><small>{type}</small></span><b>{ratio}</b>
   </button>)}</div>
   <div className="ph-status" role="status"><span>{'Новый проект: '}{this.props.mode==='reels'?t.reels:t.regular} / {this.props.ratio}</span><button type="button" onClick={()=>this.props.onStart?.()}>{'Создать проект'} <span aria-hidden="true">{'\u2197'}</span></button></div>
  </section>,this.target);
 }
}
