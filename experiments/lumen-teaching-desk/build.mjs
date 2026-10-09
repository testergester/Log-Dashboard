import { build } from 'esbuild';
await build({entryPoints:['app.js'],bundle:true,outdir:'dist',format:'esm',minify:true,legalComments:'eof'});
