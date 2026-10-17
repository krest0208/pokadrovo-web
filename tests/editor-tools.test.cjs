const assert=require('node:assert/strict');
const m=require('../.compiled/model.js'),g=require('../.compiled/geometry.js'),a=require('../.compiled/ai.js'),fonts=require('../.compiled/fonts.js');
let count=0;
async function test(name,fn){await fn();count++;console.log('PASS',name);}
const clip=m.normalizeClip({id:'v1',assetId:'asset1',kind:'video',duration:10});
const project=m.newProject('video','Test');project.clips=[clip];project.audio=[m.normalizeClip({...clip,id:'a1',kind:'audio'})];
const req=()=>a.createAiRequest(project,'Trim and caption',1,{track:'video',id:'v1'});
const raw=(r,ops)=>({version:1,requestId:r.requestId,projectId:r.projectId,revision:r.revision,summary:'Planned edits',operations:ops});
(async()=>{
await test('legacy geometry defaults',()=>{assert.equal(clip.scaleX,1);assert.equal(clip.cropLeft,0);assert.equal(clip.shape,'rect');});
await test('image shape stored',()=>assert.equal(m.normalizeClip({...clip,shape:'ellipse'}).shape,'ellipse'));
await test('invalid shape fallback',()=>assert.equal(m.normalizeClip({...clip,shape:'<script>'}).shape,'rect'));
await test('crop retains visible source',()=>{const c=m.normalizeClip({...clip,cropLeft:.8,cropRight:.8});assert.ok(c.cropLeft+c.cropRight<=.900001)});
await test('scale clamps nonfinite values',()=>{const c=m.normalizeClip({...clip,scaleX:NaN,scaleY:Infinity});assert.equal(c.scaleX,1);assert.equal(c.scaleY,1)});
await test('caption style normalization',()=>{const t=m.normalizeCaption({text:'Hi',fontId:'serif',weight:700,italic:true,align:'left'});assert.equal(t.fontId,'serif');assert.equal(t.weight,700);assert.equal(t.align,'left');assert.equal(t.italic,true)});
await test('font ID rejects injected CSS',()=>assert.equal(m.normalizeCaption({fontId:'x";url(https://evil)'}).fontId,'system'));
await test('unknown font keeps portable fallback',()=>assert.equal(fonts.fontById('missing').id,'system'));
await test('custom local font can register',()=>{fonts.registerEditorFont({id:'my-font',label:'Custom',family:'MyFont',url:'/fonts/my-font.woff2'});assert.equal(fonts.fontById('my-font').family,'MyFont')});
await test('remote custom font refused',()=>assert.throws(()=>fonts.registerEditorFont({id:'bad',label:'Bad',family:'Bad',url:'https://evil/font.woff2'})));
await test('CSS in font family refused',()=>assert.throws(()=>fonts.registerEditorFont({id:'bad',label:'Bad',family:'x;url(https://evil)'})));
await test('base geometry contains source',()=>{const b=g.mediaBox(clip,{width:400,height:300},1280,720);assert.equal(b.width,960);assert.equal(b.height,720);assert.equal(b.cx,640)});
await test('crop maps source rectangle',()=>{const b=g.mediaBox(m.patchClip(clip,{cropLeft:.25,cropBottom:.2}),{width:400,height:300},1280,720);assert.equal(b.sx,100);assert.equal(b.sw,300);assert.equal(b.sh,240)});
await test('drag moves proportionally',()=>{const b=g.mediaBox(clip,{width:400,height:300},1280,720),c=g.dragTransform(clip,b,'move',128,72,1280,720,true);assert.equal(c.x,10);assert.equal(c.y,10)});
await test('unlocked scale changes one axis',()=>{const b=g.mediaBox(clip,{width:400,height:300},1280,720),c=g.dragTransform(clip,b,'e',96,0,1280,720,false);assert.equal(c.scaleX,1.1);assert.equal(c.scaleY,1)});
await test('locked resize preserves ratio',()=>{const b=g.mediaBox(clip,{width:400,height:300},1280,720),c=g.dragTransform(clip,b,'se',96,20,1280,720,true);assert.equal(c.scaleX,c.scaleY)});
await test('opposite anchor stays fixed at rotation',()=>{
 const c=m.patchClip(clip,{rotation:37}),b=g.mediaBox(c,{width:400,height:300},1280,720),n=g.dragTransform(c,b,'se',76,45,1280,720,false),d=g.mediaBox(n,{width:400,height:300},1280,720);
 const f=x=>[x.cx-Math.cos(x.angle*Math.PI/180)*x.width/2+Math.sin(x.angle*Math.PI/180)*x.height/2,x.cy-Math.sin(x.angle*Math.PI/180)*x.width/2-Math.cos(x.angle*Math.PI/180)*x.height/2];
 assert.ok(Math.abs(f(b)[0]-f(d)[0])<.0001);assert.ok(Math.abs(f(b)[1]-f(d)[1])<.0001);
});
await test('resize cannot invert at zero',()=>{const b=g.mediaBox(clip,{width:400,height:300},1280,720),c=g.dragTransform(clip,b,'e',-1e6,0,1280,720,false);assert.equal(c.scaleX,.05)});
await test('AI request omits media buffers',async()=>{const r=await req();assert.equal(r.project.clips[0].assetId,'asset1');assert.ok(!JSON.stringify(r).includes('blob:'));assert.ok(r.capabilities.includes('transform'))});
await test('empty prompt refused',async()=>await assert.rejects(()=>a.createAiRequest(project,'')));
await test('unknown AI operation refused',async()=>{const r=await req();assert.throws(()=>a.validateAiPlan(raw(r,[{type:'execute',code:'bad'}]),r))});
await test('prototype keys refused',async()=>{const r=await req(),p=raw(r,[{type:'speed',track:'video',id:'v1',value:2}]);const bad=JSON.parse(JSON.stringify(p).replace('"summary":','"__proto__":{},"summary":'));assert.throws(()=>a.validateAiPlan(bad,r))});
await test('nonfinite AI value refused',async()=>{const r=await req();assert.throws(()=>a.validateAiPlan(raw(r,[{type:'speed',track:'video',id:'v1',value:NaN}]),r))});
await test('out of range speed refused',async()=>{const r=await req();assert.throws(()=>a.validateAiPlan(raw(r,[{type:'speed',track:'video',id:'v1',value:99}]),r))});
await test('missing target refused',async()=>{const r=await req();assert.throws(()=>a.validateAiPlan(raw(r,[{type:'remove',track:'video',id:'missing'}]),r))});
await test('crop overlap refused',async()=>{const r=await req();assert.throws(()=>a.validateAiPlan(raw(r,[{type:'transform',id:'v1',patch:{cropLeft:.6,cropRight:.7}}]),r))});
await test('unknown patch fields refused',async()=>{const r=await req();assert.throws(()=>a.validateAiPlan(raw(r,[{type:'transform',id:'v1',patch:{url:'https://evil'}}]),r))});
await test('wrong request binding refused',async()=>{const r=await req();assert.throws(()=>a.validateAiPlan({...raw(r,[{type:'remove',track:'video',id:'v1'}]),requestId:'other'},r))});
await test('stale plan cannot overwrite edit',async()=>{const r=await req(),plan=a.validateAiPlan(raw(r,[{type:'speed',track:'video',id:'v1',value:2}]),r),changed=m.clone(project);changed.clips[0].volume=.4;await assert.rejects(()=>a.applyAiPlan(changed,r,plan))});
await test('failed batch cannot partly mutate original',async()=>{const r=await req(),before=JSON.stringify(project);assert.throws(()=>a.validateAiPlan(raw(r,[{type:'remove',track:'video',id:'v1'},{type:'speed',track:'video',id:'v1',value:2}]),r));assert.equal(JSON.stringify(project),before)});
await test('valid plan applies speed volume caption and shape',async()=>{
 const r=await req(),plan=a.validateAiPlan(raw(r,[
  {type:'speed',track:'video',id:'v1',value:2},{type:'volume',track:'audio',id:'a1',value:.4,muted:false},
  {type:'caption',text:'Title',from:0,to:2,fontId:'serif'},{type:'transform',id:'v1',patch:{shape:'ellipse',scaleX:.7}}
 ]),r),next=await a.applyAiPlan(project,r,plan);
 assert.equal(next.clips[0].speed,2);assert.equal(next.audio[0].volume,.4);assert.equal(next.texts[0].fontId,'serif');assert.equal(next.clips[0].shape,'ellipse');assert.equal(project.clips[0].speed,1);
 const h=new m.History(project);h.commit(next);h.undo();assert.equal(h.value.clips[0].speed,1);h.redo();assert.equal(h.value.texts.length,1);
});
await test('AI split maps source with speed',async()=>{const r=await req(),p=a.simulateAiPlan(project,a.validateAiPlan(raw(r,[{type:'split',track:'video',id:'v1',offset:3}]),r));assert.equal(p.clips[0].end,3);assert.equal(p.clips[1].start,3)});
await test('HTTP provider rejects external endpoint',()=>assert.throws(()=>new a.HttpAiProvider('https://example.com/api')));
await test('HTTP provider rejects protocol relative endpoint',()=>assert.throws(()=>new a.HttpAiProvider('//evil/api')));
await test('HTTP provider cancellation propagates',async()=>{
 const saved=global.fetch;let aborted=false;
 global.fetch=(_u,opts)=>new Promise((_ok,no)=>opts.signal.addEventListener('abort',()=>{aborted=true;no(new DOMException('Cancelled','AbortError'))}));
 try{const controller=new AbortController(),r=await req(),promise=new a.HttpAiProvider().createPlan(r,controller.signal);controller.abort();await assert.rejects(()=>promise);assert.equal(aborted,true);}finally{global.fetch=saved;}
});
console.log('EDITOR TOOLS ASSERTIONS',count);
})().catch(e=>{console.error(e);process.exit(1)});
