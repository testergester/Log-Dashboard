import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
mkdirSync('tests/preview',{recursive:true});
await build({entryPoints:['app.js'],bundle:true,outdir:'tests/preview/dist',format:'esm',inject:['tests/fixture-globals.mjs']});
writeFileSync('tests/preview/index.html',readFileSync('index.html','utf8').replace('</body>','<output id="fixture-result" style="display:block;padding:20px;word-break:break-all"></output></body>'));
