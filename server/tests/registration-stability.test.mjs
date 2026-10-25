import test from 'node:test';
import assert from 'node:assert/strict';
import {usingAccounts} from './account-fixture.mjs';
import {token} from '../security.mjs';
import {legalAcceptance} from './legal-fixture.mjs';
import {createPasswordWork} from '../password-work.mjs';

const credentials=email=>{const password=token();return {email,password,confirmPassword:password,...legalAcceptance};};
const gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

test('bounded password work accepts a short burst in order and rejects overload without extra hashing',async()=>{
 const q=createPasswordWork({concurrency:2,maxPending:2,waitMs:1000}),release=gate(),starts=[];
 const work=n=>q.run(async()=>{starts.push(n);if(n<2)await release.promise;return n;});
 const jobs=[work(0),work(1),work(2),work(3)];await assert.rejects(work(4),e=>e.status===429);assert.deepEqual(q.state(),{active:2,pending:2});release.resolve();assert.deepEqual(await Promise.all(jobs),[0,1,2,3]);assert.deepEqual(starts,[0,1,2,3]);
});
test('waiting password work times out and failed work releases capacity',async()=>{
 const q=createPasswordWork({concurrency:1,maxPending:1,waitMs:15}),release=gate();const first=q.run(()=>release.promise);let ran=false;await assert.rejects(q.run(()=>{ran=true;}),e=>e.status===429);assert.equal(ran,false);release.resolve();await first;await assert.rejects(q.run(()=>{throw Error('synthetic failure');}));assert.equal(await q.run(()=>42),42);
});
test('ten simultaneous signups create independent profiles without manual approval or mail', {timeout:30000},()=>usingAccounts(async f=>{
 const requests=await Promise.all(Array.from({length:10},async(_,i)=>{const client=f.client();await client('/api/account/session');const data=credentials('burst-'+i+'@example.test');return {client,data};}));
 const results=await Promise.all(requests.map(x=>x.client('/api/account/register','POST',x.data)));assert.deepEqual(results.map(r=>r.status),Array(10).fill(201));assert.equal(new Set(results.map(r=>r.data.user.id)).size,10);
 for(let i=0;i<requests.length;i++){assert.equal((await requests[i].client('/api/account/session')).data.user.id,results[i].data.user.id);assert.ok(results[i].data.recoveryCode);}
 assert.equal(f.store.get('SELECT count(*) n FROM users').n,10);assert.equal(f.store.get('SELECT count(*) n FROM account_legal_acceptances').n,10);assert.equal(f.mail.state().quota.used,0);
}));
test('an optional mail queue failure cannot turn committed signup into an error or remove its recovery code',()=>usingAccounts(async f=>{
 f.mail.save({enabled:true,sender:'noreply@pokadrovo.ru',username:'synthetic-login',smtpPassword:token(),confirmed:true});f.mail.enqueue=()=>{throw Error('synthetic mail enqueue failure');};
 const a=await f.signup();assert.ok(a.code);assert.equal((await a.send('/api/account/session')).data.user.id,a.id);assert.equal(f.store.get('SELECT count(*) n FROM account_legal_acceptances WHERE account_id=?',a.id).n,1);assert.equal(f.store.get("SELECT count(*) n FROM audit WHERE action='registration_mail_failed'")?.n,1);
}));
test('first-session storage failure rolls back the entire signup and does not publish an account cookie',()=>usingAccounts(async f=>{
 const client=f.client();await client('/api/account/session');const data=credentials('rollback@example.test'),run=f.store.run;
 f.store.run=(sql,...args)=>{if(sql.startsWith('INSERT INTO user_sessions'))throw Error('synthetic session storage failure');return run(sql,...args);};
 let result;try{result=await client('/api/account/register','POST',data);}finally{f.store.run=run;}
 assert.equal(result.status,500);assert.equal((result.headers['set-cookie']||[]).some(x=>x.startsWith('pk-user-local=')),false);
 for(const table of ['users','user_sessions','account_recovery','account_legal_acceptances'])assert.equal(f.store.get('SELECT count(*) n FROM '+table).n,0,table);
 assert.equal((await client('/api/account/register','POST',data)).status,201);
}));
test('racing signup requests for one email create one complete account, not partial duplicates',()=>usingAccounts(async f=>{
 const x=f.client(),y=f.client();await x('/api/account/session');await y('/api/account/session');const data=credentials('same@example.test');const results=await Promise.all([x('/api/account/register','POST',data),y('/api/account/register','POST',data)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 for(const table of ['users','user_sessions','account_recovery','account_legal_acceptances'])assert.equal(f.store.get('SELECT count(*) n FROM '+table).n,1,table);
}));
