import { Clip, Caption, Selection, clone, uid, length, positions, currentClip, normalizeCaption, patchClip, totalLength } from './model';
import type { ToolPort } from './tool-port';
import { TransformControls } from './transform-controls';
import { TrackMenu, MenuItem } from './context-menu';
import { AiPanel } from './ai-panel';
import { editorFonts, fontStyle } from './fonts';
import { resetTransform } from './geometry';

const esc=(s:unknown)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export class EditorTools {
  private transforms:TransformControls;private menu:TrackMenu;private ai:AiPanel;
  private clipboard:{track:Selection['track'];item:Clip|Caption}|null=null;
  private contextTrack:Selection['track']='video';
  private buttons:HTMLElement[]=[];
  constructor(private port:ToolPort){
    this.transforms=new TransformControls(port);this.menu=new TrackMenu(port.root,action=>this.action(action));
    this.ai=new AiPanel(port);
    const button=document.createElement('button');button.type='button';button.dataset.tool='ai';
    button.className='pe-open-ai';button.title='Смонтировать с ИИ';button.ariaLabel=button.title;
    button.innerHTML='<span aria-hidden="true">✦</span><span>Смонтировать с ИИ</span>';
    port.root.querySelector('.pe-actions')!.prepend(button);this.buttons.push(button);
    const rail=document.createElement('button');rail.type='button';rail.dataset.tool='ai';rail.ariaLabel=button.title;
    rail.innerHTML='<b aria-hidden="true">✦</b><span>ИИ</span>';port.root.querySelector('.pe-rail')!.prepend(rail);this.buttons.push(rail);
    const more=document.createElement('button');more.type='button';more.dataset.tool='menu';more.ariaLabel='Инструменты выбранного клипа';
    more.className='pe-more-tools';more.textContent='•••';port.root.querySelector('.pe-tools')!.append(more);this.buttons.push(more);
    port.root.addEventListener('contextmenu',this.context);port.root.addEventListener('click',this.click);
    port.root.addEventListener('change',this.change);port.root.addEventListener('keydown',this.key);
  }
  beforeAction(action:string){if(['save','home','json-export','backup-export','export'].includes(action))this.ai.saveBrief();if(action==='export')this.ai.close();}
  sync(){this.transforms.sync();this.ai.refresh();}
  private item():Clip|Caption|undefined{
    const s=this.port.selected(),p=this.port.project();return !s?undefined:(s.track==='video'?p.clips:s.track==='audio'?p.audio:p.texts).find(c=>c.id===s.id);
  }
  private at():number{
    const s=this.port.selected();if(!s)return 0;
    if(s.track==='video')return positions(this.port.project()).find(v=>v.clip.id===s.id)?.at||0;
    const c=this.item();return s.track==='audio'?(c as Clip)?.at||0:(c as Caption)?.from||0;
  }
  private click=(e:Event)=>{
    const action=(e.target as HTMLElement).closest<HTMLElement>('[data-tool]')?.dataset.tool;
    if(action){e.stopPropagation();this.action(action);}
  };
  private change=(e:Event)=>{
    const n=e.target as HTMLInputElement;if(n.dataset.transformLock!==undefined)this.transforms.lock=n.checked;
  };
  private key=(e:KeyboardEvent)=>{
    if(e.shiftKey&&e.key==='F10'&&!(e.target as Element).closest('textarea,input,select')){
      e.preventDefault();e.stopPropagation();const target=(e.target as Element).closest<HTMLElement>('[data-select]');
      if(target){const [track,id]=target.dataset.select!.split(':');this.port.select({track:track as Selection['track'],id},this.port.cursor());}
      const r=target?.getBoundingClientRect()||this.port.root.querySelector('.pe-timeline')!.getBoundingClientRect();
      this.showMenu(r.left+16,r.top+16);
    }
  };
  private context=(e:MouseEvent)=>{
    const target=e.target as HTMLElement,row=target.closest<HTMLElement>('[data-drop]'),clip=target.closest<HTMLElement>('[data-select]');
    if(!row&&!clip&&!target.closest('.pe-ruler'))return;
    e.preventDefault();e.stopPropagation();if(this.port.busy())return;
    const p=this.port.project(),content=this.port.root.querySelector<HTMLElement>('.pe-track-content')!;
    const zoom=Number(this.port.root.querySelector<HTMLInputElement>('[data-ui="zoom"]')!.value);
    const time=Math.max(0,Math.min(totalLength(p),(e.clientX-content.getBoundingClientRect().left)/(62*zoom)));
    this.contextTrack=(row?.dataset.drop||clip?.dataset.track||'video') as Selection['track'];
    const selection=clip?.dataset.select?.split(':');
    this.port.pause();
    this.port.select(selection?{track:selection[0] as Selection['track'],id:selection[1]}:null,time);
    this.showMenu(e.clientX,e.clientY);
  };
  private showMenu(x:number,y:number){
    const selected=this.port.selected(),item=this.item(),image=(item as Clip)?.kind==='image';
    const pos=this.port.cursor(),at=this.at(),duration=selected?.track==='text'?(item as Caption).to-(item as Caption).from:item?length(item as Clip):0;
    const interior=!!item&&pos-at>=.04&&at+duration-pos>=.04;
    const audio=!!item&&!image&&selected?.track!=='text',visual=selected?.track==='video';
    const items:MenuItem[]=[
      {label:'Вырезать клип',action:'cut-clip',disabled:!item},
      {label:'Копировать',action:'copy',disabled:!item},
      {label:'Вставить',action:'paste',disabled:!this.clipboard},
      {label:'Дублировать',action:'duplicate',shortcut:'Ctrl+D',disabled:!item},
      {label:'Разделить здесь',action:'split',shortcut:'S',disabled:!interior,separator:true},
      {label:'Обрезать до курсора',action:'trim-start',disabled:!interior},
      {label:'Обрезать после курсора',action:'trim-end',disabled:!interior},
      {label:'Начало диапазона',action:'mark-in',shortcut:'I',separator:true},
      {label:'Конец диапазона',action:'mark-out',shortcut:'O'},
      {label:'Вырезать диапазон',action:'cut',disabled:(this.port.root.querySelector('[data-action="cut"]') as HTMLButtonElement).disabled},
      {label:'Добавить видео / фото',action:'add-video',separator:true},
      {label:'Добавить аудио',action:'add-audio'},
      {label:'Добавить текст',action:'add-text'},
      {label:audio&&(item as Clip).muted?'Включить звук':'Отключить звук',action:'mute',disabled:!audio,separator:true},
      {label:'Отделить звук',action:'detach',disabled:!audio||!visual},
      {label:'Скорость клипа…',action:'focus-speed',disabled:!audio},
      {label:'Громкость и затухание…',action:'focus-volume',disabled:!audio},
      {label:'Размер и форма…',action:'focus-shape',disabled:!visual},
      {label:'Шрифт текста…',action:'focus-fontId',disabled:selected?.track!=='text'},
      {label:'Задание для ИИ…',action:'ai',separator:true},
      {label:'Удалить',action:'delete',shortcut:'Delete',disabled:!item,danger:true}
    ];
    this.menu.show(x,y,item?(selected?.track==='audio'?'Аудиоклип':selected?.track==='text'?'Текст':'Видео / изображение'):'Инструменты дорожки',items);
  }
  private action(action:string){
    if(action==='ai'){this.ai.show();return;}
    if(this.port.busy())return;
    if(action==='menu'){const r=this.port.root.querySelector('.pe-more-tools')!.getBoundingClientRect();this.showMenu(r.left,r.bottom+5);return;}
    if(action==='add-video'||action==='add-audio'){this.port.run(action==='add-audio'?'tab-audio':'tab-media');this.port.run('import');return;}
    if(action.startsWith('focus-')){
      this.port.run('mobile-inspector');const field=action.slice(6);
      const node=this.port.root.querySelector<HTMLElement>(`[data-field="${field}"]`);
      let parent=node?.parentElement;while(parent&&parent!==this.port.root){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement;}
      node?.scrollIntoView({block:'center'});
      this.port.root.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus({preventScroll:true});return;
    }
    const item=this.item(),s=this.port.selected(),p=clone(this.port.project());
    if((action==='copy'||action==='cut-clip')&&item&&s){
      this.clipboard={track:s.track,item:clone(item)};this.port.status('Клип скопирован.');
      if(action==='cut-clip')this.port.run('delete');return;
    }
    if(action==='paste'&&this.clipboard){
      const {track}=this.clipboard,c=clone(this.clipboard.item);c.id=uid();
      if(track==='video'&&(c as Clip).layer>0){(c as Clip).at=this.port.cursor();p.clips.push(c as Clip);}
      else if(track==='video'){
        const selectedIndex=s?.track==='video'?p.clips.findIndex(v=>v.id===s.id):-1;
        let index=selectedIndex>=0?selectedIndex+1:positions(p).findIndex(v=>this.port.cursor()<v.end);
        if(index<0)index=p.clips.length;p.clips.splice(index,0,c as Clip);
      }else if(track==='audio'){(c as Clip).at=this.port.cursor();p.audio.push(c as Clip);}
      else{const a=c as Caption,d=a.to-a.from;a.from=this.port.cursor();a.to=a.from+d;p.texts.push(a);}
      this.port.commit(p,'Клип вставлен.');this.port.select({track,id:c.id});return;
    }
    if(action==='mute'&&item&&s&&s.track!=='text'){
      const list=s.track==='video'?p.clips:p.audio,i=list.findIndex(c=>c.id===s.id);list[i].muted=!list[i].muted;
      this.port.commit(p);return;
    }
    if(action==='reset-transform'&&s?.track==='video'){
      p.clips=p.clips.map(c=>c.id===s.id?patchClip(c,resetTransform):c);this.port.commit(p);return;
    }
    this.port.run(action);
  }
  enhanceInspector(){
    const s=this.port.selected(),item=this.item(),host=this.port.root.querySelector('.pe-inspector-body')!;
    if(!s||!item)return;
    const section=document.createElement('section');section.className='pe-extra-inspector';
    if(s.track==='text'){
      const c=item as Caption;
      section.innerHTML=`<h4>Шрифт</h4><label class="pe-field">Гарнитура<select data-field="fontId" aria-label="Шрифт">${editorFonts().map(f=>`<option value="${f.id}" ${c.fontId===f.id?'selected':''}>${esc(f.label)}</option>`).join('')}</select></label><label class="pe-field">Насыщенность<select data-field="weight" aria-label="Насыщенность">${[400,500,600,700,800,900].map(w=>`<option value="${w}" ${c.weight===w?'selected':''}>${w}${w===700?' · Жирный':''}</option>`).join('')}</select></label><label class="pe-check"><input type="checkbox" data-field="italic" ${c.italic?'checked':''}/> Курсив</label><label class="pe-field">Выравнивание<select data-field="align" aria-label="Выравнивание">${[['left','Слева'],['center','По центру'],['right','Справа']].map(([v,l])=>`<option value="${v}" ${c.align===v?'selected':''}>${l}</option>`).join('')}</select></label><div class="pe-font-sample"></div>`;
      section.querySelector<HTMLElement>('.pe-font-sample')!.style.font=fontStyle(c,22);
      section.querySelector('.pe-font-sample')!.textContent='Сначала идея. Потом кино.';
    }else if(s.track==='video'){
      const c=item as Clip;
      section.innerHTML=`<h4>Размер и форма</h4><label class="pe-check"><input type="checkbox" data-transform-lock ${this.transforms.lock?'checked':''}/> Сохранять пропорции</label><div class="pe-pair"><label class="pe-field">Ширина ×<input type="number" data-field="scaleX" aria-label="Масштаб по ширине" min=".05" max="8" step=".05" value="${c.scaleX}"/></label><label class="pe-field">Высота ×<input type="number" data-field="scaleY" aria-label="Масштаб по высоте" min=".05" max="8" step=".05" value="${c.scaleY}"/></label></div><label class="pe-field">Маска<select data-field="shape" aria-label="Форма изображения">${[['rect','Прямоугольник'],['round','Скруглённые углы'],['ellipse','Круг / овал']].map(([v,l])=>`<option value="${v}" ${c.shape===v?'selected':''}>${l}</option>`).join('')}</select></label>${c.shape==='round'?`<label class="pe-field">Скругление<input type="range" data-field="corner" min="0" max=".5" step=".01" value="${c.corner}" aria-label="Радиус скругления"/></label>`:''}<details><summary>Кадрирование исходника</summary><div class="pe-pair">${[['cropLeft','Слева'],['cropRight','Справа'],['cropTop','Сверху'],['cropBottom','Снизу']].map(([f,l])=>`<label class="pe-field">${l}<input type="number" data-field="${f}" min="0" max=".9" step=".01" value="${c[f as keyof Clip]}" aria-label="Кадрирование ${l.toLowerCase()}"/></label>`).join('')}</div><p class="pe-note">Доля исходника: 0.1 = 10%. Обрезка не меняет исходный файл.</p></details><button type="button" data-tool="reset-transform" class="pe-full">Сбросить трансформацию</button>`;
    }else return;
    host.prepend(section);
  }
  dispose(){
    this.menu.close(false);this.ai.dispose();this.transforms.dispose();this.buttons.forEach(b=>b.remove());
    this.port.root.removeEventListener('contextmenu',this.context);this.port.root.removeEventListener('click',this.click);
    this.port.root.removeEventListener('change',this.change);this.port.root.removeEventListener('keydown',this.key);
  }
}
