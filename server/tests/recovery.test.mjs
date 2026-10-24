import test from 'node:test';
import assert from 'node:assert/strict';
import {usingAccounts} from './account-fixture.mjs';
import {token} from '../security.mjs';
import {legalTestConfig} from './legal-fixture.mjs';

test('registration shows an offline code once and persists only its keyed digest',()=>usingAccounts(async f=>{
 const a=await f.signup();assert.match(a.code,/^(?:[A-F0-9]{6}-){7}[A-F0-9]{6}$/);
 const stored=f.store.get('SELECT * FROM account_recovery WHERE user_id=?',a.id);assert.ok(stored.digest);assert.equal(JSON.stringify(stored).includes(a.code),false);
 assert.equal((await a.send('/api/account/session')).data.recoveryCode,undefined);const metadata=await a.send('/api/account/recovery-code');assert.equal(metadata.data.configured,true);assert.equal(metadata.raw.includes(a.code),false);
 const users=await f.owner('/api/admin/users');assert.equal(users.raw.includes(a.code),false);assert.equal(users.raw.includes(stored.digest),false);
}));

test('unknown email, incorrect account code and an account without a code share a non-enumerating error',()=>usingAccounts(async f=>{
 const a=await f.signup(),b=await f.signup('two@example.test');f.store.run('DELETE FROM account_recovery WHERE user_id=?',b.id);
 await f.guest('/api/account/session');const next=token(),errors=[];
 for(const [email,code] of [['missing@example.test',a.code],[a.email,'A'.repeat(48)],[b.email,a.code]]){const r=await f.guest('/api/account/recover','POST',{email,recoveryCode:code,newPassword:next,confirmPassword:next});assert.equal(r.status,400);errors.push(r.data.error);}
 assert.equal(new Set(errors).size,1);assert.equal((await f.guest('/api/account/recover','POST',{email:'test_owner',recoveryCode:a.code,newPassword:next,confirmPassword:next})).status,400);
}));

test('reset is CSRF protected, preserves account data and wallet, revokes every old session and consumes the proof once',()=>usingAccounts(async f=>{
 const a=await f.signup(),device=f.client();await device('/api/account/session');assert.equal((await device('/api/account/login','POST',{email:a.email,password:a.password})).status,200);
 const project={id:'persist',schema:4,name:'Saved',mode:'video',ratio:'16:9',clips:[],audio:[],texts:[],created:f.now(),modified:f.now(),master:1};await a.send('/api/account/projects','PUT',{project});f.store.run('INSERT INTO coin_wallets(account_id,coins) VALUES(?,?)',a.id,23);
 await f.guest('/api/account/session');const next=token(),data={email:a.email,recoveryCode:a.code,newPassword:next,confirmPassword:next};
 assert.equal((await f.guest('/api/account/recover','POST',data,{'X-CSRF-Token':'wrong'})).status,403);
 assert.equal((await f.guest('/api/account/recover','POST',{...data,newPassword:'short',confirmPassword:'short'})).status,400);
 const reset=await f.guest('/api/account/recover','POST',data);assert.equal(reset.status,200,reset.raw);assert.notEqual(reset.data.recoveryCode,a.code);
 assert.equal((await a.send('/api/account/session')).data.user,null);assert.equal((await device('/api/account/session')).data.user,null);assert.equal((await f.guest('/api/account/session')).data.user,null);
 assert.equal((await f.guest('/api/account/recover','POST',data)).status,400);
 assert.equal((await f.guest('/api/account/login','POST',{email:a.email,password:next})).status,200);
 assert.equal((await f.guest('/api/account/projects')).data.projects[0].id,'persist');assert.equal(f.store.get('SELECT coins FROM coin_wallets WHERE account_id=?',a.id).coins,23);assert.equal(f.store.get('SELECT count(*) n FROM account_legal_acceptances WHERE account_id=?',a.id).n,1);
}));

test('concurrent resets cannot spend the same recovery proof twice',()=>usingAccounts(async f=>{
 const a=await f.signup(),x=f.client(),y=f.client();await x('/api/account/session');await y('/api/account/session');const pw=token(),data={email:a.email,recoveryCode:a.code,newPassword:pw,confirmPassword:pw};
 const responses=await Promise.all([x('/api/account/recover','POST',data),y('/api/account/recover','POST',data)]);assert.equal(responses.filter(r=>r.status===200).length,1);assert.equal(responses.filter(r=>r.status===400).length,1);
}));

test('code rotation needs the current user password and rejects owner or cross-origin operations',()=>usingAccounts(async f=>{
 const a=await f.signup();assert.equal((await f.guest('/api/account/recovery-code')).status,401);assert.equal((await f.owner('/api/account/recovery-code','POST',{password:f.password})).status,403);
 assert.equal((await a.send('/api/account/recovery-code','POST',{password:'wrong'})).status,403);assert.equal((await a.send('/api/account/recovery-code','POST',{password:a.password},{Origin:'https://other.example.test'})).status,403);
 const rotated=await a.send('/api/account/recovery-code','POST',{password:a.password});assert.equal(rotated.status,200);assert.notEqual(rotated.data.recoveryCode,a.code);
 await f.guest('/api/account/session');const next=token();assert.equal((await f.guest('/api/account/recover','POST',{email:a.email,recoveryCode:a.code,newPassword:next,confirmPassword:next})).status,400);
}));

test('password changes replace recovery proof, and recovery remains available while new registration is paused',()=>usingAccounts(async f=>{
 const a=await f.signup(),next=token();const changed=await a.send('/api/account/password','POST',{password:a.password,newPassword:next,confirmPassword:next});assert.equal(changed.status,200);assert.ok(changed.data.recoveryCode);
 await f.owner('/api/admin/legal','PUT',{...legalTestConfig,published:false,password:f.password});await f.guest('/api/account/session');const last=token();assert.equal((await f.guest('/api/account/recover','POST',{email:a.email,recoveryCode:a.code,newPassword:last,confirmPassword:last})).status,400);
 assert.equal((await f.guest('/api/account/recover','POST',{email:a.email,recoveryCode:changed.data.recoveryCode,newPassword:last,confirmPassword:last})).status,200);
}));

test('failed recovery attempts are throttled without changing the account password',()=>usingAccounts(async f=>{
 const a=await f.signup();await f.guest('/api/account/session');for(let i=0;i<6;i++)assert.equal((await f.guest('/api/account/recover','POST',{email:a.email,recoveryCode:'wrong'})).status,400);
 assert.equal((await f.guest('/api/account/recover','POST',{email:a.email,recoveryCode:a.code,newPassword:token()})).status,429);
 assert.equal((await f.guest('/api/account/login','POST',{email:a.email,password:a.password})).status,200);
}));
