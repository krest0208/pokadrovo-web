import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';

const root=fileURLToPath(new URL('..',import.meta.url));
test('inline preview excludes server document markup and nested script markers',()=>{
  const scratch=resolve(root,'.compiled');mkdirSync(scratch,{recursive:true});
  const directory=mkdtempSync(resolve(scratch,'fragment-test-'));
  try{
    const file=resolve(directory,'preview.html');
    execFileSync(process.execPath,['tools/build-chat-preview.mjs',file,'--ai-settings'],{cwd:root});
    const fragment=readFileSync(file,'utf8');
    // Match the inline visualization validator, including markup inside JS strings.
    assert.doesNotMatch(fragment,/<!doctype\s|<\s*(?:html|head|body)(?:\s|>)/i);
    assert.doesNotMatch(fragment,/\/owner-assets\//);
    assert.equal((fragment.match(/<script\b/gi)||[]).length,1);
    assert.equal((fragment.match(/<\/script\s*>/gi)||[]).length,1);
    assert.match(fragment,/id="pokadrovo-chat-preview" data-start="ai"/);
    assert.ok(Buffer.byteLength(fragment)<1_000_000);
    const script=fragment.slice(fragment.indexOf('<script>')+8,fragment.lastIndexOf('</script>'));
    assert.doesNotThrow(()=>new Script(script));
  }finally{rmSync(directory,{recursive:true,force:true});}
});
