import test from 'node:test';
import assert from 'node:assert/strict';
import {mailMessage} from '../server/email.mjs';
import {readFile} from 'node:fs/promises';

test('ready delivery contains a self-contained SMTP runtime and its license',async()=>{
 const {default:createTransport}=await import('../dist/server/mail-transport.cjs');
 const transport=createTransport({streamTransport:true,buffer:true,newline:'unix'});
 const result=await transport.sendMail(mailMessage({kind:'test',to:'synthetic@example.test'},'noreply@pokadrovo.ru'));
 assert.ok(Buffer.isBuffer(result.message));const wire=result.message.toString();assert.match(wire,/From:/);assert.match(wire,/To: synthetic@example.test/);assert.match(wire,/Content-Type: multipart\/alternative/);assert.match(wire,/pokadrovo\.ru/);
 assert.ok((await readFile(new URL('../dist/server/nodemailer-LICENSE.txt',import.meta.url),'utf8')).length>100);transport.close();
});
