import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const output=resolve(process.argv[2]||resolve(root,'../pokadrovo-preview.html'));
const assets=resolve(root,'src/editor/assets.ts'),api=resolve(root,'src/account/api.ts');
const previewAssets=resolve(root,'src/preview/assets.ts');
const result=await build({absWorkingDir:root,entryPoints:['src/preview/main.tsx'],bundle:true,minify:true,write:false,outfile:'.compiled/preview/app.js',format:'iife',target:'es2022',metafile:true,loader:{'.webp':'dataurl'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{
  name:'isolated-chat-preview',setup(b){
    b.onLoad({filter:/home\/assets\/[^/]+\.webp$/},async args=>{
      const name=args.path.split('/').at(-1);
      const contents=await readFile(resolve(root,'src/preview/media',name));
      return {contents,loader:'dataurl'};
    });
    b.onResolve({filter:/\?raw$/},args=>({path:resolve(args.resolveDir,args.path.slice(0,-4)),namespace:'preview-raw'}));
    // The offline preview has no real provider. Keep live codec capture out of its 1 MB artifact.
    b.onResolve({filter:/^\.\/media-samples$/},args=>args.importer.endsWith('/src/editor/ai-panel.ts')?{path:'ai-media-disabled',namespace:'preview-ai-media'}:undefined);
    b.onLoad({filter:/.*/,namespace:'preview-ai-media'},()=>({contents:'export async function prepareSamples(){throw Error("Анализ медиа доступен на сайте после входа.");}',loader:'js'}));
    // Full media archives belong to the live editor, not the size-limited offline demonstration.
    b.onResolve({filter:/^\.\/project-backup$/},args=>args.importer.endsWith('/src/editor/editor.ts')?{path:'project-backup-live',namespace:'preview-project-backup'}:undefined);
    b.onLoad({filter:/.*/,namespace:'preview-project-backup'},()=>({contents:'export async function downloadProjectBackup(){throw Error("Полные копии проектов доступны на pokadrovo.ru.");}export const importProjectBackup=downloadProjectBackup;',loader:'js'}));
    b.onLoad({filter:/.*/,namespace:'preview-raw'},async args=>{
      let contents=await readFile(args.path,'utf8');
      if(args.path.endsWith('/server/public/admin.html')){
        // Embed only the interface, never the server document or resource loaders.
        const body=contents.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
        if(!body)throw Error('Admin template has no body.');
        contents=body[1].replace(/<!-- MAIL START -->[\s\S]*?<!-- MAIL END -->/g,'').replace(/<button data-view="mail">[\s\S]*?<\/button>/g,'').replace(/<!-- DATABASE START -->[\s\S]*?<!-- DATABASE END -->/g,'').replace(/<button data-view="database">[\s\S]*?<\/button>/g,'').replace(/<!-- LEGAL START -->[\s\S]*?<!-- LEGAL END -->/g,'').replace(/<button data-view="legal">[\s\S]*?<\/button>/g,'').replace(/<!-- BILLING START -->[\s\S]*?<!-- BILLING END -->/g,'').replace(/<button data-view="billing">[\s\S]*?<\/button>/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'');
        if(/<(?:link|iframe|script)\b/i.test(contents))throw Error('Unexpected resource loader in admin preview.');
      }
      return {contents,loader:'text'};
    });
    b.onResolve({filter:/account\/api$|(?:^|\/)assets$/},args=>{
      const target=resolve(args.resolveDir,args.path+'.ts');
      if(target===api)return {path:resolve(root,'src/preview/account-stub.ts')};
      if(target===assets&&args.importer!==previewAssets)return {path:previewAssets};
    });
    b.onLoad({filter:/AiHome\.tsx$/},async args=>({contents:"import {previewStorage as localStorage} from './preview/storage';\n"+await readFile(args.path,'utf8'),loader:'tsx',resolveDir:dirname(args.path)}));
  }
}]});
let script=result.outputFiles.find(f=>f.path.endsWith('.js')).text;
// React contains an inert script-element string. Keep it as a JS escape so
// fragment extractors cannot mistake it for another executable script block.
script=script.replace(/<(?=\/?script\b)/gi,'\\x3c');
let css=result.outputFiles.find(f=>f.path.endsWith('.css')).text;
// One bundled Outfit weight keeps the isolated preview below its 1 MB limit.
// Monospace UI uses the existing local fallback; live site fonts are unchanged.
for(const [family,weight,file]of [
  ['Outfit',400,'@fontsource/outfit/files/outfit-latin-400-normal.woff2']
]){const bytes=await readFile(resolve(root,'node_modules',file));css+=`\n@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${bytes.toString('base64')}) format('woff2')}`;}
if(/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/.test(script))throw Error('Unexpected network API in preview bundle.');
if(result.metafile.inputs['src/account/api.ts']||result.metafile.inputs['src/Studio.tsx'])throw Error('Live account code leaked into preview.');
let template=await readFile(resolve(root,'src/preview/fragment.html'),'utf8');
if(process.argv.includes('--ai-settings'))template=template.replace('id="pokadrovo-chat-preview"','id="pokadrovo-chat-preview" data-start="ai"');
const html=template.replace('/* PREVIEW_STYLES */',()=>css.replace(/<\/style/gi,'<\\/style')).replace('/* PREVIEW_SCRIPT */',()=>script.replace(/<\/script/gi,'<\\/script'));
if(/<!doctype\s|<\s*(?:html|head|body)(?:\s|>)/i.test(html))throw Error('A full document leaked into the inline fragment.');
if((html.match(/<script\b/gi)||[]).length!==1)throw Error('Unexpected embedded script marker.');
if(Buffer.byteLength(html)>1000000)throw Error(`Preview exceeds 1 MB (${Buffer.byteLength(html)} bytes).`);
await writeFile(output,html);
await mkdir(resolve(root,'.compiled/preview'),{recursive:true});
await writeFile(resolve(root,'.compiled/preview/meta.json'),JSON.stringify(result.metafile));
console.log(JSON.stringify({output,bytes:Buffer.byteLength(html),modules:Object.keys(result.metafile.inputs).length,network:false}));
