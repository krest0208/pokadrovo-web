import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync, linkSync, lstatSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { TARGET, successfulRun, isSha, child, inventory, copyFiles, atomicJson, readJson, runCycle, activateRelease, recoverRelease, pruneBackups } from '../../deploy/autodeploy/core.mjs';
import { githubClient, limitedJson, buildUnitArgs } from '../../deploy/autodeploy/agent.mjs';
import { buildSteps } from '../../deploy/autodeploy/worker.mjs';
const sha='a'.repeat(40), other='b'.repeat(40), root=fileURLToPath(new URL('../..',import.meta.url));
const success={id:42,head_sha:sha,head_branch:'main',event:'push',status:'completed',conclusion:'success',path:'.github/workflows/check-web.yml',head_repository:{full_name:TARGET.repo}};
function temp(){return mkdtempSync(join(tmpdir(),'pk-autodeploy-'));}
function fixture(){
  const directory=temp(),cfg={app:join(directory,'app'),state:join(directory,'state'),backups:join(directory,'backups'),work:join(directory,'work')};
  for(const path of Object.values(cfg))mkdirSync(path);
  mkdirSync(join(cfg.app,'dist'));writeFileSync(join(cfg.app,'dist/index.html'),'old');
  const work=mkdtempSync(join(cfg.work,'release-aaaaaaa-')),stage=join(work,'stage');mkdirSync(stage);mkdirSync(join(stage,'dist'));writeFileSync(join(stage,'dist/index.html'),'new');
  atomicJson(join(stage,'dist/pokadrovo-release.json'),{sha});
  const events=[];let bad=false;
  const ops={now:()=>Date.UTC(2026,9,20,12),service:async action=>events.push(action),backupPrivate:async path=>{events.push('private-backup');writeFileSync(join(path,'private.tar.gz'),'private bytes');},health:async(app,current)=>{events.push(current?'health-new':'health-old');if(bad&&readFileSync(join(app,'dist/index.html'),'utf8')==='new')throw Error('bad new health');}};
  return {directory,cfg,prepared:{work,stage},ops,events,failHealth:()=>{bad=true;},close:()=>rmSync(directory,{recursive:true,force:true})};
}
function cycle(overrides={}){let state={};const events=[];const io={recover:async()=>events.push('recover'),readState:async()=>state,writeState:async value=>{state=value;events.push('state');},now:()=>10000000,head:async()=>sha,green:async()=>true,prepare:async()=>{events.push('prepare');return {};},activate:async(_p,_s,commit)=>{events.push('activate');await commit();},cleanup:async()=>events.push('cleanup'),...overrides};return {io,events,get state(){return state;}};}

