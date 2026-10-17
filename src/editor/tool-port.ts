import type { Project, Selection, Asset } from './model';
import type { AiProvider } from './ai';
export interface ToolPort {
  root:HTMLElement; canvas:HTMLCanvasElement; assets:Map<string,Asset>; provider?:AiProvider;
  project:()=>Project; selected:()=>Selection|null; cursor:()=>number; playing:()=>boolean; busy:()=>boolean;
  select:(selection:Selection|null,time?:number)=>void; seek:(time:number)=>void;
  pause:()=>void; commit:(project:Project,message?:string)=>void; preview:(project:Project)=>void;
  run:(action:string)=>void; status:(message:string)=>void; refresh:()=>void;
}
