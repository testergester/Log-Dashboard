import {defineConfig} from 'vite';
import {readFileSync} from 'node:fs';
const config=JSON.parse(readFileSync(new URL('./firebase-web-config.json',import.meta.url)));
export default defineConfig({base:'./',define:Object.fromEntries(Object.entries(config).map(([k,v])=>['import.meta.env.'+k,JSON.stringify(v)])),build:{outDir:'web-dist',rollupOptions:{input:{dashboard:'index.html',analysis:'analysis.html'}}}});
