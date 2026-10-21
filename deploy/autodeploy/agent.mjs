import { spawnSync } from 'node:child_process';
import { createWriteStream, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, statfsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { TARGET, isSha, successfulRun, inventory, copyFiles, atomicJson, readJson, runCycle, recoverRelease, activateRelease, pruneBackups } from './core.mjs';

export function command(file, args, options = {}) {
  const result = spawnSync(file, args, {encoding:'utf8', timeout:30000, maxBuffer:1024*1024, ...options});
  if (result.error || result.status !== 0) throw Error('System command failed: '+file);
  return result.stdout?.trim() || '';
}
export async function limitedJson(response, limit=1024*1024) {
  if (!response.ok || !response.body) throw Object.assign(Error('GitHub or health endpoint unavailable ('+response.status+').'),{status:response.status});
  const reader=response.body.getReader(), chunks=[];let bytes=0;
  try { while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>limit)throw Object.assign(Error('Response limit exceeded.'),{code:'RESPONSE_TOO_LARGE'});chunks.push(part.value);} }
  finally {await reader.cancel().catch(()=>{});}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(Error('Invalid JSON response.'),{code:'INVALID_JSON'});}
}
const transientNetworkCodes=new Set(['ECONNRESET','ECONNREFUSED','EPIPE','ETIMEDOUT','EAI_AGAIN','ENOTFOUND','ENETUNREACH','EHOSTUNREACH','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT']);
function requestFailure(error) {
  if(Number.isInteger(error?.status))return {reason:'HTTP '+error.status,retry:[408,500,502,503,504].includes(error.status)};
  const codes=new Set(),seen=new Set(),pending=[error];let timeout=false;
  for(let i=0;pending.length&&i<12;i++){
    const current=pending.shift();if(!current||seen.has(current))continue;seen.add(current);
    if(current.name==='TimeoutError')timeout=true;
    if(typeof current.code==='string'&&/^[A-Z][A-Z0-9_]{1,63}$/.test(current.code))codes.add(current.code);
    if(current.cause)pending.push(current.cause);
    if(Array.isArray(current.errors))pending.push(...current.errors.slice(0,6));
  }
  if(codes.size)return {reason:[...codes].join(', '),retry:[...codes].every(code=>transientNetworkCodes.has(code))};
  if(timeout)return {reason:'TIMEOUT',retry:true};
  if(error?.name==='TypeError'&&error.message==='fetch failed')return {reason:'FETCH_FAILED',retry:true};
  return {reason:'INVALID_RESPONSE',retry:false};
}
export async function fetchJsonWithRetry(url,{label='JSON request',fetcher=globalThis.fetch,headers={},timeout=15000,limit=1024*1024,wait=ms=>new Promise(done=>setTimeout(done,ms)),log=console.warn}={}) {
  for(let attempt=1;attempt<=3;attempt++){
    const signal=AbortSignal.timeout(timeout);
    try {
      // No connection is kept idle across the long synchronous VPS build.
      const response=await fetcher(url,{method:'GET',redirect:'manual',signal,headers:{...headers,Connection:'close'}});
      if(!response.ok){await response.body?.cancel().catch(()=>{});throw Object.assign(Error('HTTP request failed.'),{status:response.status});}
      return await limitedJson(response,limit);
    }catch(error){
      const failure=requestFailure(signal.aborted?signal.reason:error);
      if(!failure.retry||attempt===3)throw Error(label+' unavailable ('+failure.reason+'; '+attempt+' attempt'+(attempt===1?'':'s')+').');
      const delay=attempt===1?1000:3000;
      log(label+': '+failure.reason+'; retry '+(attempt+1)+'/3 in '+delay/1000+'s.');
      await wait(delay);
    }
  }
}
export function githubClient(fetcher=globalThis.fetch,retryOptions={}) {
  async function api(path,label){
    return fetchJsonWithRetry('https://api.github.com/repos/'+TARGET.repo+path,{...retryOptions,label,fetcher,headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'pokadrovo-autodeploy/1'}});
  }
  return {
    async head(label='GitHub main lookup'){const ref=await api('/git/ref/heads/main',label);if(ref.ref!=='refs/heads/main'||ref.object?.type!=='commit'||!isSha(ref.object.sha))throw Error('Unexpected main ref.');return ref.object.sha;},
    async green(sha){if(!isSha(sha))throw Error('Invalid commit.');const data=await api('/actions/workflows/check-web.yml/runs?branch=main&event=push&head_sha='+sha+'&per_page=10','GitHub CI lookup');
      // Only the newest attempt/run for this head can authorize a deployment.
      const candidates=(data.workflow_runs||[]).filter(r=>r.head_sha===sha&&r.event==='push'&&r.head_branch==='main').sort((a,b)=>b.id-a.id);
      return !!candidates.length && successfulRun(candidates[0],sha);
    }
  };
}
export function verifyHost(config=TARGET, run=command) {
  if(process.getuid?.()!==0)throw Error('Agent requires its installed service account.');
  if(!Object.values(networkInterfaces()).flat().some(n=>n?.address===config.ip))throw Error('This agent belongs only on the Pokadrovo VPS.');
  if(run('/usr/bin/systemctl',['show','-p','User','--value','pokadrovo.service'])!=='pokadrovo'||run('/usr/bin/systemctl',['show','-p','WorkingDirectory','--value','pokadrovo.service'])!==config.app)throw Error('Unexpected website service.');
  const appUid=Number(run('/usr/bin/id',['-u','pokadrovo'])),buildUid=Number(run('/usr/bin/id',['-u','pokadrovo-build']));
  if(!Number.isInteger(appUid)||appUid<=0||!Number.isInteger(buildUid)||buildUid<=0||buildUid===appUid||run('/usr/bin/id',['-Gn','pokadrovo-build'])!=='pokadrovo-build')throw Error('Build and website accounts must stay separate.');
  const environment=run('/usr/bin/systemctl',['show','-p','Environment','--value','pokadrovo.service']);
  for(const expected of ['POKADROVO_PUBLIC_ORIGIN=https://pokadrovo.ru','POKADROVO_DATA_DIR=/var/lib/pokadrovo','POKADROVO_HOST=127.0.0.1'])if(!environment.split(/\s+/).includes(expected))throw Error('Website origin or storage does not match.');
  for(const path of [config.private,config.state,config.work,config.backups,config.control])if(!existsSync(path)||!lstatSync(path).isDirectory()||lstatSync(path).isSymbolicLink())throw Error('Unexpected installation directory.');
}
export function buildUnitArgs(source, sha, config=TARGET) {
  if(!isSha(sha)||!source.startsWith(config.work+'/release-')||!source.endsWith('/source'))throw Error('Unexpected build target.');
  const unit='pokadrovo-build-'+sha.slice(0,12)+'-'+process.pid;
  return {unit,args:['--wait','--pipe','--collect','--unit='+unit,
    '--property=User=pokadrovo-build','--property=Group=pokadrovo-build','--property=WorkingDirectory='+source,
    '--property=BindsTo=pokadrovo-autodeploy.service','--property=RuntimeMaxSec=900','--property=TimeoutStopSec=10','--property=KillMode=control-group',
    '--property=NoNewPrivileges=yes','--property=ProtectSystem=strict','--property=ProtectHome=yes','--property=PrivateTmp=yes','--property=PrivateDevices=yes',
    '--property=ProtectKernelTunables=yes','--property=ProtectKernelModules=yes','--property=ProtectControlGroups=yes','--property=RestrictSUIDSGID=yes',
    '--property=CapabilityBoundingSet=','--property=MemoryMax=640M','--property=TasksMax=128','--property=ReadWritePaths='+source,
    '--property=InaccessiblePaths=/var/lib/pokadrovo /var/lib/pokadrovo-deploy /opt/pokadrovo/app /opt/pokadrovo/backups',
    '/usr/bin/node',join(config.control,'worker.mjs'),source]};
}
async function downloadArchive(sha, output) {
  if(!isSha(sha))throw Error('Invalid release.');
  const response=await fetch('https://codeload.github.com/'+TARGET.repo+'/tar.gz/'+sha,{redirect:'error',signal:AbortSignal.timeout(120000),headers:{'User-Agent':'pokadrovo-autodeploy/1'}});
  if(!response.ok||!response.body)throw Error('Source archive unavailable.');
  let bytes=0;
  async function* limited(stream){for await(const chunk of stream){bytes+=chunk.length;if(bytes>16*1024*1024)throw Error('Archive download limit exceeded.');yield chunk;}}
  await pipeline(limited(Readable.fromWeb(response.body)),createWriteStream(output,{mode:0o600,flags:'wx'}));
}
async function prepare(sha, config=TARGET) {
  const disk=statfsSync(config.work);if(Number(disk.bavail)*Number(disk.bsize)<512*1024*1024)throw Error('Not enough free space for an isolated release build.');
  const work=mkdtempSync(join(config.work,'release-'+sha.slice(0,7)+'-'));
  chmodSync(work,0o755);
  const source=join(work,'source'),stage=join(work,'stage');mkdirSync(source,{mode:0o755});
  try {
    const archive=join(work,'source.tar.gz');await downloadArchive(sha,archive);
    command('/usr/bin/python3',[join(config.control,'unpack.py'),archive,source,sha]);
    const original=inventory(source);
    command('/usr/bin/chown',['--no-dereference','-R','pokadrovo-build:pokadrovo-build',source]);
    const build=buildUnitArgs(source,sha,config);
    try { command('/usr/bin/systemd-run',build.args,{stdio:'inherit',timeout:950000}); }
    finally { spawnSync('/usr/bin/systemctl',['stop',build.unit+'.service'],{stdio:'ignore',timeout:15000}); }
    // npm packages and repository build scripts never run with production credentials or as root.
    const after=inventory(source,{skip:new Set(['node_modules','.npm-cache','.deploy-test-tmp','.compiled','dist'])});
    if(JSON.stringify(after)!==JSON.stringify(original))throw Error('Build modified checked-out source files.');
    mkdirSync(stage,{mode:0o755});chmodSync(stage,0o755);copyFiles(source,stage,original);
    const built=inventory(join(source,'dist'));if(!built.some(f=>f.path==='index.html')||!built.some(f=>f.path.startsWith('assets/')))throw Error('Incomplete production build.');
    copyFiles(join(source,'dist'),join(stage,'dist'),built);
    if(existsSync(join(config.app,'dist/assets'))){const old=inventory(join(config.app,'dist/assets'),{maxBytes:256*1024*1024});const recent=old.filter(entry=>Date.now()-lstatSync(join(config.app,'dist/assets',entry.path)).mtimeMs<7*86400000);copyFiles(join(config.app,'dist/assets'),join(stage,'dist/assets'),recent,{skipExisting:true});}
    const indexPath=join(stage,'dist/index.html'),index=readFileSync(indexPath,'utf8');if(!index.includes('</head>'))throw Error('Build has no document head.');
    writeFileSync(indexPath,index.replace('</head>',`<meta name="pokadrovo-release" content="${sha}"/></head>`));
    atomicJson(join(stage,'dist/pokadrovo-release.json'),{sha,repository:TARGET.repo,deployedAt:new Date().toISOString()});
    // Public static files must be readable by the existing website user.
    chmodSync(join(stage,'dist/pokadrovo-release.json'),0o644);
    return {work,stage};
  } catch(error){rmSync(work,{recursive:true,force:true});throw error;}
}
function local(path) {
  return new Promise((resolveResponse,reject)=>{
    const req=httpRequest({hostname:'127.0.0.1',port:5173,path,headers:{Host:TARGET.domain},timeout:4000},res=>{
      const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){req.destroy(Error('Health response too large.'));return;}chunks.push(chunk);});
      res.on('end',()=>resolveResponse({status:res.statusCode,body:Buffer.concat(chunks)}));res.on('error',reject);
    });req.on('timeout',()=>req.destroy(Error('Health timeout.')));req.on('error',reject);req.end();
  });
}
async function health(app,sha) {
  const index=readFileSync(join(app,'dist/index.html'));
  let valid=false;
  for(let attempt=0;attempt<12;attempt++){
    try {const result=await local('/api/health');if(result.status===200&&JSON.parse(result.body).ok===true){valid=true;break;}}catch{}
    await new Promise(resolveWait=>setTimeout(resolveWait,500));
  }
  if(!valid)throw Error('Website did not become healthy.');
  const page=await local('/');if(page.status!==200||!page.body.equals(index))throw Error('Website is serving another build.');
  if((await local('/api/account/projects')).status!==401)throw Error('Private project access check failed.');
  if(sha){const marker=await local('/pokadrovo-release.json');if(marker.status!==200||JSON.parse(marker.body).sha!==sha)throw Error('Release marker does not match.');
    const external=await fetchJsonWithRetry('https://pokadrovo.ru/api/health',{label:'Pokadrovo HTTPS health check',timeout:8000,limit:65536});if(external.ok!==true)throw Error('HTTPS health check failed.');}
}
export function linuxAdapter(config=TARGET) {
  const client=githubClient();
  const ops={now:Date.now,service:async action=>{if(!['start','stop'].includes(action))throw Error('Unsupported service action.');command('/usr/bin/systemctl',[action,'pokadrovo.service'],{timeout:45000});},health,
    backupPrivate:async backup=>{command('/usr/bin/tar',['-C','/var/lib','-czf',join(backup,'private.tar.gz'),'pokadrovo'],{timeout:60000});}};
  return {...client,now:Date.now,log:message=>console.log('Pokadrovo deployment: '+message),
    readState:()=>readJson(join(config.state,'state.json'),{}),writeState:value=>atomicJson(join(config.state,'state.json'),value),
    recover:()=>recoverRelease(config,ops),prepare:sha=>prepare(sha,config),
    activate:(prepared,sha,commit)=>activateRelease(config,ops,prepared,sha,commit),
    cleanup:prepared=>{if(!prepared.work.startsWith(config.work+'/release-'))throw Error('Invalid cleanup binding.');rmSync(prepared.work,{recursive:true,force:true});}
  };
}
export async function main() {
  if(process.argv.length!==2)throw Error('The installed agent accepts no commands or target overrides.');
  if(!/^[0-9a-f]{32}$/.test(process.env.INVOCATION_ID||''))throw Error('Start the installed systemd service.');
  verifyHost();
  try {const result=await runCycle(linuxAdapter());console.log(JSON.stringify({domain:TARGET.domain,...result}));}
  finally {pruneBackups(TARGET);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){main().catch(error=>{console.error('Pokadrovo deployment stopped: '+error.message);process.exitCode=1;});}
