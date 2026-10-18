/** Storage belongs only to this preview. It never reads owner/account namespaces. */
const memory = new Map<string,string>();
let durable = true;
export const previewStorage = {
  getItem(key:string):string|null {
    try { const found=localStorage.getItem('pokadrovo.chat-preview.v1:'+key); if(found!==null){memory.set(key,found);return found;} }
    catch { durable=false; }
    return memory.get(key)??null;
  },
  setItem(key:string,value:string) {
    memory.set(key,value);
    try { localStorage.setItem('pokadrovo.chat-preview.v1:'+key,value); } catch { durable=false; }
  },
  get durable(){return durable;}
};
export type PreviewEvent = {kind:string;at:number};
export function events():PreviewEvent[]{try{return JSON.parse(previewStorage.getItem('events')||'[]');}catch{return [];}}
export function record(kind:string){previewStorage.setItem('events',JSON.stringify([...events(),{kind,at:Date.now()}].slice(-500)));}
