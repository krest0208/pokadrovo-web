import {HttpError} from './http.mjs';

// Bound both expensive scrypt work and waiting requests; a short signup burst need not fail immediately.
export function createPasswordWork({concurrency=2,maxPending=8,waitMs=8000}={}){
 let active=0;const pending=[];
 const busy=()=>new HttpError(429,'Сейчас много запросов на вход. Подождите несколько секунд и повторите.');
 function execute(entry){
  clearTimeout(entry.timer);active++;
  Promise.resolve().then(entry.job).then(entry.resolve,entry.reject).finally(()=>{active--;const next=pending.shift();if(next)execute(next);});
 }
 function run(job){return new Promise((resolve,reject)=>{
  const entry={job,resolve,reject,timer:null};
  if(active<concurrency&&!pending.length){execute(entry);return;}
  if(pending.length>=maxPending){reject(busy());return;}
  entry.timer=setTimeout(()=>{const i=pending.indexOf(entry);if(i>=0){pending.splice(i,1);reject(busy());}},waitMs);
  pending.push(entry);
 });}
 return {run,state:()=>({active,pending:pending.length})};
}
