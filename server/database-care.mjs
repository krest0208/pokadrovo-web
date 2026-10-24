import {backup,DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync,lstatSync,existsSync,readdirSync,statSync,statfsSync,accessSync,constants} from 'node:fs';
import {copyFile,mkdtemp,writeFile,rename,rm,chmod} from 'node:fs/promises';
import {join,basename} from 'node:path';

const DAY=86400000,MAX_DATABASE=128*1024*1024,MAX_HISTORY=512*1024*1024;
const namePattern=/^snapshot-\d{13}-[A-Za-z0-9_-]+$/;
export function createDatabaseCare({store,now,autoStart=true,initialDelay=60000,interval=5*60000,backupImpl=backup}){
 const directory=join(store.dir,'backups');let active=null,initial=null,timer=null,stopped=false,healthCache=null;
 const remembered=()=>{try{return JSON.parse(store.get("SELECT value FROM meta WHERE key='database_backup_state'")?.value||'{}');}catch{return {};}};
 function remember(value){store.run("INSERT INTO meta(key,value) VALUES('database_backup_state',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(value));}
 function ensureDirectory(){if(existsSync(directory)&&lstatSync(directory).isSymbolicLink())throw Error('UNSAFE_BACKUP_DIRECTORY');mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);}
 function snapshots(){
  if(!existsSync(directory)||lstatSync(directory).isSymbolicLink())return [];
  return readdirSync(directory).filter(n=>namePattern.test(n)).flatMap(n=>{
   const folder=join(directory,n);if(lstatSync(folder).isSymbolicLink()||!lstatSync(folder).isDirectory())return [];
   const file=join(folder,'owner.sqlite'),key=join(folder,'master.key'),stamp=Number(n.split('-')[1]);
   if(!existsSync(file)||!existsSync(key)||lstatSync(file).isSymbolicLink()||lstatSync(key).isSymbolicLink()||statSync(key).size!==32)return [];
   return [{name:n,created:stamp,bytes:statSync(file).size+32}];
  }).sort((a,b)=>b.created-a.created);
 }
 function inspect(){
  let integrity=false,writable=false,foreignKeys=false,wal=false,schemaReady=false,users=0,projects=0,codes=0;
  try{integrity=store.all('PRAGMA quick_check').every(row=>Object.values(row)[0]==='ok');foreignKeys=store.get('PRAGMA foreign_keys').foreign_keys===1;wal=store.get('PRAGMA journal_mode').journal_mode==='wal';
   const names=new Set(store.all("SELECT name FROM sqlite_master WHERE type='table'").map(x=>x.name));schemaReady=['users','user_sessions','account_projects','account_legal_acceptances','account_recovery','coin_wallets','coin_ledger','payment_orders','meta'].every(n=>names.has(n));accessSync(store.dir,constants.W_OK);writable=true;users=store.get('SELECT count(*) n FROM users').n;projects=store.get('SELECT count(*) n FROM account_projects').n;codes=store.get('SELECT count(*) n FROM account_recovery').n;
  }catch{schemaReady=false;}
  let history=[];try{history=snapshots();}catch{}
  const last=remembered();
  return {healthy:integrity&&writable&&foreignKeys&&wal&&schemaReady,integrity,writable,foreignKeys,wal,schemaReady,
   users,projects,
   backup:{running:!!active,automatic:autoStart,lastSuccess:last.lastSuccess||null,lastAttempt:last.lastAttempt||null,error:last.error||'',copies:history.map(({created,bytes})=>({created,bytes})),retentionDays:7,maxCopies:7,localOnly:true},
   recovery:{accountsWithCode:codes,emailDelivery:false}};
 }
 function snapshot(){
  if(active)return active;if(stopped)return Promise.reject(Error('BACKUP_STOPPED'));
  const work=async()=>{
   const previous=remembered();let temporary;
   remember({...previous,lastAttempt:now(),error:''});
   try{
    ensureDirectory();const source=join(store.dir,'owner.sqlite'),pages=store.get('PRAGMA page_count').page_count,pageSize=store.get('PRAGMA page_size').page_size,size=Math.max(statSync(source).size,pages*pageSize)+(existsSync(source+'-wal')?statSync(source+'-wal').size:0);
    if(size>MAX_DATABASE)throw Error('DATABASE_TOO_LARGE');
    const disk=statfsSync(store.dir);if(disk.bavail*disk.bsize<size*2+256*1024*1024)throw Error('LOW_DISK_SPACE');
    temporary=await mkdtemp(join(directory,'.pending-'));await chmod(temporary,0o700);
    const target=join(temporary,'owner.sqlite');
    await backupImpl(store.db,target,{rate:64,progress:()=>{if(stopped)throw Error('BACKUP_STOPPED');}});
    await chmod(target,0o600);
    const checked=new DatabaseSync(target,{readOnly:true});try{
     if(!checked.prepare('PRAGMA quick_check').all().every(row=>Object.values(row)[0]==='ok')||checked.prepare('PRAGMA foreign_key_check').all().length)throw Error('INVALID_SNAPSHOT');
    }finally{checked.close();}
    await copyFile(join(store.dir,'master.key'),join(temporary,'master.key'),constants.COPYFILE_EXCL);await chmod(join(temporary,'master.key'),0o600);
    const created=now(),name='snapshot-'+created+'-'+basename(temporary).slice(9);
    await writeFile(join(temporary,'manifest.json'),JSON.stringify({format:1,created,contents:['owner.sqlite','master.key'],localOnly:true}),{mode:0o600,flag:'wx'});
    await rename(temporary,join(directory,name));temporary=null;
    remember({lastAttempt:created,lastSuccess:created,error:''});
    const history=snapshots();let total=0,kept=0;
    for(const old of history){total+=old.bytes;kept++;if(kept>1&&(kept>7||old.created<now()-7*DAY||total>MAX_HISTORY)){await rm(join(directory,old.name),{recursive:true,force:true});total-=old.bytes;}}
    store.audit('database_backup','ok',now());const result=inspect();result.backup.running=false;return result;
   }catch(error){if(temporary)await rm(temporary,{recursive:true,force:true}).catch(()=>{});
    const messages={LOW_DISK_SPACE:'Недостаточно свободного места для безопасной копии.',DATABASE_TOO_LARGE:'База превысила лимит автоматической копии. Требуется отдельная настройка хранения.',UNSAFE_BACKUP_DIRECTORY:'Каталог копий имеет небезопасный тип.',INVALID_SNAPSHOT:'Проверка копии не прошла.',BACKUP_STOPPED:'Копирование остановлено при завершении сервера.'};
    remember({...previous,lastAttempt:now(),error:messages[error.message]||'Не удалось создать резервную копию. Проверьте доступ и свободное место.'});store.audit('database_backup','failed',now());throw Error('Не удалось создать копию. Подробности доступны в состоянии базы.');
   }
  };
  active=work().finally(()=>{active=null;});return active;
 }
 function tick(){if(stopped||active)return;const last=remembered();if(!last.lastSuccess||now()-last.lastSuccess>=DAY)void snapshot().catch(()=>{});}
 function start(){if(!autoStart||timer||initial)return;initial=setTimeout(()=>{initial=null;tick();},initialDelay);initial.unref();timer=setInterval(tick,interval);timer.unref();}
 function stop(){stopped=true;clearTimeout(initial);clearInterval(timer);return active;}
 function health(){if(!healthCache||now()-healthCache.at>=60000){let healthy=false;try{healthy=inspect().healthy;}catch{}healthCache={at:now(),healthy};}return healthCache.healthy;}
 return {inspect,health,snapshot,start,stop,get running(){return !!active;}};
}
