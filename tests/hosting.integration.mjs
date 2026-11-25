import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('built production server serves dashboard, health and authenticated API without exposing secrets',async()=>{
  const child=spawn(process.execPath,['server/index.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',HOST:'127.0.0.1',APP_ORIGIN:'https://dashboard.example',FIREBASE_PROJECT_ID:'demo-hosting-test',DEEPSEEK_API_KEY:'hosting-test-secret',VITE_USE_FIREBASE_EMULATORS:'false',FIREBASE_AUTH_EMULATOR_HOST:''},stdio:['ignore','pipe','pipe']});
  let output='';child.stderr.on('data',b=>output+=b);
  const exited=once(child,'exit');
  try{
    const port=await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Production startup timed out: '+output)),15000);
      child.stdout.on('data',b=>{output+=b;const match=/listening on port (\d+)/.exec(output);if(match){clearTimeout(timeout);resolve(Number(match[1]));}});
      child.once('exit',()=>{clearTimeout(timeout);reject(new Error('Production startup failed: '+output));});
    });
    const base='http://127.0.0.1:'+port;
    const health=await fetch(base+'/healthz');assert.equal(health.status,200);assert.deepEqual(await health.json(),{status:'ok'});
    const page=await fetch(base+'/');assert.equal(page.status,200);const html=await page.text();assert.match(html,/Import timetable image/);
    assert.equal((await fetch(base+'/analysis.html')).status,200);
    for(const route of ['/astryx.html','/astryx-analysis.html']){
      const alternate=await fetch(base+route);assert.equal(alternate.status,200);assert.match(await alternate.text(),/astryx-workspace/);
    }
    const asset=html.match(/src="([^"]+\.js)"/)[1];const js=await fetch(new URL(asset,base+'/'));assert.equal(js.status,200);assert.match(js.headers.get('cache-control'),/immutable/);assert.doesNotMatch(await js.text(),/hosting-test-secret/);
    for(const route of ['/.env.server','/server/index.mjs','/server/timetable-api.mjs','/.git/config'])assert.equal((await fetch(base+route)).status,404);
    const request=(origin)=>fetch(base+'/api/timetable/extract',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:'{}'});
    assert.equal((await request('https://dashboard.example')).status,401);
    assert.equal((await request('https://untrusted.example')).status,403);
  }finally{child.kill('SIGTERM');await exited;}
});
