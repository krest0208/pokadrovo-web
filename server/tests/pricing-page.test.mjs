import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { build } from 'esbuild';
import { createApp } from '../app.mjs';

test('AI guide is public and legacy pricing links redirect without invoking AI', async()=>{
  const dir=mkdtempSync(join(tmpdir(),'pk-pricing-'));mkdirSync(join(dir,'dist'));
  const shell='<!doctype html><div id="root">public app shell</div>';
  writeFileSync(join(dir,'dist/index.html'),shell);
  const {server,store}=createApp({origin:'http://localhost:5173',accountsEnabled:true,guestEditingEnabled:false,dataDir:join(dir,'private'),dist:join(dir,'dist'),aiFetch(){throw Error('A pricing page must never invoke a model');}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const get=(path,method='GET')=>new Promise((resolve,reject)=>{
    const req=httpRequest({host:'127.0.0.1',port:server.address().port,path,method,headers:{host:'localhost:5173'}},res=>{
      let body='';res.setEncoding('utf8');res.on('data',chunk=>{body+=chunk;});res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));
    });req.on('error',reject);req.end();
  });
  try{
    for(const path of ['/ai','/ai/']){const r=await get(path);assert.equal(r.status,200,path);assert.equal(r.body,shell);assert.match(r.headers['content-type'],/text\/html/);}
    for(const path of ['/pricing','/pricing/','/pricing?from=footer']){const r=await get(path);assert.equal(r.status,308);assert.equal(r.headers.location,'/ai');}
    assert.equal((await get('/pricing','HEAD')).status,308);
    assert.equal((await get('/pricing','POST')).status,405);
    assert.equal((await get('/studio')).status,303);
    assert.equal((await get('/api/account/projects')).status,401);
    assert.equal((await get('/pricing/private')).status,404);
    assert.equal(store.get('SELECT count(*) n FROM ai_runs').n,0);
  }finally{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

const root=new URL('../..',import.meta.url).pathname;
const bundle=await build({absWorkingDir:root,stdin:{contents:`export {default as Studio} from './src/Studio';export {default as AiPlans} from './src/AiPlans';export {default as AiHome} from './src/AiHome';export {acceptSession} from './src/account/api';`,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'cjs',platform:'node',external:['react','react-dom','motion','motion/*'],loader:{'.css':'empty','.webp':'dataurl'}});
const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function browser(path='/ai'){
  const module={exports:{}},location={pathname:path,protocol:'https:'},storage=new Map(),pushed=[];
  vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require,console,location,window:{scrollTo(){}},history:{pushState(_state,_title,path){location.pathname=path;pushed.push(path);}},localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},fetch:async()=>new Response(JSON.stringify({projects:[]})),Response,AbortSignal,URL,setTimeout,clearTimeout});
  const studio=new module.exports.Studio({});
  studio.setState=(next,done)=>{Object.assign(studio.state,typeof next==='function'?next(studio.state):next);done?.();};
  return {api:module.exports,studio,location,pushed};
}

test('a direct pricing link survives both guest session loading and a signed-in account change',async()=>{
  for(const session of [{user:null,csrf:'',providers:[],accountsEnabled:false},{user:{id:'member',name:'Member',role:'user'},csrf:'test',providers:[],accountsEnabled:true}]){
    const b=browser();assert.equal(b.studio.state.screen,'pricing');b.api.acceptSession(session);
    await b.studio.adopt(session);assert.equal(b.studio.state.screen,'pricing');assert.equal(b.studio.state.auth,false);
    const html=renderToStaticMarkup(b.studio.render());assert.match(html,/понятному монтажу/);assert.doesNotMatch(html,/au-editor-account/);
  }
});

test('back navigation restores pricing and the logo returns to the homepage',()=>{
  const b=browser('/');assert.equal(b.studio.state.screen,'home');
  b.location.pathname='/pricing/';b.studio.onPop();assert.equal(b.studio.state.screen,'pricing');
  b.studio.navigate('home');assert.equal(b.location.pathname,'/');assert.equal(b.studio.state.screen,'home');
  b.studio.navigate('pricing');assert.equal(b.location.pathname,'/ai');assert.equal(b.studio.state.screen,'pricing');
});

test('the public AI guide and homepage use generic AI copy without model names, prices or purchase controls',()=>{
  const b=browser(),noop=()=>{};
  const guide=renderToStaticMarkup(React.createElement(b.api.AiPlans,{theme:'dark',onTheme:noop,onHome:noop,onStart:noop}));
  assert.match(guide,/data-theme="dark"/);assert.match(guide,/СМОНТИРОВАТЬ С ИИ/);assert.doesNotMatch(guide,/Qwen|Gemini|Alibaba/);assert.match(guide,/60 секунд/);assert.match(guide,/7 МБ/);
  assert.doesNotMatch(guide,/Yandex|DeepSeek|Gemma|монет|Тариф|>Купить|pk-plan-price/i);
  const home=renderToStaticMarkup(React.createElement(b.api.AiHome,{theme:'light',onToggleTheme:noop,onCreate:noop,onContinue:noop,onImport:noop,onOpenProject:noop,projects:[]}));
  assert.doesNotMatch(home,/pkh-pricing|Тариф|монет|купить|ArrowUpRight/i);
  assert.match(home,/<a href="\/ai">Смонтировать с ИИ<\/a>/);
});

test('every start-editing CTA opens the editor directly and project links stay out of the homepage',()=>{
 const b=browser(),calls=[],noop=()=>{},home=new b.api.AiHome({theme:'light',onToggleTheme:noop,onCreate:brief=>calls.push(brief),onContinue:noop,onImport:noop,onOpenProject:noop,projects:[]});
 const buttons=[];const visit=node=>{if(!node||typeof node!=='object')return;if(node.type==='button'&&node.props.children==='Начать монтаж')buttons.push(node);React.Children.forEach(node.props?.children,visit);};visit(home.render());
 assert.equal(buttons.length,4);for(const button of buttons)button.props.onClick();assert.equal(calls.length,4);
 const html=renderToStaticMarkup(home.render());assert.doesNotMatch(html,/Мои проекты|Монтажная студия в браузере|pk-scene-picker|Qwen|Gemini|Alibaba/);assert.match(html,/Снимай больше/);assert.match(html,/Монтируй проще/);
});
