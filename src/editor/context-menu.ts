export interface MenuItem { label:string; action:string; shortcut?:string; disabled?:boolean; danger?:boolean; separator?:boolean; }
export class TrackMenu {
  private node:HTMLDivElement|null=null;private previous:HTMLElement|null=null;private handlers:(()=>void)[]=[];
  constructor(private root:HTMLElement,private choose:(action:string)=>void){}
  get open(){return !!this.node;}
  show(x:number,y:number,title:string,items:MenuItem[]){
    this.close(false);this.previous=document.activeElement as HTMLElement;
    const menu=document.createElement('div');menu.className='pe-context-menu';menu.role='menu';menu.ariaLabel=title;
    const cap=document.createElement('div');cap.className='pe-context-title';cap.textContent=title;menu.append(cap);
    for(const item of items){
      if(item.separator){const line=document.createElement('hr');line.role='separator';menu.append(line);}
      const button=document.createElement('button');button.type='button';button.role='menuitem';button.tabIndex=-1;
      button.ariaLabel=item.label;button.disabled=!!item.disabled;if(item.danger)button.className='danger';
      const label=document.createElement('span');label.textContent=item.label;button.append(label);
      if(item.shortcut){const hint=document.createElement('kbd');hint.textContent=item.shortcut;button.append(hint);}
      button.addEventListener('click',e=>{e.stopPropagation();this.close(false);this.choose(item.action);});
      menu.append(button);
    }
    menu.addEventListener('contextmenu',e=>e.preventDefault());
    menu.addEventListener('pointerdown',e=>e.stopPropagation());
    menu.addEventListener('keydown',e=>{
      const buttons=[...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const i=buttons.indexOf(document.activeElement as HTMLButtonElement);
      if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();e.stopPropagation();this.close();return;}
      let next=-1;if(e.key==='ArrowDown')next=(i+1)%buttons.length;
      if(e.key==='ArrowUp')next=(i-1+buttons.length)%buttons.length;
      if(e.key==='Home')next=0;if(e.key==='End')next=buttons.length-1;
      if(next>=0){e.preventDefault();e.stopPropagation();buttons[next]?.focus();}
    });
    this.node=menu;this.root.append(menu);
    menu.style.maxHeight=Math.max(140,window.innerHeight-20)+'px';
    const r=menu.getBoundingClientRect();
    menu.style.left=Math.max(8,Math.min(x,window.innerWidth-r.width-8))+'px';
    menu.style.top=Math.max(8,Math.min(y,window.innerHeight-r.height-8))+'px';
    const outside=(e:Event)=>{if(!menu.contains(e.target as Node))this.close(false);};
    const resize=()=>this.close(false);
    document.addEventListener('pointerdown',outside,true);document.addEventListener('scroll',outside,true);
    window.addEventListener('resize',resize);
    this.handlers=[()=>document.removeEventListener('pointerdown',outside,true),()=>document.removeEventListener('scroll',outside,true),()=>window.removeEventListener('resize',resize)];
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});
  }
  close(restore=true){
    this.node?.remove();this.node=null;this.handlers.forEach(f=>f());this.handlers=[];
    if(restore&&this.previous?.isConnected)this.previous.focus({preventScroll:true});
  }
}
