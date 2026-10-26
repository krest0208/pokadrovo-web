const seen = new Set<string>();
const steps = [
  {panel:'library', target:'.pe-library', title:'Добавьте материалы', text:'Загрузите видео, фото или звук. Файлы появятся здесь и на дорожках проекта.'},
  {panel:'player', target:'.pe-player', title:'Редактируйте прямо в кадре', text:'Нажмите на видео, чтобы выбрать клип. Потяните рамку, чтобы изменить размер или положение.'},
  {panel:'timeline', target:'.pe-timeline', title:'Соберите последовательность', text:'Переставляйте клипы, тяните за их края и разделяйте в нужном месте. Стрелка назад отменяет правку.'},
  {panel:'inspector', target:'.pe-inspector', title:'Настройте выбранный клип', text:'Здесь доступны обрезка, скорость, звук, цвет и размер. Откройте нужный раздел настроек.'},
  {panel:'player', target:'.pe-open-ai', title:'Дайте задание ИИ', text:'Опишите нужные правки. Проверьте предложенный план и примените его, когда будете готовы.'},
  {panel:'player', target:'[data-action="export"]', title:'Сохраните результат', text:'Нажмите «Экспорт», выберите формат и разрешение. Это обучение можно открыть снова кнопкой «?».'}
];

/** A tour only changes the visible panel; it never mutates project history. */
export class EditorTour {
  private layer:HTMLDivElement;
  private step=0;
  private returnFocus:HTMLElement|null=null;
  private previousPanel='player';
  private locked:{node:HTMLElement;inert:boolean}[]=[];
  private frame=0;
  private disposed=false;
  private keyName:string;
  constructor(private root:HTMLElement, account:string|null, private showPanel:(panel:string)=>void, private pause:()=>void){
    this.keyName='pokadrovo.editor.tour.v1:'+(account||'guest-local');
    this.layer=document.createElement('div');this.layer.className='pe-tour-layer';this.layer.hidden=true;
    this.root.append(this.layer);
    this.layer.addEventListener('click',this.click);
    document.addEventListener('keydown',this.key,true);
    window.addEventListener('resize',this.position);
    this.frame=requestAnimationFrame(()=>{if(!this.disposed&&this.root.isConnected&&!this.wasSeen())this.start();});
  }
  get active(){return !this.layer.hidden;}
  private wasSeen(){try{return seen.has(this.keyName)||localStorage.getItem(this.keyName)==='seen';}catch{return seen.has(this.keyName);}}
  start(){
    if(this.disposed||this.active)return;
    this.pause();this.returnFocus=document.activeElement as HTMLElement;
    this.previousPanel=this.root.dataset.mobile||'player';this.step=0;
    seen.add(this.keyName);try{localStorage.setItem(this.keyName,'seen');}catch{}
    this.locked=Array.from(this.root.children).filter((n):n is HTMLElement=>n instanceof HTMLElement&&n!==this.layer).map(node=>({node,inert:node.inert}));
    this.locked.forEach(({node})=>node.inert=true);
    this.layer.hidden=false;this.render();
  }
  private render(){
    const s=steps[this.step];this.showPanel(s.panel);
    this.layer.innerHTML=`<div class="pe-tour-highlight" aria-hidden="true"></div><section class="pe-tour-card" role="dialog" aria-modal="true" aria-labelledby="pe-tour-title" aria-describedby="pe-tour-text"><div class="pe-tour-top"><span>Знакомство со студией · ${this.step+1} / ${steps.length}</span><button type="button" data-tour="skip">Пропустить</button></div><div class="pe-tour-dots" aria-hidden="true">${steps.map((_,i)=>`<i class="${i===this.step?'active':''}"></i>`).join('')}</div><h2 id="pe-tour-title">${s.title}</h2><p id="pe-tour-text">${s.text}</p><footer><button type="button" data-tour="back" ${this.step===0?'disabled':''}>Назад</button><button type="button" class="primary" data-tour="next">${this.step===steps.length-1?'Начать монтаж':'Далее'}</button></footer></section>`;
    cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(this.position);
    this.layer.querySelector<HTMLButtonElement>('[data-tour="next"]')?.focus({preventScroll:true});
  }
  private position=()=>{
    if(!this.active||this.disposed)return;
    const target=this.root.querySelector<HTMLElement>(steps[this.step].target);
    const card=this.layer.querySelector<HTMLElement>('.pe-tour-card')!,highlight=this.layer.querySelector<HTMLElement>('.pe-tour-highlight')!;
    const width=document.documentElement.clientWidth,height=window.innerHeight,pad=12;
    const rect=target?.getBoundingClientRect();
    const visible=!!rect&&rect.width>0&&rect.height>0;
    highlight.hidden=!visible;
    if(visible){Object.assign(highlight.style,{left:Math.max(4,rect.left-4)+'px',top:Math.max(4,rect.top-4)+'px',width:Math.min(width-8,rect.width+8)+'px',height:Math.min(height-8,rect.height+8)+'px'});}
    const cw=card.offsetWidth,ch=card.offsetHeight;
    let x=(width-cw)/2,y=(height-ch)/2;
    if(rect&&visible){
      if(width>760&&rect.right+cw+24<width){x=rect.right+16;y=rect.top+12;}
      else if(width>760&&rect.left>cw+24){x=rect.left-cw-16;y=rect.top+12;}
      else if(rect.bottom+ch+24<height){x=rect.left+(rect.width-cw)/2;y=rect.bottom+16;}
      else if(rect.top>ch+24){x=rect.left+(rect.width-cw)/2;y=rect.top-ch-16;}
      else{y=rect.top<height/2?height-ch-16:16;}
    }
    card.style.left=Math.max(pad,Math.min(width-cw-pad,x))+'px';
    card.style.top=Math.max(pad,Math.min(height-ch-pad,y))+'px';
  };
  private click=(e:Event)=>{
    const action=(e.target as Element).closest<HTMLElement>('[data-tour]')?.dataset.tour;
    if(action==='skip'||action==='next'&&this.step===steps.length-1)this.close();
    else if(action==='next'){this.step++;this.render();}
    else if(action==='back'&&this.step>0){this.step--;this.render();}
  };
  private key=(e:KeyboardEvent)=>{
    if(!this.active)return;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();this.close();return;}
    if(e.key==='Tab'){
      const buttons=Array.from(this.layer.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const first=buttons[0],last=buttons[buttons.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
    // Prevent editor shortcuts behind the dialog; native buttons still receive Enter/Space.
    if(!this.layer.contains(e.target as Node)){e.preventDefault();e.stopImmediatePropagation();this.layer.querySelector<HTMLButtonElement>('[data-tour="next"]')?.focus();}
    else e.stopPropagation();
  };
  close(restoreFocus=true){
    if(!this.active)return;
    this.layer.hidden=true;this.locked.forEach(({node,inert})=>node.inert=inert);this.locked=[];
    this.showPanel(this.previousPanel);cancelAnimationFrame(this.frame);
    if(restoreFocus){const focus=this.returnFocus?.isConnected&&this.returnFocus.getClientRects().length?this.returnFocus:this.root.querySelector<HTMLElement>('[data-action="help"]');focus?.focus({preventScroll:true});}
  }
  dispose(){this.disposed=true;this.close(false);cancelAnimationFrame(this.frame);this.layer.removeEventListener('click',this.click);document.removeEventListener('keydown',this.key,true);window.removeEventListener('resize',this.position);this.layer.remove();}
}
