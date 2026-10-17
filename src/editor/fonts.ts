import type { Caption } from './model';

export interface EditorFont { id:string; label:string; family:string; url?:string; }
const registry:EditorFont[]=[
  {id:'system',label:'Без засечек',family:'Arial, "Liberation Sans", sans-serif'},
  {id:'serif',label:'Книжный',family:'Georgia, "Liberation Serif", serif'},
  {id:'mono',label:'Моноширинный',family:'"Courier New", "Liberation Mono", monospace'},
  {id:'display',label:'Плакатный',family:'Impact, "Arial Black", "DejaVu Sans", sans-serif'},
  {id:'rounded',label:'Мягкий',family:'"Trebuchet MS", Verdana, sans-serif'},
  {id:'classic',label:'Классический',family:'"Times New Roman", "Liberation Serif", serif'}
];
const loaded=new Map<string,Promise<void>>();
export const editorFonts=()=>registry.map(f=>({...f}));
export const fontById=(id:string)=>registry.find(f=>f.id===id)||registry[0];
export const fontStyle=(c:Caption,size:number)=>`${c.italic?'italic':'normal'} ${c.weight} ${size}px ${fontById(c.fontId).family}`;
/** Register a licensed, same-origin font later. No CDN calls or arbitrary CSS. */
export function registerEditorFont(font:EditorFont):void {
  if(!/^[a-z0-9_-]{1,64}$/.test(font.id)||!font.label.trim()||font.label.length>80||
     !/^[a-zA-Z0-9 _-]{1,80}$/.test(font.family))throw Error('Invalid font descriptor');
  if(font.url&&!/^\/(?!\/)[a-zA-Z0-9_./-]+\.(woff2?|ttf|otf)$/i.test(font.url))throw Error('Use a local font URL');
  if(registry.some(f=>f.id===font.id))throw Error('Font ID already registered');
  registry.push({...font});
}
export async function ensureFonts(texts:Caption[]):Promise<void>{
  if(typeof document==='undefined'||!document.fonts)return;
  for(const id of new Set(texts.map(c=>c.fontId))){
    const font=fontById(id);
    if(font.url&&!loaded.has(id)){
      const job=(async()=>{
        const face=new FontFace(font.family,`url("${font.url}")`);
        const ready=await face.load();document.fonts.add(ready);
      })();
      loaded.set(id,job);job.catch(()=>loaded.delete(id));
    }
    const promise=loaded.get(id);if(promise)await promise;
  }
  await Promise.all(texts.map(c=>document.fonts.load(fontStyle(c,24)).then(()=>undefined)));
}
