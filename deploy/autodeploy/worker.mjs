// This fixed worker is installed outside the application and runs as pokadrovo-build.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function buildSteps(source) {
  const tests = readdirSync(join(source,'server/tests')).filter(n=>n.endsWith('.test.mjs')).sort().map(n=>'server/tests/'+n);
  return [
    ['/usr/bin/npm',['ci','--ignore-scripts','--include=dev','--no-audit','--no-fund']],
    [process.execPath,['--test','--test-concurrency=1',...tests,'tests/guest-storage.test.mjs','tests/admin-navigation.test.mjs']],
    [process.execPath,['node_modules/typescript/bin/tsc','--noEmit']],
    [process.execPath,['node_modules/vite/bin/vite.js','build']],
    [process.execPath,['tools/test-editor.cjs']],
    [process.execPath,['tools/test-editor-features.cjs']],
    [process.execPath,['--test','--test-concurrency=1','tests/standalone.test.mjs']]
  ];
}
export function buildSource(source, execute = spawnSync) {
  source=resolve(source);
  if (!source.startsWith('/opt/pokadrovo/deploy-work/release-') || !source.endsWith('/source')) throw Error('Unexpected build location.');
  if (process.getuid?.()===0) throw Error('Builds must not run as root.');
  const scratch=join(source,'.deploy-test-tmp');mkdirSync(scratch,{mode:0o700});
  for (const [command,args] of buildSteps(source)) {
    const result=execute(command,args,{cwd:source,stdio:'inherit',timeout:240000,env:{...process.env,
      NODE_ENV:'production',TMPDIR:scratch,NODE_OPTIONS:'--max-old-space-size=384',npm_config_cache:join(source,'.npm-cache'),npm_config_userconfig:'/dev/null',npm_config_update_notifier:'false'}});
    if (result.status!==0 || result.error) throw Error('Isolated build or validation failed.');
  }
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try { if(process.argv.length!==3)throw Error('Pass one source directory.');buildSource(process.argv[2]); }
  catch(error){console.error(error.message);process.exitCode=1;}
}
