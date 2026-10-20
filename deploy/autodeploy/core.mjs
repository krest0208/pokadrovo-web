import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, chmodSync, openSync, fsyncSync, closeSync, utimesSync } from 'node:fs';
import { join, resolve, sep, dirname } from 'node:path';

export const TARGET = Object.freeze({ repo:'krest0208/pokadrovo-web', branch:'main', domain:'pokadrovo.ru', ip:'138.16.185.3', workflow:'check-web.yml',
  app:'/opt/pokadrovo/app', private:'/var/lib/pokadrovo', work:'/opt/pokadrovo/deploy-work', backups:'/opt/pokadrovo/backups', state:'/var/lib/pokadrovo-deploy', control:'/usr/local/lib/pokadrovo-deploy' });
export const isSha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function successfulRun(run, sha) {
  return isSha(sha) && run?.head_sha === sha && run.head_branch === TARGET.branch && run.event === 'push' && run.status === 'completed' && run.conclusion === 'success'
    && run.head_repository?.full_name === TARGET.repo && (run.path === '.github/workflows/check-web.yml' || run.path === '.github/workflows/check-web.yml@refs/heads/main' || run.path === '.github/workflows/check-web.yml@main');
}
export function child(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || relative.split('/').some(p => !p || p === '.' || p === '..')) throw Error('Unsafe relative path.');
  const path = resolve(root, relative); if (!path.startsWith(resolve(root) + sep)) throw Error('Path escapes its root.'); return path;
}
export function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  const info = lstatSync(path); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 65536) throw Error('Invalid agent state.');
  return JSON.parse(readFileSync(path, 'utf8'));
}
export function atomicJson(path, value) {
  if (existsSync(path) && !lstatSync(path).isFile()) throw Error('State path is not a regular file.');
  const temp = path + '.' + randomBytes(6).toString('hex');
  const fd=openSync(temp,'wx',0o600);try{writeFileSync(fd,JSON.stringify(value)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(temp,path);const dir=openSync(dirname(path),'r');try{fsyncSync(dir);}finally{closeSync(dir);}
}
export function inventory(root, {skip = new Set(), maxBytes = 128 * 1024 * 1024, maxFiles = 10000} = {}) {
  const files = []; let total = 0;
  function walk(directory, prefix) {
    const dir = lstatSync(directory); if (!dir.isDirectory() || dir.isSymbolicLink()) throw Error('Linked or special directory refused.');
    for (const name of readdirSync(directory).sort()) {
      const relative = prefix ? prefix + '/' + name : name; if (skip.has(relative)) continue;
      const path = child(root, relative), item = lstatSync(path);
      if (item.isSymbolicLink()) throw Error('Symbolic links are not deployment inputs.');
      if (item.isDirectory()) { walk(path, relative); continue; }
      if (!item.isFile() || item.nlink !== 1 || item.size > 32 * 1024 * 1024) throw Error('Special, linked or oversized file refused.');
      total += item.size; if (total > maxBytes || files.length >= maxFiles) throw Error('Release input limit exceeded.');
      files.push({path:relative, hash:digest(readFileSync(path)), bytes:item.size});
    }
  }
  walk(root, ''); return files;
}
function realDirectory(path) {
  const info=lstatSync(path);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Directory link refused.');
}
function inputFile(root, relative) {
  realDirectory(root);const parts=relative.split('/');let parent=root;
  for(const name of parts.slice(0,-1)){parent=child(parent,name);realDirectory(parent);}
  const path=child(root,relative), info=lstatSync(path);
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw Error('Input is not an unlinked regular file.');return path;
}
function publicDirectory(root, relative='') {
  if(!existsSync(root))mkdirSync(root,{mode:0o755});realDirectory(root);chmodSync(root,0o755);
  let path=root;for(const part of relative?relative.split('/'):[]){path=child(path,part);if(!existsSync(path))mkdirSync(path,{mode:0o755});realDirectory(path);chmodSync(path,0o755);}
}
export function copyFiles(source, destination, manifest, {skipExisting = false} = {}) {
  publicDirectory(destination);
  for (const entry of manifest) {
    const input=inputFile(source,entry.path), output=child(destination,entry.path);
    if(lstatSync(input).size!==entry.bytes)throw Error('Release size changed after validation.');
    const bytes=readFileSync(input);
    if (digest(bytes) !== entry.hash) throw Error('Release changed after validation.');
    publicDirectory(destination,entry.path.split('/').slice(0,-1).join('/'));
    let existing;try{existing=lstatSync(output);}catch(error){if(error.code!=='ENOENT')throw error;}
    if (existing) { if (!existing.isFile()||existing.isSymbolicLink()||existing.nlink!==1) throw Error('Invalid destination file.'); if (skipExisting) continue; }
    // Write exactly the bytes whose hash was checked, never reopen a build-controlled source path.
    writeFileSync(output,bytes); chmodSync(output,0o644);
    if(skipExisting){const info=lstatSync(input);utimesSync(output,info.atime,info.mtime);}
  }
}
export async function runCycle(io) {
  await io.recover();
  const state = await io.readState(), sha = await io.head();
  if (!isSha(sha)) throw Error('GitHub returned an invalid commit.');
  if (state?.deployedSha === sha) return {status:'unchanged', sha};
  if (state?.failedSha === sha && io.now() - state.failedAt < 15 * 60000) return {status:'cooldown', sha};
  if (!await io.green(sha)) return {status:'waiting-for-checks', sha};
  let prepared;
  try {
    prepared = await io.prepare(sha);
    if (await io.head() !== sha) return {status:'superseded', sha};
    await io.activate(prepared, sha, () => io.writeState({deployedSha:sha, deployedAt:io.now()}));
    return {status:'deployed', sha};
  } catch (error) {
    await io.writeState({...state, failedSha:sha, failedAt:io.now()}); throw error;
  } finally { if (prepared) await io.cleanup(prepared); }
}
function journalPaths(config, journal) {
  if (!journal || !isSha(journal.sha) || typeof journal.backup !== 'string' || typeof journal.stage !== 'string') throw Error('Invalid deployment journal.');
  const backup = resolve(journal.backup), stage = resolve(journal.stage);
  if (dirname(backup) !== resolve(config.backups) || !/^auto-[0-9]{14}-[0-9a-f]{7}-[0-9a-f]{8}$/.test(backup.slice(backup.lastIndexOf(sep)+1))) throw Error('Invalid backup binding.');
  if (dirname(dirname(stage)) !== resolve(config.work) || !/^release-[0-9a-f]{7}-[A-Za-z0-9]{6}$/.test(dirname(stage).split(sep).at(-1)) || stage.split(sep).at(-1) !== 'stage') throw Error('Invalid staged release binding.');
  return {backup, stage};
}
export async function recoverRelease(config, ops) {
  const pending = join(config.state, 'pending.json'), journal = readJson(pending); if (!journal) return false;
  const {backup, stage} = journalPaths(config, journal), saved = readJson(join(config.state, 'state.json'));
  const deployed = existsSync(config.app) ? readJson(join(config.app, 'dist/pokadrovo-release.json')) : null;
  if (saved?.deployedSha === journal.sha && deployed?.sha === journal.sha) { try { await ops.health(config.app, journal.sha); rmSync(pending); return true; } catch {} }
  await ops.service('stop');
  const previous = join(backup, 'app');
  if (existsSync(previous)) {
    if (!lstatSync(previous).isDirectory() || lstatSync(previous).isSymbolicLink()) throw Error('Invalid recovery directory.');
    if (existsSync(config.app)) renameSync(config.app, join(backup, 'failed-app-'+Date.now()));
    renameSync(previous, config.app);
  }
  if (!existsSync(config.app)) throw Error('No previous application to recover.');
  await ops.service('start'); await ops.health(config.app, null);
  atomicJson(join(config.state,'state.json'),{...(journal.previousState||{}),failedSha:journal.sha,failedAt:ops.now()});
  rmSync(pending); if (existsSync(stage)) rmSync(stage, {recursive:true}); return true;
}
export async function activateRelease(config, ops, prepared, sha, commit) {
  if (!isSha(sha)) throw Error('Invalid release.');
  const stamp = new Date(ops.now()).toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
  const backup = join(config.backups, `auto-${stamp}-${sha.slice(0,7)}-${randomBytes(4).toString('hex')}`);
  const journal = {sha, backup, stage:prepared.stage, previousState:readJson(join(config.state,'state.json'),{})}; journalPaths(config, journal);
  realDirectory(config.app);realDirectory(prepared.stage);
  mkdirSync(backup, {mode:0o700}); atomicJson(join(backup, 'agent.json'), {owner:'pokadrovo-autodeploy-v1', sha, at:ops.now()});
  atomicJson(join(config.state, 'pending.json'), journal);
  try {
    await ops.service('stop'); await ops.backupPrivate(backup);
    renameSync(config.app, join(backup, 'app')); renameSync(prepared.stage, config.app);
    await ops.service('start'); await ops.health(config.app, sha); await commit();
    rmSync(join(config.state, 'pending.json')); return backup;
  } catch (error) {
    try { await recoverRelease(config, ops); } catch (recovery) { throw new Error('Update failed; recovery is pending: '+recovery.message); }
    throw error;
  }
}

// Retain three previous working releases and three failed attempts. Never remove unowned backups.
export function pruneBackups(config, keep=3) {
  if(existsSync(join(config.state,'pending.json')))return;
  const buckets=[[],[]];
  for(const name of readdirSync(config.backups)){
    if(!/^auto-[0-9]{14}-[0-9a-f]{7}-[0-9a-f]{8}$/.test(name))continue;
    const path=join(config.backups,name), info=lstatSync(path);if(!info.isDirectory()||info.isSymbolicLink())continue;
    let meta;try{meta=readJson(join(path,'agent.json'));}catch{continue;}if(meta?.owner!=='pokadrovo-autodeploy-v1'||!Number.isFinite(meta.at))continue;
    buckets[existsSync(join(path,'app'))?0:1].push({path,at:meta.at});
  }
  for(const group of buckets)for(const old of group.sort((a,b)=>b.at-a.at).slice(keep))rmSync(old.path,{recursive:true});
}
