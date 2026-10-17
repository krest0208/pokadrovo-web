// Runs offline once npm dependencies are installed. No network or deployment.
const fs=require('fs'),path=require('path'),cp=require('child_process'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.compiled');
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'package.json'),'{"type":"commonjs"}');
for(const name of fs.readdirSync(path.join(root,'src/editor')).filter(n=>n.endsWith('.ts'))){
 const text=fs.readFileSync(path.join(root,'src/editor',name),'utf8');
 const result=ts.transpileModule(text,{fileName:name,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
 fs.writeFileSync(path.join(out,name.replace(/\.ts$/,'.js')),result.outputText);
}
const result=cp.spawnSync(process.execPath,['tests/editor-tools.test.cjs'],{cwd:root,stdio:'inherit'});
process.exit(result.status===null?1:result.status);
