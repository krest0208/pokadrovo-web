import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync,statSync,mkdirSync,cpSync,symlinkSync,existsSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {backup} from 'node:sqlite';
import {usingAccounts} from './account-fixture.mjs';
import {openStore,checkPassword} from '../security.mjs';
import {createDatabaseCare} from '../database-care.mjs';

test('database health and backup controls require owner access, CSRF and reauthentication',()=>usingAccounts(async f=>{
 const a=await f.signup();const publicHealth=await f.guest('/api/health');assert.equal(publicHealth.data.databaseReady,true);assert.equal(publicHealth.data.users,undefined);assert.equal(publicHealth.raw.includes(f.store.dir),false);assert.equal((await f.guest('/api/admin/database')).status,401);assert.equal((await a.send('/api/admin/database')).status,401);
 const state=await f.owner('/api/admin/database');assert.equal(state.status,200);assert.equal(state.data.healthy,true);assert.equal(state.data.users,1);assert.equal(state.data.registration.legalReady,true);assert.equal(state.raw.includes(f.store.dir),false);assert.equal(state.raw.includes(a.code),false);
 assert.equal((await f.owner('/api/admin/database/backup','POST',{password:f.password},{'X-CSRF-Token':'bad'})).status,403);assert.equal((await f.owner('/api/admin/database/backup','POST',{password:'wrong'})).status,403);
 for(const path of ['/backups','/.pokadrovo-private/backups','/owner.sqlite','/master.key'])assert.equal((await f.guest(path)).status,404);
}));

test('online backup contains a consistent database and matching key, has private permissions and is restorable',()=>usingAccounts(async f=>{
 const a=await f.signup();f.store.run('UPDATE settings SET secret=? WHERE id=1',f.store.seal('synthetic-provider-secret'));
 const result=await f.owner('/api/admin/database/backup','POST',{password:f.password});assert.equal(result.status,200,result.raw);assert.equal(result.data.backup.copies.length,1);
 const dir=join(f.store.dir,'backups'),name=readdirSync(dir).find(n=>n.startsWith('snapshot-')),snapshot=join(dir,name);assert.equal(statSync(snapshot).mode&0o777,0o700);for(const file of ['owner.sqlite','master.key','manifest.json'])assert.equal(statSync(join(snapshot,file)).mode&0o777,0o600);
 assert.equal(result.raw.includes(name),false);assert.equal(result.raw.includes('synthetic-provider-secret'),false);assert.deepEqual(readFileSync(join(snapshot,'master.key')),readFileSync(join(f.store.dir,'master.key')));
 const target=join(f.dir,'restored');mkdirSync(target);cpSync(snapshot,target,{recursive:true});const restored=openStore(target);try{assert.equal(restored.get('SELECT count(*) n FROM users').n,1);assert.equal(await checkPassword(a.password,restored.get('SELECT password FROM users WHERE id=?',a.id).password),true);assert.equal(restored.get('SELECT user_id FROM account_recovery').user_id,a.id);assert.equal(restored.unseal(restored.get('SELECT secret FROM settings').secret),'synthetic-provider-secret');}finally{restored.close();}
}));

test('failed or invalid snapshots never replace a successful copy or leave partial secrets behind',()=>usingAccounts(async f=>{
 let invalid=false;const care=createDatabaseCare({store:f.store,now:f.now,autoStart:false,backupImpl:async(db,path,options)=>invalid?writeFile(path,'not-a-database'):backup(db,path,options)});
 await care.snapshot();const good=care.inspect().backup.lastSuccess;f.advance(1000);invalid=true;await assert.rejects(care.snapshot());const status=care.inspect();assert.equal(status.backup.lastSuccess,good);assert.equal(status.backup.copies.length,1);assert.ok(status.backup.error);assert.equal(readdirSync(join(f.store.dir,'backups')).some(n=>n.startsWith('.pending-')),false);care.stop();
}));

test('daily retention bounds stored snapshots without deleting unrelated private files',()=>usingAccounts(async f=>{
 for(let i=0;i<9;i++){await f.databaseCare.snapshot();f.advance(86400000);}
 const state=f.databaseCare.inspect();assert.ok(state.backup.copies.length<=7);assert.ok(state.backup.copies.length>=1);assert.ok(state.backup.copies.every(c=>c.created>=f.now()-7*86400000));assert.ok(existsSync(join(f.store.dir,'master.key')));assert.ok(existsSync(join(f.store.dir,'owner.sqlite')));
}));

test('backup directory symlinks are rejected and no data are written outside the private backup directory',()=>usingAccounts(async f=>{
 const outside=join(f.dir,'outside');mkdirSync(outside);symlinkSync(outside,join(f.store.dir,'backups'),'dir');await assert.rejects(f.databaseCare.snapshot());assert.deepEqual(readdirSync(outside),[]);assert.match(f.databaseCare.inspect().backup.error,/небезопасный/);
}));


test('automatic schedule creates a daily verified copy and avoids repeated copies during the same day',()=>usingAccounts(async f=>{
 const care=createDatabaseCare({store:f.store,now:f.now,autoStart:true,initialDelay:1,interval:25});
 const waitFor=async check=>{const until=Date.now()+10000;while(!check()){if(Date.now()>until)throw Error('Scheduled backup did not finish');await new Promise(r=>setTimeout(r,25));}};
 care.start();try{await waitFor(()=>!!care.inspect().backup.lastSuccess&&!care.running);const first=care.inspect().backup.lastSuccess;assert.equal(care.inspect().backup.copies.length,1);
 await new Promise(r=>setTimeout(r,75));assert.equal(care.inspect().backup.copies.length,1);f.advance(86400001);await waitFor(()=>care.inspect().backup.lastSuccess>first&&!care.running);assert.equal(care.inspect().backup.copies.length,2);
 }finally{await care.stop();}
}));
