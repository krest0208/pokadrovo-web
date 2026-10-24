import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {request as http} from 'node:http';
import {createApp} from '../app.mjs';
import {token,provisionOwner} from '../security.mjs';
import {prepareLegal,legalAcceptance} from './legal-fixture.mjs';

export async function usingAccounts(fn,options={}){
 const dir=mkdtempSync(join(tmpdir(),'pk-account-care-'));mkdirSync(join(dir,'dist'));writeFileSync(join(dir,'dist/index.html'),'<!doctype html><title>Test</title>');let clock=Date.now();
 const app=createApp({origin:'http://localhost:5173',dataDir:join(dir,'private'),dist:join(dir,'dist'),accountsEnabled:true,guestEditingEnabled:true,siteAgentAutoStart:false,backupsAutoStart:false,mailAutoStart:false,now:()=>clock,...options});
 prepareLegal(app);const password=token();await provisionOwner(app.store,'test_owner',password);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 function client(){const jar=new Map();let csrf='',account='';const send=async(path,method='GET',data,headers={})=>new Promise((resolve,reject)=>{
  const req=http({host:'127.0.0.1',port:app.server.address().port,path,method,headers:{Host:'localhost:5173',Origin:'http://localhost:5173','Content-Type':'application/json','X-CSRF-Token':csrf,'X-PK-Account':account,Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...headers}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{for(const c of res.headers['set-cookie']||[]){const [k,v]=c.split(';')[0].split('=');if(v)jar.set(k,v);else jar.delete(k);}const raw=Buffer.concat(chunks).toString();let value;try{value=JSON.parse(raw);}catch{value=raw;}if(value.csrf)csrf=value.csrf;if(value.user)account=value.user.id;resolve({status:res.statusCode,data:value,raw,headers:res.headers});});});req.on('error',reject);if(data!==undefined)req.write(JSON.stringify(data));req.end();});return send;}
 const owner=client(),guest=client();await owner('/api/admin/login','POST',{login:'test_owner',password});
 async function signup(email='one@example.test'){const send=client(),password=token();await send('/api/account/session');const response=await send('/api/account/register','POST',{email,password,confirmPassword:password,...legalAcceptance});if(response.status!==201)throw Error('Synthetic registration failed: '+response.status);return {send,password,email,id:response.data.user.id,code:response.data.recoveryCode};}
 try{await fn({...app,dir,owner,guest,client,signup,password,now:()=>clock,advance:n=>{clock+=n;}});}finally{await new Promise(r=>app.server.close(r));rmSync(dir,{recursive:true,force:true});}
}
