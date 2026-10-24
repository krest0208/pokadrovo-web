import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';

// Production and standalone deliveries intentionally run without node_modules.
export async function buildMailRuntime(){
 await mkdir('dist/server',{recursive:true});
 await build({entryPoints:['server/smtp-transport.cjs'],outfile:'dist/server/mail-transport.cjs',bundle:true,platform:'node',format:'cjs',target:'node22',legalComments:'eof'});
 await copyFile('node_modules/nodemailer/LICENSE','dist/server/nodemailer-LICENSE.txt');
}