test('deployment accepts only successful main push checks from the exact repository and workflow',()=>{
  assert.equal(successfulRun(success,sha),true);
  for(const patch of [{head_sha:other},{head_branch:'other'},{event:'pull_request'},{status:'in_progress'},{conclusion:'failure'},{path:'.github/workflows/other.yml'},{head_repository:{full_name:'someone/fork'}},{head_repository:null}])assert.equal(successfulRun({...success,...patch},sha),false);
  for(const value of ['main','../main','A'.repeat(40),'a'.repeat(39),null])assert.equal(isSha(value),false);
});
test('GitHub API filters head and rejects redirect/network failures rather than falling back',async()=>{
  const urls=[];const client=githubClient(async(url,options)=>{urls.push(url);assert.equal(options.redirect,'error');assert.ok(!('Authorization' in options.headers));return Response.json(url.includes('/runs?')?{workflow_runs:[success]}:{ref:'refs/heads/main',object:{type:'commit',sha}});});
  assert.equal(await client.head(),sha);assert.equal(await client.green(sha),true);assert.ok(urls[1].includes('head_sha='+sha));assert.ok(urls.every(u=>u.startsWith('https://api.github.com/repos/'+TARGET.repo+'/')));
  const newer=githubClient(async()=>Response.json({workflow_runs:[success,{...success,id:43,status:'in_progress',conclusion:null}]}));assert.equal(await newer.green(sha),false);
  await assert.rejects(githubClient(async()=>new Response('limited',{status:403})).head(),/unavailable/);
  await assert.rejects(limitedJson(new Response('x'.repeat(200)),30),/limit/);
});
test('unchanged head, incomplete checks and cooldown never build or restart the website',async()=>{
  for(const overrides of [{readState:async()=>({deployedSha:sha})},{green:async()=>false},{readState:async()=>({failedSha:sha,failedAt:9999999})}]){const f=cycle(overrides);const result=await runCycle(f.io);assert.ok(['unchanged','waiting-for-checks','cooldown'].includes(result.status));assert.ok(!f.events.includes('prepare'));assert.ok(!f.events.includes('activate'));}
});
test('newer main head cancels an obsolete prepared release and cleans its workspace',async()=>{
  let n=0;const f=cycle({head:async()=>++n===1?sha:other});assert.equal((await runCycle(f.io)).status,'superseded');assert.deepEqual(f.events,['recover','prepare','cleanup']);
});
test('successful cycle publishes the exact checked SHA and failure retains the last working SHA',async()=>{
  const f=cycle();assert.equal((await runCycle(f.io)).status,'deployed');assert.equal(f.state.deployedSha,sha);assert.deepEqual(f.events,['recover','prepare','activate','state','cleanup']);
  const failed=cycle({readState:async()=>({deployedSha:other}),activate:async()=>{throw Error('failed health');}});await assert.rejects(runCycle(failed.io),/health/);assert.equal(failed.state.deployedSha,other);assert.equal(failed.state.failedSha,sha);assert.ok(failed.events.includes('cleanup'));
});
test('builder has no production paths, root capabilities or writable paths outside its source',()=>{
  const source='/opt/pokadrovo/deploy-work/release-aaaaaaa-ABC123/source';const {args}=buildUnitArgs(source,sha);
  for(const expected of ['--property=User=pokadrovo-build','--property=NoNewPrivileges=yes','--property=ProtectSystem=strict','--property=CapabilityBoundingSet=','--property=ReadWritePaths='+source,'--property=KillMode=control-group','--property=BindsTo=pokadrovo-autodeploy.service'])assert.ok(args.includes(expected));
  assert.ok(args.some(x=>x.includes('InaccessiblePaths=/var/lib/pokadrovo /var/lib/pokadrovo-deploy')));
  assert.throws(()=>buildUnitArgs('/var/lib/pokadrovo/source',sha));const steps=buildSteps(root);assert.deepEqual(steps[0][1],['ci','--ignore-scripts','--include=dev','--no-audit','--no-fund']);assert.ok(steps.some(([,a])=>a.includes('server/tests/autodeploy.test.mjs')));
});
test('service socket restrictions permit the real Linux network interface check',t=>{
  if(process.platform!=='linux')return t.skip('Linux socket filtering regression');
  const nodeProbe="import { networkInterfaces } from 'node:os'; networkInterfaces(); process.stdout.write('interface-check-ok');";
  const baseline=spawnSync(process.execPath,['--input-type=module','-e',nodeProbe],{encoding:'utf8',timeout:15000});
  assert.ifError(baseline.error);
  if(baseline.status!==0&&/uv_interface_addresses/.test(baseline.stderr))return t.skip('host sandbox already blocks network interface enumeration');
  assert.equal(baseline.status,0,baseline.stderr);
  const unit=readFileSync(join(root,'deploy/autodeploy/pokadrovo-autodeploy.service'),'utf8');
  const families=unit.match(/^RestrictAddressFamilies=(.+)$/m)?.[1].trim().split(/\s+/);
  assert.ok(families?.length,'service must define its socket allow list');
  // Apply the service allow list with a real seccomp filter in a child only.
  // The negative control reproduces the VPS error instead of just checking a config string.
  const probe=String.raw`
import ctypes,os,socket,sys
try:lib=ctypes.CDLL('libseccomp.so.2')
except OSError:sys.exit(77)
class ArgCmp(ctypes.Structure):
 _fields_=[('arg',ctypes.c_uint),('op',ctypes.c_uint),('a',ctypes.c_uint64),('b',ctypes.c_uint64)]
lib.seccomp_init.argtypes=[ctypes.c_uint32];lib.seccomp_init.restype=ctypes.c_void_p
lib.seccomp_syscall_resolve_name.argtypes=[ctypes.c_char_p];lib.seccomp_syscall_resolve_name.restype=ctypes.c_int
lib.seccomp_rule_add_array.argtypes=[ctypes.c_void_p,ctypes.c_uint32,ctypes.c_int,ctypes.c_uint,ctypes.POINTER(ArgCmp)]
lib.seccomp_load.argtypes=[ctypes.c_void_p];lib.seccomp_release.argtypes=[ctypes.c_void_p]
allowed={getattr(socket,name) for name in sys.argv[3:]}
ctx=lib.seccomp_init(0x7fff0000)
assert ctx,'seccomp_init failed'
try:
 syscall=lib.seccomp_syscall_resolve_name(b'socket');assert syscall>=0
 for family in range(64):
  if family not in allowed:
   comparison=ArgCmp(0,4,family,0)
   assert lib.seccomp_rule_add_array(ctx,0x00050000|97,syscall,1,ctypes.byref(comparison))==0
 assert lib.seccomp_load(ctx)==0,'seccomp_load failed'
finally:lib.seccomp_release(ctx)
os.execvp(sys.argv[1],[sys.argv[1],'--input-type=module','-e',sys.argv[2]])
`;
  const check=list=>spawnSync('python3',['-B','-c',probe,process.execPath,nodeProbe,...list],{encoding:'utf8',timeout:15000});
  const blocked=check(families.filter(f=>f!=='AF_NETLINK'));
  if(blocked.status===77)return t.skip('libseccomp unavailable');
  assert.ifError(blocked.error);assert.notEqual(blocked.status,0);assert.match(blocked.stderr,/uv_interface_addresses/);
  const permitted=check(families);assert.ifError(permitted.error);assert.equal(permitted.status,0,permitted.stderr);assert.equal(permitted.stdout,'interface-check-ok');
});
test('validated copy rejects traversal, links, modified source and preserves public permissions under private umask',()=>{
  const dir=temp(),source=join(dir,'source'),dest=join(dir,'dest');mkdirSync(source);mkdirSync(dest);mkdirSync(join(source,'nested'));writeFileSync(join(source,'nested/file.txt'),'checked');
  try{for(const path of ['../x','/tmp/x','a/../x','a\\x','a//x'])assert.throws(()=>child(source,path));
    const manifest=inventory(source),mask=process.umask(0o077);try{copyFiles(source,dest,manifest);}finally{process.umask(mask);}
    assert.equal(lstatSync(dest).mode&0o777,0o755);assert.equal(lstatSync(join(dest,'nested')).mode&0o777,0o755);assert.equal(lstatSync(join(dest,'nested/file.txt')).mode&0o777,0o644);
    writeFileSync(join(source,'nested/file.txt'),'modified');assert.throws(()=>copyFiles(source,dest,manifest),/changed/);
    symlinkSync('/etc',join(source,'linked'));assert.throws(()=>inventory(source),/links/);rmSync(join(source,'linked'));
    linkSync(join(source,'nested/file.txt'),join(source,'hardlink'));assert.throws(()=>inventory(source),/linked/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('copy refuses a destination directory symlink and a swapped source parent',()=>{
  const dir=temp(),source=join(dir,'source'),dest=join(dir,'dest'),outside=join(dir,'outside');for(const p of [source,dest,outside])mkdirSync(p);mkdirSync(join(source,'a'));writeFileSync(join(source,'a/file'),'value');
  try{const manifest=inventory(source);symlinkSync(outside,join(dest,'a'));assert.throws(()=>copyFiles(source,dest,manifest),/link/);assert.equal(existsSync(join(outside,'file')),false);rmSync(join(dest,'a'));
    renameSync(join(source,'a'),join(outside,'a'));symlinkSync(join(outside,'a'),join(source,'a'));assert.throws(()=>copyFiles(source,dest,manifest),/link/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('activation backs up private data while stopped and commits only after new health succeeds',async()=>{
  const f=fixture();try{await activateRelease(f.cfg,f.ops,f.prepared,sha,()=>atomicJson(join(f.cfg.state,'state.json'),{deployedSha:sha}));assert.equal(readFileSync(join(f.cfg.app,'dist/index.html'),'utf8'),'new');assert.equal(readJson(join(f.cfg.state,'state.json')).deployedSha,sha);assert.equal(existsSync(join(f.cfg.state,'pending.json')),false);assert.deepEqual(f.events,['stop','private-backup','start','health-new']);}finally{f.close();}
});
test('failed health restores the previous application without restoring or deleting private data',async()=>{
  const f=fixture();try{f.failHealth();await assert.rejects(activateRelease(f.cfg,f.ops,f.prepared,sha,()=>assert.fail('must not commit')),/bad new health/);assert.equal(readFileSync(join(f.cfg.app,'dist/index.html'),'utf8'),'old');assert.equal(existsSync(join(f.cfg.state,'pending.json')),false);assert.equal(readJson(join(f.cfg.state,'state.json')).failedSha,sha);assert.deepEqual(f.events,['stop','private-backup','start','health-new','stop','start','health-old']);}finally{f.close();}
});
test('interrupted directory switch recovers on next run and a second recovery is a no-op',async()=>{
  const f=fixture();try{const backup=join(f.cfg.backups,'auto-20261020120000-aaaaaaa-12345678');mkdirSync(backup);renameSync(f.cfg.app,join(backup,'app'));atomicJson(join(f.cfg.state,'pending.json'),{sha,backup,stage:f.prepared.stage,previousState:{deployedSha:other}});
    assert.equal(await recoverRelease(f.cfg,f.ops),true);assert.equal(readFileSync(join(f.cfg.app,'dist/index.html'),'utf8'),'old');assert.equal(readJson(join(f.cfg.state,'state.json')).deployedSha,other);assert.equal(await recoverRelease(f.cfg,f.ops),false);
  }finally{f.close();}
});
test('recovery cannot consume a forged backup path or a linked state file',async()=>{
  const f=fixture();try{atomicJson(join(f.cfg.state,'pending.json'),{sha,backup:'/var/lib/pokadrovo',stage:f.prepared.stage});await assert.rejects(recoverRelease(f.cfg,f.ops),/backup binding/);assert.equal(f.events.length,0);rmSync(join(f.cfg.state,'pending.json'));symlinkSync('/etc/passwd',join(f.cfg.state,'pending.json'));await assert.rejects(recoverRelease(f.cfg,f.ops),/state/);}finally{f.close();}
});
test('backup retention touches only owned completed-attempt directories and pauses during recovery',()=>{
  const f=fixture();try{const unowned=join(f.cfg.backups,'private-user-backup');mkdirSync(unowned);
    for(let i=0;i<5;i++){const path=join(f.cfg.backups,`auto-2026102012000${i}-aaaaaaa-12345678`);mkdirSync(path);mkdirSync(join(path,'app'));atomicJson(join(path,'agent.json'),{owner:'pokadrovo-autodeploy-v1',at:i});}
    atomicJson(join(f.cfg.state,'pending.json'),{sha});pruneBackups(f.cfg);assert.equal(existsSync(join(f.cfg.backups,'auto-20261020120000-aaaaaaa-12345678')),true);rmSync(join(f.cfg.state,'pending.json'));pruneBackups(f.cfg);assert.equal(existsSync(join(f.cfg.backups,'auto-20261020120000-aaaaaaa-12345678')),false);assert.equal(existsSync(unowned),true);
  }finally{f.close();}
});
test('archive extractor refuses private files, traversal, links, duplicates and the wrong commit root',()=>{
  const directory=temp();try{const result=spawnSync('python3',['-B','-c',`
import importlib.util,io,tarfile,pathlib,sys
spec=importlib.util.spec_from_file_location('pk_unpack',sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
base=pathlib.Path(sys.argv[2]);sha='a'*40;prefix='pokadrovo-web-'+sha+'/'
required=['package-lock.json','src/AiHome.tsx','server/app.mjs','shared/coin-pricing.json']
def archive(name,extra,linked=False):
 path=base/(name+'.tar.gz')
 with tarfile.open(path,'w:gz') as tar:
  for entry in required+extra:
   info=tarfile.TarInfo(entry if entry.startswith('/') or entry.startswith('wrong-') else prefix+entry)
   if linked and entry==extra[-1]:info.type=tarfile.SYMTYPE;info.linkname='/etc/passwd';tar.addfile(info)
   else:info.size=2;tar.addfile(info,io.BytesIO(b'{}'))
 dest=base/name;dest.mkdir();return path,dest
ok,dest=archive('ok',[]);assert module.unpack(ok,dest,sha)==4
for i,(extra,linked) in enumerate([(['../escape'],False),(['/tmp/escape'],False),(['.env'],False),(['server/owner.sqlite'],False),(['public/x'],True),(['src/AiHome.tsx'],False),(['wrong-root/src/x'],False)]):
 path,dest=archive('bad'+str(i),extra,linked)
 try:module.unpack(path,dest,sha)
 except ValueError:pass
 else:raise AssertionError('accepted '+str(extra))
assert not (base/'escape').exists()
print('Archive checks passed')
`,join(root,'deploy/autodeploy/unpack.py'),directory],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/passed/);}finally{rmSync(directory,{recursive:true,force:true});}
});

test('a committed but uncleared journal keeps a healthy release and restores an unhealthy one',async()=>{
  for(const bad of [false,true]){
    const f=fixture();try{
      const backup=join(f.cfg.backups,'auto-20261020120000-aaaaaaa-12345678');mkdirSync(backup);renameSync(f.cfg.app,join(backup,'app'));renameSync(f.prepared.stage,f.cfg.app);
      atomicJson(join(f.cfg.state,'state.json'),{deployedSha:sha});atomicJson(join(f.cfg.state,'pending.json'),{sha,backup,stage:f.prepared.stage,previousState:{deployedSha:other}});
      if(bad)f.failHealth();await recoverRelease(f.cfg,f.ops);
      assert.equal(readFileSync(join(f.cfg.app,'dist/index.html'),'utf8'),bad?'old':'new');assert.equal(readJson(join(f.cfg.state,'state.json')).deployedSha,bad?other:sha);assert.equal(existsSync(join(f.cfg.state,'pending.json')),false);
    }finally{f.close();}
  }
});

test('deployment copy cannot overwrite an unrelated file through a destination hard link',()=>{
  const dir=temp(),source=join(dir,'source'),dest=join(dir,'dest'),privateFile=join(dir,'private.txt');mkdirSync(source);mkdirSync(dest);writeFileSync(join(source,'file'),'public');writeFileSync(privateFile,'preserve');linkSync(privateFile,join(dest,'file'));
  try{assert.throws(()=>copyFiles(source,dest,inventory(source)),/destination/);assert.equal(readFileSync(privateFile,'utf8'),'preserve');}finally{rmSync(dir,{recursive:true,force:true});}
});
