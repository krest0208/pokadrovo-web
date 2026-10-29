import { Asset, Caption, Clip, History, Mode, Project, Ratio, Selection, clamp, clone, clock, currentClip, cutRange, dimensions, fromAsset, length, normalizeCaption, normalizeClip, normalizeProject, parseSrt, patchClip, positions, splitClip, totalLength, uid, videoLength, visibleClips } from './model';
import { download, inspectFile, persistAsset, saveProject,localSavePending,unsavedAssets,retryAssetWrites,requestPersistentStorage } from './assets';
import {downloadProjectBackup,importProjectBackup} from './project-backup';
import { restoreProjectAssets } from './media-recovery';
import { storageScope } from '../account/api';
import { PlaybackEngine, exportFormats, exportProject } from './engine';
import { t } from './copy';
import { brandSvg } from '../brand';
import { EditorTools } from './tools';
import { EditorTour } from './tour';
import {hitsMedia} from './geometry';
import {TimelineThumbnails} from './timeline-thumbnails';
import {TimelineNavigation,freeOverlayLayer} from './timeline-navigation';
import type { AiProvider } from './ai';
import {createThemeIconMotion,themeAction,themeIconMarkup} from '../motion/theme-icon';
export const escapeHtml=(s:unknown)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const paths:Record<string,string>={
 help:'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',home:'m3 10 9-7 9 7v11h-6v-7H9v7H3Z',video:'M3 5h13v14H3Zm13 5 5-4v12l-5-4',audio:'M9 18V4l12-2v14M9 8l12-2M9 18a3 3 0 1 1-3-3h3M21 16a3 3 0 1 1-3-3h3',text:'M4 4h16M12 4v16M8 20h8',
 upload:'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5',save:'M4 3h13l4 4v14H3V3h1Zm3 0v6h9V3M7 21v-8h10v8',download:'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4',
 play:'m8 4 12 8L8 20Z',pause:'M8 4v16M16 4v16',left:'m15 4-8 8 8 8',right:'m9 4 8 8-8 8',split:'M8 8 20 20M8 16 20 4M4 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 13a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
 trash:'M3 6h18M9 6V3h6v3M5 6v15h14V6M10 10v7M14 10v7',copy:'M8 8h13v13H8ZM3 16V3h13',undo:'m8 3-6 6 6 6M3 9h10a7 7 0 0 1 7 7v3',redo:'m16 3 6 6-6 6M21 9H11a7 7 0 0 0-7 7v3',
 expand:'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5',close:'m5 5 14 14M5 19 19 5',sun:'M12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M20 4l-2 2M6 18l-2 2M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',moon:'M21 14A9 9 0 0 1 10 3 9 9 0 1 0 21 14Z',
 plus:'M12 4v16M4 12h16',layers:'m3 7 9-4 9 4-9 4-9-4m0 5 9 4 9-4M3 17l9 4 9-4',settings:'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',check:'m4 12 5 5L20 6',
};
export const icon=(name:string,size=17)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.video}"/></svg>`;
export const brand = brandSvg;
const button=(action:string,label:string,glyph='',cls='',extra='')=>`<button type="button" data-action="${action}" class="${cls}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" ${extra}>${glyph?icon(glyph):''}${cls.includes('square')?'':`<span>${escapeHtml(label)}</span>`}</button>`;
export interface EditorOptions { aiProvider?:AiProvider; project:Project; assets:Map<string,Asset>; theme:'light'|'dark'; onHome:(project:Project)=>void; onSave:(project:Project)=>void; onTheme:()=>void; }
export class Editor {
 public history:History;public selected:Selection|null=null;public cursor=0;public tab:'media'|'audio'|'text'='media';
 private tools:EditorTools;private tour:EditorTour;private thumbnails:TimelineThumbnails;private navigation:TimelineNavigation;
 private themeMotion:ReturnType<typeof createThemeIconMotion>;
 private inspectorGroups=new Map<string,boolean>();
 private engine:PlaybackEngine;private disposed=false;private loading=false;private exporting=false;private abort:AbortController|null=null;
 private overlayRows=1;private importLayer=0;
 private backupBusy=false;private relinkId='';
 private zoom=1;private markIn=0;private markOut=0;private expanded='';private lastFocus:HTMLElement|null=null;private resize:ResizeObserver;
 private cleanups:(()=>void)[]=[];private statusTimer:ReturnType<typeof setTimeout>|null=null;private prep=0;private safe=false;private exportUrl='';
 private readonly account=storageScope();private autosaveTimer:ReturnType<typeof setTimeout>|null=null;private importing=false;private pendingName:string|null=null;
 constructor(private root:HTMLElement,private opts:EditorOptions){
  this.history=new History(normalizeProject(opts.project));this.root.className='pe';this.root.dataset.theme=opts.theme;this.root.dataset.mobile='player';
  this.root.innerHTML=`<header class="pe-top"><div class="pe-brand"><button type="button" class="pe-brand-home" data-action="home" aria-label="Покадрово: на главную" title="На главную">${brand(33,true)}<b>${t.brand}</b></button><i></i><input id="pe-name" data-project="name" aria-label="${t.newProject}" maxlength="120"/></div><div class="pe-modes" role="group" aria-label="${t.regular} / Reels">${button('mode-video',t.regular)}${button('mode-reels',t.reels)}</div><div class="pe-actions">${button('help','Обучение','help','square pe-help')}<button type="button" data-action="theme" class="square pk-theme-control" title="${themeAction(opts.theme)}" aria-label="${themeAction(opts.theme)}"><span class="pk-theme-icon" data-theme="${opts.theme}" aria-hidden="true">${themeIconMarkup()}</span></button>${button('save',t.save,'save')}${button('export',t.export,'download','primary')}</div></header>
  <div class="pe-brief" hidden></div>
  <nav class="pe-mobile-nav" aria-label="Панели монтажёра">${['library','player','inspector','timeline'].map((v,i)=>button('mobile-'+v,[t.files,t.preview,t.settings,t.timeline][i],['video','play','settings','layers'][i])).join('')}</nav>
  <div class="pe-layout">
   <nav class="pe-rail" aria-label="Инструменты">${button('tab-media',t.media,'video')}${button('tab-audio',t.audio,'audio')}${button('tab-text',t.text,'text')}</nav>
   <section class="pe-panel pe-library" data-panel="library"><header>${t.files}${button('expand-library',t.expand,'expand','square')}</header><div class="pe-library-body"></div></section>
   <section class="pe-panel pe-player" data-panel="player"><header><span>${t.preview}</span><span class="pe-player-meta"></span>${button('expand-player',t.expand,'expand','square')}</header><div class="pe-player-options"><select data-project="ratio" aria-label="Формат кадра">${['16:9','9:16','1:1','4:5'].map(v=>`<option>${v}</option>`).join('')}</select><label><input type="checkbox" data-ui="safe"/> ${t.safe}</label>${button('expand-player',t.expand,'expand','square pe-view-expand')}</div><div class="pe-viewport"><div class="pe-screen"><canvas tabindex="0" role="button" aria-label="Выбрать клип в кадре для редактирования" title="Нажмите на видео, чтобы редактировать"></canvas><div class="pe-safe" hidden><span>9:16 / ${t.safe}</span></div><div class="pe-empty">${brand()}<h3>${t.empty}</h3><p>${t.emptyHint}</p>${button('import',t.import,'upload','primary')}</div></div></div><div class="pe-transport"><output class="pe-time">00:00.000</output><div>${button('back','Назад на секунду','left','square')}${button('play',t.play,'play','pe-play square')}${button('forward','Вперёд на секунду','right','square')}</div><output class="pe-duration">00:00.000</output></div></section>
   <section class="pe-panel pe-inspector" data-panel="inspector"><header>${t.settings}${button('expand-inspector',t.expand,'expand','square')}</header><div class="pe-inspector-body"></div></section>
  </div>
  <section class="pe-panel pe-timeline" data-panel="timeline"><header><strong>${t.timeline}</strong><div class="pe-tools">${button('undo',t.undo,'undo','square')}${button('redo',t.redo,'redo','square')}<i></i>${button('add-layer','Добавить слой','layers')}${button('split',t.split+' (S)','split')}${button('duplicate',t.duplicate,'copy','square')}${button('delete',t.remove,'trash','square')}</div><label class="pe-zoom" title="Колёсико над дорожками: масштаб. Shift + колёсико: прокрутка по времени. Над названиями дорожек: прокрутка вверх и вниз.">${t.zoom}<input type="range" min=".35" max="3" step=".0001" value="1" data-ui="zoom" aria-valuetext="100%" aria-label="${t.zoom}"/></label>${button('expand-timeline',t.expand,'expand','square')}</header><div class="pe-track-scroll"><div class="pe-track-grid"><div class="pe-track-labels"></div><div class="pe-track-content"></div></div></div><details class="pe-range-panel"><summary>Вырезать диапазон</summary><div class="pe-range">${button('mark-in',t.markIn)}<output id="pe-in">00:00.000</output>${button('mark-out',t.markOut)}<output id="pe-out">00:00.000</output>${button('cut',t.cut,'split')}<span>${t.selectionRange}</span></div></details></section>
  <footer class="pe-footer"><span role="status" class="pe-status">${t.ready}</span><span class="pe-save-state" role="status" aria-live="polite">Автосохранение</span><span>${t.shortcuts}</span></footer>
  <input class="pe-file-input" type="file" accept="video/*,image/*,audio/*" multiple hidden/><input class="pe-srt-input" type="file" accept=".srt,text/plain" hidden/><input class="pe-json-input" type="file" accept=".pokadrovo,.json,application/json,application/x-pokadrovo-project" hidden/><input class="pe-relink-input" type="file" accept="video/*,image/*,audio/*" hidden/>
  <div class="pe-panel-shade" hidden></div><div class="pe-modal" hidden></div>`;
  this.themeMotion=createThemeIconMotion(this.$('.pk-theme-icon'),opts.theme);this.cleanups.push(()=>this.themeMotion.dispose());
  this.engine=new PlaybackEngine(this.$('canvas'),opts.assets,(time,playing)=>this.updateCursor(time,playing),e=>this.fail(e));
  this.thumbnails=new TimelineThumbnails(this.$('.pe-track-content'),this.$('.pe-track-scroll'),opts.assets);
  this.navigation=new TimelineNavigation(this.$('.pe-track-scroll'),this.$('.pe-track-labels'),()=>this.zoom,zoom=>{this.zoom=zoom;const slider=this.$<HTMLInputElement>('[data-ui="zoom"]');slider.value=String(zoom);slider.setAttribute('aria-valuetext',Math.round(zoom*100)+'%');this.renderTimeline();},()=>this.disposed||this.exporting||!!this.tour?.active);
  this.tools=new EditorTools({
    root:this.root,canvas:this.engine.canvas,assets:this.opts.assets,provider:this.opts.aiProvider,
    project:()=>this.project,selected:()=>this.selected,cursor:()=>this.cursor,
    busy:()=>this.loading||this.exporting,playing:()=>this.engine.playing,pause:()=>this.engine.pause(),
    select:(selected,time)=>{
      this.engine.pause();this.selected=selected;
      this.cursor=time??this.selectedAt();this.renderInspector();this.renderTimeline();
      void this.seek(this.cursor);this.tools?.sync();
    },
    seek:time=>{void this.seek(time);},commit:(p,message)=>this.commit(p,message),
    preview:p=>this.engine.preview(p),run:action=>this.runAction(action),
    status:message=>this.status(message),refresh:()=>this.render()
  });
  this.listen(this.root,'click',e=>this.click(e));this.listen(this.root,'change',e=>this.change(e));this.listen(this.root,'input',e=>this.input(e));
  this.listen(this.root,'pointerdown',e=>this.pointer(e as PointerEvent));this.listen(this.root,'dragstart',e=>this.dragStart(e as DragEvent));
  this.listen(this.root,'dragover',e=>{if((e.target as Element).closest('.pe-library,.pe-timeline'))e.preventDefault();});this.listen(this.root,'drop',e=>this.drop(e as DragEvent));
  this.listen(document,'keydown',e=>this.key(e as KeyboardEvent));
  this.listen(window,'pagehide',()=>this.save(false));
  this.listen(window,'pokadrovo:before-account-change',()=>this.save(false));
  this.listen(document,'visibilitychange',()=>{if(document.visibilityState==='hidden')this.save(false);});
  this.listen(window,'beforeunload',e=>{if(storageScope()!==this.account)return;this.save(false);if(this.importing||this.backupBusy||unsavedAssets(this.account)||localSavePending(this.project.id)){e.preventDefault();(e as BeforeUnloadEvent).returnValue='';}});
  for(const event of ['pokadrovo:project-storage','pokadrovo:sync-status'])this.listen(window,event,e=>{const d=(e as CustomEvent).detail;if(d?.account!==this.account||d.id!==this.project.id||this.disposed)return;const badge=this.$('.pe-save-state');badge.dataset.state=d.state;badge.textContent=d.state==='saving'?'Сохраняю…':d.state==='error'?'Не сохранено':d.state==='offline'?'На устройстве':unsavedAssets(this.account)?'Исходники не сохранены':'Сохранено';badge.title=d.message;if(d.state==='error'||d.state==='offline')this.status(d.message);});
  this.listen(window,'pokadrovo:project-fork',e=>{const d=(e as CustomEvent).detail;if(d.account!==this.account||d.oldId!==this.project.id)return;this.history=new History(normalizeProject({...this.project,id:d.project.id,name:d.project.name}));this.save(false);this.render();this.status('Проект изменён в другом месте. Ваш монтаж открыт отдельной копией.');});
  this.resize=new ResizeObserver(()=>this.fitCanvas());this.resize.observe(this.$('.pe-viewport'));
  this.render();void this.restore();
  this.tour=new EditorTour(this.root,this.account,panel=>this.showPanel(panel),()=>this.engine.pause());
 }
 get project(){return this.history.value;}
 flushPendingChanges(){this.save(false);return this.project;}
 private $<T extends HTMLElement=HTMLElement>(q:string){return this.root.querySelector<T>(q)!;}
 private listen(target:EventTarget,event:string,fn:(e:Event)=>void){target.addEventListener(event,fn);this.cleanups.push(()=>target.removeEventListener(event,fn));}
 setTheme(theme:'light'|'dark'){this.root.dataset.theme=theme;this.themeMotion.update(theme);const toggle=this.$<HTMLButtonElement>('[data-action="theme"]');toggle.title=toggle.ariaLabel=themeAction(theme);}
 private status(message:string){if(!this.disposed)this.$('.pe-status').textContent=message;}
 private fail(e:unknown){this.status(t.error+': '+(e instanceof Error?e.message:String(e)));}
 private async restore(){
  this.loading=true;this.status(t.loading+'...');
  let missing:string[]=[];
  try{missing=await restoreProjectAssets(this.project,this.opts.assets,()=>!this.disposed&&storageScope()===this.account);if(!missing.length)this.status(t.ready);}
  catch(e){this.fail(e);}finally{this.loading=false;if(!this.disposed){this.render();await this.prepare();if(missing.length)this.status('Не удалось восстановить файлы: '+missing.join(', ')+'. Остальные исходники загружены. Добавьте недостающие файлы повторно.');}}
 }
 async importFiles(files:FileList|File[]|null,layer=0,at=this.cursor){if(!files?.length||this.exporting||this.importing||this.disposed)return;void requestPersistentStorage();this.engine.pause();this.loading=true;this.importing=true;let added=0;let storageFailed=false;const problems:string[]=[];
  for(const file of Array.from(files)){if(this.disposed)break;try{
   this.status(`${t.loading}: ${file.name}`);const a=await inspectFile(file);if(this.disposed||storageScope()!==this.account){URL.revokeObjectURL(a.url);break;}
   try{await persistAsset(a);}catch{storageFailed=true;}
   if(this.disposed||storageScope()!==this.account){URL.revokeObjectURL(a.url);break;}
   this.opts.assets.set(a.id,a);const next=clone(this.project);
   next.sources.push({id:a.id,name:a.name,kind:a.kind,size:a.blob.size});
   const c=fromAsset(a);if(a.kind==='audio'){c.at=at;next.audio.push(c);this.selected={track:'audio',id:c.id};}else{if(layer>0){c.layer=layer;c.at=at;c.zoom=.4;c.x=25;c.y=20;}next.clips.push(c);this.selected={track:'video',id:c.id};}added++;
   this.history.commit(next);this.save(false);this.render();
  }catch(e){problems.push(file.name+': '+(e instanceof Error?e.message:String(e)));}}
  this.loading=false;this.importing=false;if(added&&!this.disposed){await this.prepare();if(layer>0){this.showPanel('timeline');this.$('.pe-track-scroll').scrollTop=0;}}
  if(storageFailed&&!this.disposed){const badge=this.root?.querySelector('.pe-save-state');if(badge){badge.textContent='Исходники не сохранены';(badge as HTMLElement).dataset.state='error';}}
  this.status(problems.length?problems.join('; '):storageFailed?'Не удалось сохранить исходники. Нажмите «Сохранить» для повтора или скачайте полную копию перед выходом.':`${t.files}: ${added} / ${t.ready}`);
 }
 private async prepare(){const rev=++this.prep;this.loading=true;
  try{const [w,h]=dimensions(this.project.ratio);this.engine.canvas.width=w;this.engine.canvas.height=h;await this.engine.prepare(this.project);if(rev===this.prep&&!this.disposed)this.fitCanvas();}
  catch(e){if(!this.disposed&&rev===this.prep)this.fail(e);}finally{if(rev===this.prep){this.loading=false;this.tools?.sync();}}
 }
 private async relinkSource(file:File,id:string){
  if(this.importing||this.backupBusy||this.loading)return;const source=this.project.sources.find(s=>s.id===id);if(!source)return;
  this.importing=true;let asset:Asset|undefined;
  try{
   asset=await inspectFile(file,id);
   const required=Math.max(0,...[...this.project.clips,...this.project.audio].filter(c=>c.assetId===id).map(c=>c.end));
   if(asset.kind!==source.kind&&!(source.kind==='audio'&&asset.kind==='video')||asset.kind!=='image'&&asset.duration+.1<required||source.size>0&&file.size!==source.size)throw Error('Выбран другой исходник. Проверьте имя, размер и длительность файла.');
   if(this.disposed||storageScope()!==this.account){URL.revokeObjectURL(asset.url);return;}
   await persistAsset(asset);if(this.disposed||storageScope()!==this.account){URL.revokeObjectURL(asset.url);return;}
   const old=this.opts.assets.get(id);if(old)URL.revokeObjectURL(old.url);this.opts.assets.set(id,asset);asset=undefined;
   this.save(false);this.render();await this.prepare();this.status('Исходник восстановлен. Все склейки и настройки сохранены.');
  }catch(e){if(asset)URL.revokeObjectURL(asset.url);this.fail(e);}finally{this.importing=false;}
 }
 private commit(p:Project,message=t.ready){if(typeof this.pendingName==='string'){p.name=this.pendingName;this.pendingName=null;}this.engine.pause();this.history.commit(p);this.cacheChange();this.cursor=Math.min(this.cursor,totalLength(this.project));this.render();void this.prepare();this.status(message);}
 private cacheChange(){
  if(this.disposed||storageScope()!==this.account)return;
  try{saveProject(this.project,false);this.opts.onSave(clone(this.project));}catch{this.status(t.storageError);}
  if(this.autosaveTimer)clearTimeout(this.autosaveTimer);
  this.autosaveTimer=setTimeout(()=>this.save(false),500);
 }
 private flushProjectName(){if(typeof this.pendingName!=='string')return;const name=this.pendingName;this.pendingName=null;if(name===this.project.name)return;const p=clone(this.project);p.name=name;this.history.commit(p);}
 private save(notify=true){this.flushProjectName();if(this.autosaveTimer){clearTimeout(this.autosaveTimer);this.autosaveTimer=null;}if(storageScope()!==this.account)return;try{saveProject(this.project);this.opts.onSave(clone(this.project));if(notify)this.status(t.saved);}catch{this.status(t.storageError);}}
 private updateCursor(time:number,playing:boolean){
  this.cursor=time;if(this.disposed)return;
  this.$('.pe-time').textContent=clock(time);this.$('.pe-duration').textContent=clock(totalLength(this.project));const head=this.root.querySelector<HTMLElement>('.pe-head');if(head)head.style.left=(time*this.pixels())+'px';
  const b=this.$<HTMLButtonElement>('[data-action="play"]');b.innerHTML=icon(playing?'pause':'play',18);b.title=b.ariaLabel=playing?t.pause:t.play;
  this.tools?.sync();
 }
 private fitCanvas(){if(this.disposed)return;const viewport=this.$('.pe-viewport'),screen=this.$('.pe-screen');const rect=viewport.getBoundingClientRect(),[x,y]=this.project.ratio.split(':').map(Number),ratio=x/y;
  const w=Math.max(1,Math.min(rect.width-32,(rect.height-24)*ratio));screen.style.width=w+'px';screen.style.height=(w/ratio)+'px';this.tools?.sync();
 }
 private showPanel(panel:string){this.root.dataset.mobile=panel;this.root.querySelectorAll<HTMLElement>('.pe-mobile-nav [data-action]').forEach(n=>n.setAttribute('aria-pressed',String(n.dataset.action==='mobile-'+panel)));requestAnimationFrame(()=>{if(!this.disposed)this.fitCanvas();});}
 private selectPreview(event?:MouseEvent){
  if(this.loading||this.exporting||this.tour?.active)return;
  const visible=visibleClips(this.project,Math.min(this.cursor,Math.max(0,totalLength(this.project)-.001))).reverse();
  const rect=event?this.engine.canvas.getBoundingClientRect():null;
  const active=event&&rect?visible.find(({clip})=>{const asset=this.opts.assets.get(clip.assetId);return asset&&hitsMedia(clip,asset,(event.clientX-rect.left)*this.engine.canvas.width/rect.width,(event.clientY-rect.top)*this.engine.canvas.height/rect.height,this.engine.canvas.width,this.engine.canvas.height);}):visible[0];
  if(!active)return;this.engine.pause();this.selected={track:'video',id:active.clip.id};
  this.renderInspector();this.renderTimeline();this.tools.sync();
  if(window.matchMedia('(max-width: 900px)').matches)this.showPanel('inspector');
 }
 private selectedItem():Clip|Caption|undefined{if(!this.selected)return;return this.selected.track==='text'?this.project.texts.find(c=>c.id===this.selected!.id):(this.selected.track==='video'?this.project.clips:this.project.audio).find(c=>c.id===this.selected!.id);}
 private selectedAt():number{const s=this.selected;if(!s)return 0;if(s.track==='video')return positions(this.project).find(c=>c.clip.id===s.id)?.at||0;if(s.track==='audio')return this.project.audio.find(c=>c.id===s.id)?.at||0;return this.project.texts.find(c=>c.id===s.id)?.from||0;}
 private changeSelected(patch:Partial<Clip>&Partial<Caption>){const sel=this.selected;if(!sel)return;const p=clone(this.project);
  if(sel.track==='text'){p.texts=p.texts.map(c=>c.id===sel.id?normalizeCaption({...c,...patch}):c);}else {const arr=sel.track==='video'?'clips':'audio';p[arr]=p[arr].map(c=>c.id===sel.id?patchClip(c,patch):c);}this.commit(p);
 }
 private render(){if(this.disposed)return;
  const active=document.activeElement as HTMLInputElement|null;const key=active?.dataset.field;const selection=active&&'selectionStart' in active?active.selectionStart:null;
  const nameInput=this.$<HTMLInputElement>('#pe-name'),name=this.pendingName??this.project.name;if(nameInput.value!==name)nameInput.value=name;this.$<HTMLSelectElement>('[data-project="ratio"]').value=this.project.ratio;
  this.$('[data-action="mode-video"]').classList.toggle('active',this.project.mode==='video');this.$('[data-action="mode-reels"]').classList.toggle('active',this.project.mode==='reels');
  this.$('[data-action="mode-video"]').setAttribute('aria-pressed',String(this.project.mode==='video'));this.$('[data-action="mode-reels"]').setAttribute('aria-pressed',String(this.project.mode==='reels'));
  for(const name of ['media','audio','text'])this.$(`[data-action="tab-${name}"]`).classList.toggle('active',this.tab===name);
  this.$('.pe-player-meta').textContent=this.project.ratio;
  this.$('.pe-empty').hidden=!!this.project.clips.length;this.$('.pe-safe').hidden=!this.safe;
  this.$('.pe-brief').hidden=true;this.$('.pe-brief').textContent=this.project.brief?`${t.brief}: ${this.project.brief}`:'';
  this.$<HTMLButtonElement>('[data-action="undo"]').disabled=!this.history.canUndo;this.$<HTMLButtonElement>('[data-action="redo"]').disabled=!this.history.canRedo;
  this.$<HTMLButtonElement>('[data-action="export"]').disabled=!totalLength(this.project);
  for(const action of ['split','duplicate','delete'])this.$<HTMLButtonElement>(`[data-action="${action}"]`).disabled=!this.selectedItem();
  this.showPanel(this.root.dataset.mobile||'player');
  this.renderLibrary();this.renderInspector();this.renderTimeline();this.updateCursor(this.cursor,false);this.fitCanvas();
  if(key){const replacement=this.root.querySelector<HTMLInputElement>(`[data-field="${key}"]`);replacement?.focus({preventScroll:true});try{if(selection!==null)replacement?.setSelectionRange(selection,selection);}catch{}}
 }
 private renderLibrary(){
  let html=button('import',t.import,'upload','primary pe-import')+`<p class="pe-note">${t.importHint}</p>`;
  if(this.tab==='media')html=button('import',t.import,'upload','primary pe-import')+button('overlay-new','Добавить поверх','layers','pe-import pe-overlay-import')+`<p class="pe-note">${t.importHint}</p>`;
  if(this.tab==='text')html=button('add-text',t.addText,'plus','primary pe-import')+button('srt',t.srt,'upload','pe-import')+`<p class="pe-note">SRT / ${t.text}</p>`;
  if(this.tab!=='text'){
   const arr=[...this.opts.assets.values()].filter(a=>this.tab==='audio'?a.kind==='audio':a.kind!=='audio');
   html+='<div class="pe-asset-grid">'+arr.map(a=>`<div class="pe-asset-card"><button type="button" class="pe-asset" draggable="true" data-asset="${escapeHtml(a.id)}" title="${escapeHtml(a.name)}"><span>${a.thumbnail?`<img src="${a.thumbnail}" alt="" draggable="false"/>`:icon(a.kind==='audio'?'audio':'video',30)}<i>${clock(a.duration).slice(0,5)}</i></span><b>${escapeHtml(a.name)}</b><small>${a.kind==='audio'?'Аудио':a.kind==='image'?'Фото':'Видео'}</small></button>${a.kind!=='audio'?`<button type="button" class="pe-asset-overlay" data-overlay-asset="${escapeHtml(a.id)}" aria-label="${escapeHtml('Добавить '+a.name+' поверх видео')}">${icon('layers',12)}<span>Поверх видео</span></button>`:''}</div>`).join('')+'</div>';
   if(!arr.length)html+='<div class="pe-none"><h3>Пока нет файлов</h3><p>Добавьте материалы кнопкой выше.</p></div>';
  }else html+=this.project.texts.map(c=>`<button class="pe-caption-item" data-select="text:${c.id}">${icon('text')}<span>${escapeHtml(c.text||t.text)}</span></button>`).join('');
  const missing=this.project.sources.filter(s=>!this.opts.assets.has(s.id));
  if(missing.length)html+=`<div class="pe-missing-sources" role="status"><strong>Нужно восстановить исходники</strong>${missing.map(s=>`<button type="button" data-relink="${escapeHtml(s.id)}">Найти файл: ${escapeHtml(s.name)}</button>`).join('')}</div>`;
  html+=`<details class="pe-project-tools"><summary>Файл проекта</summary>${button('backup-export','Скачать полную копию')}${button('json-import','Открыть копию проекта')}${button('json-export','Скачать только монтаж (JSON)')}<p class="pe-note">Полная копия включает монтаж и все исходники. Её можно открыть на другом устройстве.</p></details>`;
  this.$('.pe-library-body').innerHTML=html;
 }
 private number(label:string,field:string,value:number,min:number,max:number,step=.1){return `<label class="pe-field">${label}<input data-field="${field}" aria-label="${label}" type="number" min="${min}" max="${max}" step="${step}" value="${Number(value.toFixed(3))}"/></label>`;}
 private range(label:string,field:string,value:number,min:number,max:number,step=.05,suffix=''){return `<label class="pe-field pe-slider">${label}<output data-value="${field}">${Number(value.toFixed(2))}${suffix}</output><input data-field="${field}" aria-label="${label}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"/></label>`;}
 private renderInspector(){
  const item=this.selectedItem();let html='';
  if(!item){html=`<div class="pe-none">${icon('settings',32)}<h3>${t.choose}</h3><p>${t.chooseHint}</p></div><h4>${t.settings}</h4><div class="pe-meta-row">${t.duration}<b>${clock(totalLength(this.project))}</b></div>`;}
  else if(this.selected!.track==='text'){
   const c=item as Caption;html=`<h4>${t.text}</h4><textarea data-field="text" aria-label="${t.text}" rows="3" maxlength="1200">${escapeHtml(c.text)}</textarea><div class="pe-pair">${this.number(t.start,'from',c.from,0,86400)}${this.number(t.end,'to',c.to,c.from+.04,86400)}</div>${this.range(t.fontSize,'size',c.size,.015,.2,.005)}<div class="pe-pair">${this.number('X','x',c.x,0,1,.01)}${this.number('Y','y',c.y,0,1,.01)}</div><label class="pe-field">${t.color}<input type="color" data-field="color" aria-label="${t.color}" value="${c.color}"/></label><label class="pe-check"><input type="checkbox" data-field="background" ${c.background?'checked':''}/> ${t.background}</label>`;
  }else{
   const c=item as Clip,isAudio=this.selected!.track==='audio';
   html=`<div class="pe-selected-file">${icon(isAudio?'audio':'video',23)}<span><small>${isAudio?t.audio:t.selected}</small><b title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</b></span></div><h4>${t.trim}</h4><div class="pe-pair">${this.number(t.start,'start',c.start,0,c.end-.04)}${this.number(t.end,'end',c.end,c.start+.04,c.kind==='image'?600:c.duration)}</div>`;
   if(isAudio||c.layer>0)html+=this.number(t.at,'at',c.at,0,86400);
   if(!isAudio)html+=this.number('Слой (0: основное видео)','layer',c.layer,0,8,1);
   html+=`<div class="pe-pair pe-trim-actions">${button('trim-start',t.trimLeft,'split')}${button('trim-end',t.trimRight,'split')}</div>`;
   if(c.kind!=='image'){
    html+=`<h4>${t.speed}</h4>${this.range(t.speed,'speed',c.speed,.25,4,.05,'x')}<div class="pe-speeds">${[.5,1,1.5,2].map(v=>`<button data-speed="${v}" class="${c.speed===v?'active':''}">${v}x</button>`).join('')}</div><p class="pe-note">${t.duration}: ${length(c).toFixed(2)} s</p>`;
    html+=`<h4>${t.audio}</h4>${this.range(t.volume,'volume',c.volume,0,2,.05,'x')}<label class="pe-check"><input type="checkbox" data-field="muted" ${c.muted?'checked':''}/> ${t.mute}</label><div class="pe-pair">${this.number(t.fadeIn,'fadeIn',c.fadeIn,0,length(c))}${this.number(t.fadeOut,'fadeOut',c.fadeOut,0,length(c))}</div>`;
    if(!isAudio)html+=button('detach',t.detach,'audio','pe-full');
   }
   if(!isAudio){
    html+=`<h4>${t.transform}</h4><div class="pe-pair">${button('fit-contain',t.fit,'','',`aria-pressed="${c.fit==='contain'}"`)}${button('fit-cover',t.fill,'','',`aria-pressed="${c.fit==='cover'}"`)}</div>${this.range(t.zoom,'zoom',c.zoom,.25,4,.05)}<div class="pe-pair">${this.number('X (%)','x',c.x,-100,100,1)}${this.number('Y (%)','y',c.y,-100,100,1)}</div>${this.number(t.rotation,'rotation',c.rotation,-180,180,1)}<label class="pe-check"><input type="checkbox" data-field="flip" ${c.flip?'checked':''}/> ${t.flip}</label><h4>${t.color}</h4>${this.range(t.brightness,'brightness',c.brightness,0,2)}${this.range(t.contrast,'contrast',c.contrast,0,2)}${this.range(t.saturation,'saturation',c.saturation,0,2)}${this.range(t.opacity,'opacity',c.opacity,0,1)}<h4>${t.fadeVisual}</h4><div class="pe-pair">${this.number(t.visualIn,'visualIn',c.visualIn,0,5)}${this.number(t.visualOut,'visualOut',c.visualOut,0,5)}</div><h4>${t.selected}</h4><div class="pe-pair">${button('move-left',t.earlier,'left')}${button('move-right',t.later,'right')}</div>`;
   }
  }
  if(item)html+=button('delete',t.remove,'trash','pe-full pe-danger');
  html+=`<h4>${t.master}</h4><label class="pe-field pe-slider">${t.volume}<output>${Math.round(this.project.master*100)}%</output><input type="range" data-project="master" min="0" max="1" step=".01" value="${this.project.master}" aria-label="${t.master}"/></label>`;
  const host=this.$('.pe-inspector-body');
  host.querySelectorAll<HTMLDetailsElement>('.pe-inspector-group').forEach(n=>this.inspectorGroups.set(n.dataset.group!,n.open));
  host.innerHTML=html;this.tools?.enhanceInspector();
  const group=(title:string,nodes:Element[],defaultOpen=false)=>{
   const key=(this.selected?.track||'project')+':'+title,detail=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('div');
   detail.className='pe-inspector-group';detail.dataset.group=key;detail.open=this.inspectorGroups.get(key)??defaultOpen;
   summary.textContent=title;body.className='pe-group-body';detail.append(summary,body);nodes[0].before(detail);nodes.forEach(n=>body.append(n));
  };
  const extra=host.querySelector<HTMLElement>('.pe-extra-inspector');if(extra){const title=extra.querySelector('h4')!;const text=title.textContent||t.transform;title.remove();group(text,[extra],this.selected?.track==='text');}
  Array.from(host.children).filter(n=>n.tagName==='H4').forEach(heading=>{
   const nodes:Element[]=[heading];let next=heading.nextElementSibling;
   while(next&&next.tagName!=='H4'&&!next.matches('.pe-danger,.pe-inspector-group')){nodes.push(next);next=next.nextElementSibling;}
   group(heading.textContent||t.settings,nodes,heading.textContent===t.trim||heading.textContent===t.text);heading.remove();
  });
  const file=host.querySelector('.pe-selected-file');if(file)host.prepend(file);
  const remove=host.querySelector('[data-action="delete"]');if(remove)host.append(remove);
  for(const action of ['split','duplicate','delete'])this.$<HTMLButtonElement>(`.pe-tools [data-action="${action}"]`).disabled=!item;
 
 }
 private pixels(){return 62*this.zoom;}
 private renderTimeline(){
  const scale=this.pixels(),duration=totalLength(this.project),width=Math.max(620,this.$('.pe-track-scroll').clientWidth-105,(duration+1)*scale);
  const layers=Array.from({length:Math.max(this.overlayRows,...this.project.clips.map(c=>c.layer))},(_,i)=>i+1).reverse();
  const audioRows=Math.max(1,this.project.audio.length),textRows=Math.max(1,this.project.texts.length);
  const content=this.$('.pe-track-content');content.style.width=width+'px';
  this.$('.pe-track-labels').innerHTML=`<span>${t.tracks}</span>${layers.map(layer=>`<div class="pe-label-video">${icon('layers',14)}Слой ${layer}</div>`).join('')}<div class="pe-label-video">${icon('video',14)}${t.videoTrack}</div>${Array.from({length:audioRows},(_,i)=>`<div class="pe-label-audio">${icon('audio',14)}${t.audioTrack} ${i+1}</div>`).join('')}${Array.from({length:textRows},(_,i)=>`<div class="pe-label-text">${icon('text',14)}${t.text} ${i+1}</div>`).join('')}`;
  const tickStep=this.zoom>=1?1:2;const ticks=Array.from({length:Math.ceil(width/scale/tickStep)},(_,i)=>`<span style="left:${i*tickStep*scale}px">${clock(i*tickStep).slice(0,5)}</span>`).join('');
  const draw=(track:'video'|'audio'|'text',id:string,name:string,at:number,d:number,clip?:Clip)=>{
   const kind=track==='video'&&clip?.kind==='image'?'image':track,asset=clip?this.opts.assets.get(clip.assetId):undefined;
   const strip=track==='video'&&clip&&asset?`<span class="pe-filmstrip" aria-hidden="true" data-asset-id="${escapeHtml(asset.id)}" data-source-start="${clip.start}" data-source-end="${clip.end}"${asset.thumbnail?` style="background-image:url('${asset.thumbnail}')"`:''}></span>`:'';
   const label=kind==='image'?'Фото':track==='video'?'Видео':track==='audio'?'Аудио':'Текст';
   return `<button class="pe-clip ${track} ${kind==='image'?'image ':''}${this.selected?.id===id?'selected':''}" type="button" draggable="true" data-kind="${kind}" data-select="${track}:${id}" data-track="${track}" data-clip="${id}" style="left:${at*scale}px;width:${Math.max(3,d*scale)}px" title="${escapeHtml(label+': '+name)}"><i data-resize="start"></i>${strip}<span class="pe-clip-label">${icon(track==='audio'?'audio':track==='text'?'text':'video',12)}<b>${escapeHtml(name)}</b></span><small class="pe-clip-duration">${d.toFixed(1)} s</small><i data-resize="end"></i></button>`;
  };
  content.innerHTML=`<div class="pe-ruler" data-seek="true">${ticks}</div>`+layers.map(layer=>{const clips=positions(this.project).filter(c=>c.clip.layer===layer);return `<div class="pe-time-row pe-video-row pe-overlay-row" data-drop="video" data-layer="${layer}">${clips.map(({clip,at})=>draw('video',clip.id,clip.name,at,length(clip),clip)).join('')}<button type="button" class="pe-layer-add ${clips.length?'':'pe-layer-empty'}" data-action="overlay-import-${layer}" title="Добавить фото или видео на слой ${layer}" aria-label="Добавить фото или видео на слой ${layer}">${icon('plus',14)}${clips.length?'':'<span>Фото или видео поверх</span>'}</button></div>`;}).join('')+`<div class="pe-time-row pe-video-row" data-drop="video" data-layer="0">${positions(this.project).filter(c=>!c.clip.layer).map(({clip,at})=>draw('video',clip.id,clip.name,at,length(clip),clip)).join('')}${!this.project.clips.length?`<button class="pe-track-add" data-action="import">${icon('plus',15)} ${t.emptyHint}</button>`:''}</div>`+
   (this.project.audio.length?this.project.audio.map(c=>`<div class="pe-time-row pe-audio-row" data-drop="audio">${draw('audio',c.id,c.name,c.at,length(c))}</div>`).join(''):`<div class="pe-time-row pe-audio-row" data-drop="audio"><button class="pe-track-add" data-action="tab-audio">${t.audio}: ${t.import}</button></div>`)+
   (this.project.texts.length?this.project.texts.map(c=>`<div class="pe-time-row pe-text-row" data-drop="text">${draw('text',c.id,c.text,c.from,c.to-c.from)}</div>`).join(''):`<div class="pe-time-row pe-text-row" data-drop="text"><button class="pe-track-add" data-action="add-text">${t.addText}</button></div>`)+`<div class="pe-head" style="left:${this.cursor*scale}px;height:${(1+layers.length)*72+(audioRows+textRows)*58+25}px"><span></span></div>`;
  this.thumbnails.refresh();
  this.$<HTMLButtonElement>('[data-action="add-layer"]').disabled=layers.length>=8;
  this.$('#pe-in').textContent=clock(this.markIn);this.$('#pe-out').textContent=clock(this.markOut);this.$<HTMLButtonElement>('[data-action="cut"]').disabled=Math.abs(this.markIn-this.markOut)<.04;
 }
 private async seek(time:number){if(this.loading||this.exporting)return;try{await this.engine.seek(clamp(time,0,totalLength(this.project)));}catch(e){this.fail(e);}}
 private select(track:string,id:string){if(!['video','audio','text'].includes(track))return;this.engine.pause();this.selected={track:track as Selection['track'],id};this.cursor=this.selectedAt();this.renderInspector();this.renderTimeline();void this.seek(this.cursor);}
 private overlaySlot(){const layer=freeOverlayLayer(this.project.clips);if(layer===null)this.status('Все 8 слоёв заняты. Добавьте файл на одну из существующих дорожек.');return layer;}
 private placeAsset(asset:Asset,layer=0,at=this.cursor){
  if(this.exporting||this.loading||this.disposed||layer>0&&asset.kind==='audio')return;
  const p=clone(this.project),c=fromAsset(asset);
  if(asset.kind==='audio'){c.at=at;p.audio.push(c);}else{if(layer>0){c.layer=layer;c.at=at;c.zoom=.4;c.x=25;c.y=20;this.overlayRows=Math.max(this.overlayRows,layer);}p.clips.push(c);}
  this.selected={track:asset.kind==='audio'?'audio':'video',id:c.id};this.commit(p);
  if(layer>0){this.showPanel('timeline');this.$('.pe-track-scroll').scrollTop=0;}
 }
 private click(e:Event){const target=e.target as Element;if(target===this.engine.canvas){this.selectPreview(e as MouseEvent);return;}if(target.matches('.pe-panel-shade')&&this.expanded){this.expand(this.expanded);return;}const sel=target.closest<HTMLElement>('[data-select]');if(sel&&!target.closest('[data-resize]')){const [track,id]=sel.dataset.select!.split(':');this.select(track,id);return;}
  const overlay=target.closest<HTMLElement>('[data-overlay-asset]');if(overlay){const a=this.opts.assets.get(overlay.dataset.overlayAsset!),layer=this.overlaySlot();if(a&&layer!==null)this.placeAsset(a,layer);return;}
  const asset=target.closest<HTMLElement>('[data-asset]');if(asset){const a=this.opts.assets.get(asset.dataset.asset!);if(a)this.placeAsset(a);return;}
  const speed=target.closest<HTMLElement>('[data-speed]');if(speed){this.changeSelected({speed:Number(speed.dataset.speed)});return;}
  const relink=target.closest<HTMLElement>('[data-relink]');if(relink){this.relinkId=relink.dataset.relink!;this.$<HTMLInputElement>('.pe-relink-input').click();return;}
  const action=target.closest<HTMLElement>('[data-action]')?.dataset.action;if(!action)return;
  this.runAction(action);
 }
 private runAction(action:string){this.flushProjectName();
  if(this.exporting&&action!=='cancel-export')return;
  this.tools?.beforeAction(action);
  if(action==='home'){this.engine.pause();this.save(false);this.opts.onHome(clone(this.project));return;}
  if(action==='help'){if(!this.$('.pe-modal').hidden||this.expanded)return;this.tour.start();return;}
  if(action==='theme'){this.opts.onTheme();return;}
  if(action==='save'){this.save();void retryAssetWrites(this.opts.assets).then(()=>this.save()).catch(()=>this.status('Не удалось сохранить исходники. Скачайте полную копию проекта перед выходом.'));return;}
  if(action.startsWith('mode-')){const p=clone(this.project);p.mode=action==='mode-reels'?'reels':'video';p.ratio=p.mode==='reels'?'9:16':'16:9';this.commit(p);return;}
  if(action.startsWith('tab-')){this.tab=action.slice(4) as typeof this.tab;this.showPanel('library');this.renderLibrary();for(const name of ['media','audio','text'])this.$(`[data-action="tab-${name}"]`).classList.toggle('active',this.tab===name);return;}
  if(action.startsWith('mobile-')){this.showPanel(action.slice(7));return;}
  if(action.startsWith('expand-')){this.expand(action.slice(7));return;}
  if(action==='add-layer'){const max=Math.max(this.overlayRows,...this.project.clips.map(c=>c.layer));if(max>=8){this.status('Можно добавить до 8 слоёв поверх основного видео.');return;}this.overlayRows=max+1;this.showPanel('timeline');this.renderTimeline();this.$('.pe-track-scroll').scrollTop=0;return;}
  if(action==='overlay-new'){const layer=this.overlaySlot();if(layer!==null)this.runAction('overlay-import-'+layer);return;}
  if(action.startsWith('overlay-import-')){this.importLayer=clamp(Number(action.slice(15)),1,8);const input=this.$<HTMLInputElement>('.pe-file-input');input.accept='video/*,image/*';input.click();return;}
  if(action==='import'){this.importLayer=0;const input=this.$<HTMLInputElement>('.pe-file-input');input.accept=this.tab==='audio'?'audio/*':'video/*,image/*,audio/*';input.click();return;}
  if(action==='srt'){this.$<HTMLInputElement>('.pe-srt-input').click();return;}
  if(action==='json-import'){this.$<HTMLInputElement>('.pe-json-input').click();return;}
  if(action==='backup-export'){if(this.backupBusy||this.importing)return;this.save(false);this.backupBusy=true;void downloadProjectBackup([this.project],this.opts.assets,m=>this.status(m)).then(()=>this.status('Полная копия скачана. Сохраните её отдельно от браузера.')).catch(e=>this.fail(e)).finally(()=>{this.backupBusy=false;});return;}
  if(action==='json-export'){download(new Blob([JSON.stringify(this.project,null,2)],{type:'application/json'}),this.project.name+'.json');return;}
  if(action==='play'){if(this.loading)return;this.engine.playing?this.engine.pause():void this.engine.play().catch(e=>this.fail(e));return;}
  if(action==='back'||action==='forward'){void this.seek(this.cursor+(action==='back'?-1:1));return;}
  if(action==='undo'||action==='redo'){this.engine.pause();this.history[action]();this.history.value.modified=Date.now();this.cacheChange();this.selected=null;this.render();void this.prepare();return;}
  if(action==='mark-in'||action==='mark-out'){if(action==='mark-in')this.markIn=this.cursor;else this.markOut=this.cursor;this.$<HTMLDetailsElement>('.pe-range-panel').open=true;this.renderTimeline();return;}
  if(action==='cut'){this.commit(cutRange(this.project,this.markIn,this.markOut));this.markOut=this.markIn;this.renderTimeline();return;}
  if(action==='add-text'){const p=clone(this.project),c=normalizeCaption({text:t.text,from:this.cursor,to:Math.max(this.cursor+3,videoLength(p))});p.texts.push(c);this.selected={track:'text',id:c.id};this.tab='text';this.commit(p);return;}
  if(action==='export'){this.openExport();return;}
  if(action==='close-export'){this.closeExport();return;}
  if(action==='start-export'){void this.runExport();return;}
  if(action==='cancel-export'){this.abort?.abort();return;}
  const item=this.selectedItem(),s=this.selected;if(!item||!s)return;
  const p=clone(this.project),list=s.track==='video'?p.clips:s.track==='audio'?p.audio:p.texts,index=list.findIndex(c=>c.id===s.id);
  if(action==='delete'){list.splice(index,1);this.selected=null;this.commit(p);return;}
  if(action==='duplicate'){const c=clone(item);c.id=uid();if(s.track==='text'){const a=c as Caption;const d=a.to-a.from;a.from=a.to;a.to+=d;p.texts.push(a);}else if(s.track==='audio'){(c as Clip).at+=length(c as Clip);p.audio.push(c as Clip);}else{if((c as Clip).layer>0)(c as Clip).at+=length(c as Clip);p.clips.splice(index+1,0,c as Clip);}this.selected={track:s.track,id:c.id};this.commit(p);return;}
  if(action==='split'){
   if(s.track==='text'){const c=item as Caption;if(this.cursor<=c.from+.04||this.cursor>=c.to-.04)return;p.texts.splice(index,1,{...c,to:this.cursor},{...c,id:uid(),from:this.cursor});}
   else{const halves=splitClip(item as Clip,this.cursor-this.selectedAt());if(!halves)return;(s.track==='video'?p.clips:p.audio).splice(index,1,...halves);}this.commit(p);return;
  }
  if(action==='trim-start'||action==='trim-end'){if(s.track==='text'){const c=item as Caption;this.changeSelected(action==='trim-start'?{from:clamp(this.cursor,0,c.to-.04)}:{to:Math.max(c.from+.04,this.cursor)});}else{const c=item as Clip,v=c.start+(this.cursor-this.selectedAt())*c.speed;this.changeSelected(action==='trim-start'?{start:clamp(v,c.start,c.end-.04),...(s.track==='audio'||c.layer>0?{at:this.cursor}:{})}:{end:clamp(v,c.start+.04,c.end)});}return;}
  if(action==='detach'&&s.track==='video'){const c=p.clips[index];p.audio.push({...c,id:uid(),kind:'audio',at:this.selectedAt()});c.muted=true;this.commit(p);return;}
  if(action==='move-left'||action==='move-right'){if(s.track!=='video')return;const c=p.clips[index],direction=action==='move-left'?-1:1;if(c.layer>0){c.at=Math.max(0,c.at+direction*.5);}else{const mains=p.clips.filter(v=>!v.layer),j=mains.findIndex(v=>v.id===c.id)+direction;if(j<0||j>=mains.length)return;const other=p.clips.indexOf(mains[j]);[p.clips[index],p.clips[other]]=[p.clips[other],p.clips[index]];}this.commit(p);return;}
  if(action==='fit-contain'||action==='fit-cover'){this.changeSelected({fit:action==='fit-cover'?'cover':'contain'});}
 }
 private input(e:Event){const target=e.target as HTMLInputElement;if(target.dataset.project==='name'&&!this.exporting){this.pendingName=target.value.slice(0,120);if(this.autosaveTimer)clearTimeout(this.autosaveTimer);this.autosaveTimer=setTimeout(()=>this.save(false),500);return;}if(target.type==='range'&&target.dataset.field){const out=this.root.querySelector(`[data-value="${target.dataset.field}"]`);if(out)out.textContent=target.value;}
  if(target.dataset.ui==='zoom')this.navigation.setZoom(Number(target.value));
 }
 private change(e:Event){if(this.exporting)return;const target=e.target as HTMLInputElement;
  if(target.matches('.pe-file-input')){const files=Array.from(target.files||[]);target.value='';const layer=this.importLayer;this.importLayer=0;void this.importFiles(files,layer);return;}
  if(target.matches('.pe-srt-input')){const f=target.files?.[0];target.value='';if(f)void f.text().then(s=>{const captions=parseSrt(s);if(!captions.length)throw Error('No valid SRT cues');const p=clone(this.project);p.texts.push(...captions);this.commit(p);}).catch(e=>this.fail(e));return;}
  if(target.matches('.pe-json-input')){const f=target.files?.[0];target.value='';if(f&&!this.backupBusy){this.save(false);this.backupBusy=true;void importProjectBackup(f,m=>this.status(m)).then(projects=>{if(this.disposed||storageScope()!==this.account)return;this.engine.pause();this.history=new History(projects[0]);this.selected=null;this.cursor=0;this.save(false);this.render();return this.restore();}).catch(e=>this.fail(e)).finally(()=>{this.backupBusy=false;});}return;}
  if(target.matches('.pe-relink-input')){const f=target.files?.[0],id=this.relinkId;target.value='';this.relinkId='';if(f&&id)void this.relinkSource(f,id);return;}
  if(target.dataset.ui==='safe'){this.safe=target.checked;this.$('.pe-safe').hidden=!this.safe;return;}
  if(target.dataset.project){const p=clone(this.project);if(target.dataset.project==='name'){this.pendingName=null;if(target.value===p.name)return;p.name=target.value;}else if(target.dataset.project==='ratio')p.ratio=target.value as Ratio;else p.master=Number(target.value);this.commit(p);return;}
  if(target.dataset.field){const field=target.dataset.field;let value:unknown=target.type==='checkbox'?target.checked:['number','range'].includes(target.type)?Number(target.value):target.value;
   if(typeof value==='number'&&!Number.isFinite(value))return;const c=this.selectedItem();let patch={ [field]:value } as Partial<Clip>&Partial<Caption>;
   if(c&&this.selected?.track==='video'&&field==='layer'&&Number(value)>0&&!(c as Clip).layer)patch.at=this.selectedAt();
   if(c&&this.selected?.track!=='text'&&field==='end'&&(c as Clip).kind==='image')patch.duration=Math.max((c as Clip).duration,Number(value));this.changeSelected(patch);
  }
 }
 private pointer(e:PointerEvent){if(this.exporting||e.button!==0)return;const target=e.target as Element,panel=target.closest<HTMLElement>('[data-panel]');if(panel){this.root.querySelectorAll('.pe-panel.front').forEach(n=>n.classList.remove('front'));panel.classList.add('front');}
  if(target.closest('[data-seek],.pe-time-row')&&!target.closest('button')&&!this.loading){const rect=this.$('.pe-track-content').getBoundingClientRect();void this.seek((e.clientX-rect.left)/this.pixels());}
  const handle=target.closest<HTMLElement>('[data-resize]'),clip=handle?.closest<HTMLElement>('[data-clip]');if(!handle||!clip)return;
  e.preventDefault();e.stopPropagation();const [track,id]=clip.dataset.select!.split(':');this.selected={track:track as Selection['track'],id};const item=clone(this.selectedItem());if(!item)return;const startX=e.clientX;this.engine.pause();
  const move=(event:PointerEvent)=>{const delta=(event.clientX-startX)/this.pixels();clip.style.opacity='.65';clip.style.translate=(handle.dataset.resize==='start'?delta*this.pixels():0)+'px 0';};
  const end=(event:PointerEvent)=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',end);document.removeEventListener('pointercancel',cancel);const delta=(event.clientX-startX)/this.pixels();if(track==='text'){const c=item as Caption;this.changeSelected(handle.dataset.resize==='start'?{from:clamp(c.from+delta,0,c.to-.04)}:{to:Math.max(c.from+.04,c.to+delta)});}else{const c=item as Clip;this.changeSelected(handle.dataset.resize==='start'?{start:clamp(c.start+delta*c.speed,0,c.end-.04),...(track==='audio'||c.layer>0?{at:Math.max(0,c.at+delta)}:{})}:{end:clamp(c.end+delta*c.speed,c.start+.04,c.duration)});}};
  const cancel=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',end);document.removeEventListener('pointercancel',cancel);this.renderTimeline();};
  document.addEventListener('pointermove',move);document.addEventListener('pointerup',end);document.addEventListener('pointercancel',cancel);this.cleanups.push(cancel);
 }
 private dragStart(e:DragEvent){if(this.exporting||this.loading)return;const node=e.target as Element,asset=node.closest<HTMLElement>('[data-asset]');if(asset){e.dataTransfer?.setData('application/x-pokadrovo-asset',asset.dataset.asset!);return;}const target=node.closest<HTMLElement>('[data-clip]');if(target)e.dataTransfer?.setData('application/x-pokadrovo',target.dataset.select!);}
 private drop(e:DragEvent){e.preventDefault();if(this.exporting||this.loading)return;
  const row=(e.target as Element).closest<HTMLElement>('[data-drop]'),layer=Number(row?.dataset.layer||0);
  const rect=this.$('.pe-track-content').getBoundingClientRect(),at=Math.max(0,(e.clientX-rect.left)/this.pixels());
  if(e.dataTransfer?.files.length){void this.importFiles(Array.from(e.dataTransfer.files),layer,at);return;}
  const assetId=e.dataTransfer?.getData('application/x-pokadrovo-asset');if(assetId){const a=this.opts.assets.get(assetId);if(a&&row&&row.dataset.drop===(a.kind==='audio'?'audio':'video'))this.placeAsset(a,layer,at);return;}
  const raw=e.dataTransfer?.getData('application/x-pokadrovo');if(!raw)return;const [track,id]=raw.split(':');if(!['video','audio','text'].includes(track))return;
  if(row&&row.dataset.drop!==track)return;
  const p=clone(this.project);
  if(track==='video'){const index=p.clips.findIndex(c=>c.id===id);if(index<0)return;const c=p.clips[index];
   if(layer>0){c.layer=layer;c.at=at;}else{const target=positions(p).find(v=>!v.clip.layer&&at<v.end)?.clip.id;const dest=target?p.clips.findIndex(v=>v.id===target):p.clips.length;p.clips.splice(index,1);c.layer=0;p.clips.splice(Math.max(0,dest-(index<dest?1:0)),0,c);}
  }
  if(track==='audio'){const c=p.audio.find(c=>c.id===id);if(c)c.at=at;}
  if(track==='text'){const c=p.texts.find(c=>c.id===id);if(c){c.to=at+(c.to-c.from);c.from=at;}}
  this.selected={track:track as Selection['track'],id};this.commit(p);
 }
 private expand(panel:string){const same=this.expanded===panel;this.root.querySelectorAll<HTMLElement>('.pe-panel.maximized').forEach(n=>{n.classList.remove('maximized');n.removeAttribute('role');n.removeAttribute('aria-modal');});
  this.expanded=same?'':panel;this.$('.pe-panel-shade').hidden=!this.expanded;
  if(this.expanded){this.lastFocus=document.activeElement as HTMLElement;const node=this.$(`[data-panel="${panel}"]`);node.classList.add('maximized');node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');node.setAttribute('aria-label',panel);node.querySelector<HTMLElement>('button')?.focus();}else this.lastFocus?.focus();
  requestAnimationFrame(()=>this.fitCanvas());
 }
 private key(e:KeyboardEvent){if(this.disposed||this.tour?.active)return;
  if(e.target===this.engine.canvas&&(e.key==='Enter'||e.key===' ')){e.preventDefault();this.selectPreview();return;}
  if(e.key==='Escape'){if(this.exporting){this.abort?.abort();return;}if(this.expanded)this.expand(this.expanded);else this.closeExport();return;}
  if(e.key==='Tab'&&(this.expanded||!this.$('.pe-modal').hidden)){const host=this.expanded?this.$(`[data-panel="${this.expanded}"]`):this.$('.pe-modal');const els=[...host.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select,textarea')].filter(n=>n.getClientRects().length);if(els.length){const first=els[0],last=els[els.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}return;}
  if(this.exporting||!this.$('.pe-modal').hidden)return;const input=(e.target as Element)?.closest('input,textarea,select,[contenteditable=true]');
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();this.tools?.beforeAction('save');this.save();return;}if(input)return;
  const actions:Record<string,string>={' ':'play',s:'split',Delete:'delete',Backspace:'delete',i:'mark-in',o:'mark-out'};
  let action=actions[e.key];if(e.ctrlKey||e.metaKey){if(e.key.toLowerCase()==='z')action=e.shiftKey?'redo':'undo';if(e.key.toLowerCase()==='y')action='redo';if(e.key.toLowerCase()==='d')action='duplicate';}
  if(action){e.preventDefault();this.root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.click();}
 }
 private openExport(){this.engine.pause();const formats=exportFormats(),modal=this.$('.pe-modal');this.lastFocus=document.activeElement as HTMLElement;modal.hidden=false;modal.innerHTML=`<section role="dialog" aria-modal="true" aria-label="${t.export}" class="pe-export-dialog"><header><h2>${t.export}</h2>${button('close-export',t.close,'close','square')}</header><p>${this.project.ratio} / ${clock(totalLength(this.project))}</p><label class="pe-field">${t.quality}<select id="pe-quality"><option value="720">720p</option><option value="1080">1080p</option></select></label><label class="pe-field">${t.export}<select id="pe-format">${formats.map((f,i)=>`<option value="${i}">${f.label} + ${t.audio}</option>`).join('')}</select></label><p class="pe-note">${t.renderHint}</p><progress max="1" value="0"></progress><output class="pe-export-progress">0%</output><p role="status" class="pe-export-message"></p><div class="pe-export-actions">${button('cancel-export',t.cancel,'','', 'hidden')}${button('start-export',t.export,'download','primary',formats.length?'':'disabled')}</div></section>`;modal.querySelector<HTMLElement>('select')?.focus();}
 private closeExport(){if(this.exporting)return;this.$('.pe-modal').hidden=true;this.lastFocus?.focus();}
 private async runExport(){if(this.exporting)return;this.exporting=true;this.abort=new AbortController();const format=exportFormats()[Number(this.$<HTMLSelectElement>('#pe-format').value)];const modal=this.$('.pe-modal');
  if(!format){this.exporting=false;return;}const quality=Number(this.$<HTMLSelectElement>('#pe-quality').value);
  modal.querySelectorAll<HTMLInputElement>('select,button').forEach(n=>n.disabled=true);const cancel=this.$<HTMLButtonElement>('[data-action="cancel-export"]');cancel.hidden=false;cancel.disabled=false;cancel.focus();
  this.$('.pe-export-message').textContent=t.loading+'...';
  try{const blob=await exportProject(clone(this.project),this.opts.assets,format,quality,v=>{this.$<HTMLProgressElement>('progress').value=v;this.$('.pe-export-progress').textContent=Math.floor(v*100)+'%';this.$('.pe-export-message').textContent=t.renderHint;},this.abort.signal);
   download(blob,this.project.name+'.'+format.ext);if(this.exportUrl)URL.revokeObjectURL(this.exportUrl);this.exportUrl=URL.createObjectURL(blob);
   const link=document.createElement('a');link.href=this.exportUrl;link.download=this.project.name+'.'+format.ext;link.textContent=t.download;link.className='pe-download';this.$('.pe-export-actions').append(link);this.$('.pe-export-message').textContent=t.done;this.status(t.done);
  }catch(e){this.$('.pe-export-message').textContent=e instanceof DOMException&&e.name==='AbortError'?t.cancel:t.error+': '+(e instanceof Error?e.message:String(e));}
  finally{this.exporting=false;cancel.hidden=true;modal.querySelectorAll<HTMLInputElement>('select,button').forEach(n=>n.disabled=false);}
 }
 dispose(){if(this.autosaveTimer)this.save(false);this.disposed=true;this.tour.dispose();this.tools.dispose();this.navigation.dispose();this.thumbnails.dispose();this.abort?.abort();this.engine.dispose();this.resize.disconnect();this.cleanups.forEach(fn=>fn());if(this.statusTimer)clearTimeout(this.statusTimer);if(this.exportUrl)URL.revokeObjectURL(this.exportUrl);this.root.innerHTML='';}
}
