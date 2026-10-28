import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

const bundle=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {AuthDialog} from './src/account/AccountViews';export function render(legal){return renderToStaticMarkup(React.createElement(AuthDialog,{session:{user:null,csrf:'test',providers:[],accountsEnabled:true,legal},theme:'light',onClose:()=>{},onSuccess:()=>{}}));}`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'cjs',platform:'node',external:['react','react-dom/server','motion','motion/*'],loader:{'.css':'empty','.webp':'dataurl'}});
const module={exports:{}};
vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:createRequire(import.meta.url),process,console});
const render=legal=>module.exports.render({version:'test-version',salesReady:false,edition:'test',links:{},...legal});
const submitAttributes=html=>html.match(/<button class="au-primary au-submit"([^>]*)>/)?.[1];

test('opening only registration enables signup, links the exact accepted revision, and leaves all three user consents unchecked',()=>{
 const html=render({ready:false,registrationReady:true});
 assert.doesNotMatch(submitAttributes(html),/disabled/);
 assert.doesNotMatch(html,/Регистрация временно закрыта/);
 assert.match(html,/href="\/legal\/terms\?version=test-version"/);
 assert.match(html,/href="\/legal\/consent\?version=test-version"/);
 for(const name of ['terms','privacy','adult']){
  const input=html.match(new RegExp('<input[^>]*name="'+name+'"[^>]*>'))?.[0];
  assert.ok(input);assert.match(input,/required/);assert.doesNotMatch(input,/checked|disabled/);
 }
 assert.match(html,/minLength="14"/);
});

test('closed registration stays disabled, including an explicit closed state alongside an old ready field',()=>{
 for(const legal of [{ready:false,registrationReady:false},{ready:true,registrationReady:false}]){
  const html=render(legal);assert.match(submitAttributes(html),/disabled/);assert.match(html,/Регистрация временно закрыта/);
 }
});

test('full approved publication remains compatible with older session responses',()=>{
 for(const legal of [{ready:true},{ready:true,registrationReady:true}]){
  const html=render(legal);assert.doesNotMatch(submitAttributes(html),/disabled/);assert.doesNotMatch(html,/Регистрация временно закрыта/);
 }
});
