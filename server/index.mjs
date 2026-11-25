import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTimetableApi} from './timetable-api.mjs';
for(const file of ['.env.local','.env.server']){try{process.loadEnvFile(file);}catch(e){if(e.code!=='ENOENT')throw e;}}
process.env.NODE_ENV='production';
if(process.env.FIREBASE_AUTH_EMULATOR_HOST||process.env.VITE_USE_FIREBASE_EMULATORS==='true')throw new Error('Production cannot use Firebase emulators.');
if(!process.env.FIREBASE_PROJECT_ID&&!process.env.VITE_FIREBASE_PROJECT_ID)throw new Error('Set FIREBASE_PROJECT_ID on the server.');
if(!process.env.DEEPSEEK_API_KEY)throw new Error('Set DEEPSEEK_API_KEY as a private server environment variable.');
if(!process.env.APP_ORIGIN)throw new Error('Set APP_ORIGIN to the public HTTPS dashboard origin (or http://127.0.0.1:PORT for a local production test).');
const origin=new URL(process.env.APP_ORIGIN);
if(origin.origin!==process.env.APP_ORIGIN||!(origin.protocol==='https:'||(origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname))))throw new Error('APP_ORIGIN must be an exact HTTPS origin without a trailing slash; HTTP is allowed only for local testing.');
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'../dist');
await stat(path.join(root,'index.html')).catch(()=>{throw new Error('Missing production build. Run pnpm build before pnpm start.');});
const api=createTimetableApi();
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const server=http.createServer((req,res)=>{
  if(req.url==='/healthz'&&['GET','HEAD'].includes(req.method)){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(req.method==='HEAD'?undefined:'{"status":"ok"}');return;}
  api(req,res,async()=>{
    try{
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const target=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
      if(!target.startsWith(root+path.sep)||pathname.split('/').some(p=>p.startsWith('.'))||(await stat(target)).isDirectory()){res.writeHead(404).end();return;}
      const body=req.method==='HEAD'?undefined:await readFile(target);
      res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache'});
      res.end(body);
    }catch{res.writeHead(404).end();}
  });
});
server.requestTimeout=100000;
const port=Number(process.env.PORT??5175);
if(!Number.isInteger(port)||port<0||port>65535)throw new Error('PORT must be an integer between 0 and 65535.');
server.listen(port,process.env.HOST||'0.0.0.0',()=>console.log('Dashboard and timetable API listening on port '+server.address().port));
function shutdown(){server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),100000).unref();}
process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
