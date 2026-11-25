import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'vite';
await build();
const assets={};
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())await walk(file);else assets['/'+path.relative('web-dist',file)]={type:types[path.extname(file)]||'application/octet-stream',body:(await readFile(file)).toString('base64')};}}
await walk('web-dist');
await writeFile('worker/assets.generated.js','export default '+JSON.stringify(assets)+';\n');
await build({configFile:false,build:{outDir:'dist/server',lib:{entry:'worker/index.js',formats:['es'],fileName:()=> 'index.js'},minify:true}});
await mkdir('dist/.openai',{recursive:true});await copyFile('.openai/hosting.json','dist/.openai/hosting.json');
