import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mutation,key} from '../src/data-model.js';
import {extractionDraft,importClasses} from '../src/timetable-format.js';
import {createTimetableApi} from '../server/timetable-api.mjs';
const ctx={uuid:()=>crypto.randomUUID(),today:'2026-10-16',timestamp:1234};
const sample={classes:[{groupId:'8E',name:'8E',subject:'English',meetings:[{weekday:1,start:'08:00',end:'08:45',room:'14'},{weekday:3,start:'09:00',end:'09:45',room:'14'}]}],warnings:[]};
const image='data:image/png;base64,iVBORw0KGgo=';
test('extraction is allowlisted and converts to the existing Firebase timetable shape',()=>{
  const value=structuredClone(sample);value.classes[0].id='overwrite';value.classes[0].path='other-user';value.classes[0].active=false;
  const drafts=extractionDraft(value);const out=mutation({},'importTimetable',{classes:importClasses(drafts.classes)},ctx);
  assert.equal(out.result,'reload');const record=out.changes['timetable/'+key('8E')];
  assert.equal(record.active,true);assert.equal(record.revision,1);assert.equal(record.meetings[3].start,'09:00');assert.equal(record.path,undefined);
  assert.throws(()=>extractionDraft({classes:[{meetings:[]}]}),/invalid/);
});
test('batch import rejects conflicts without changing any existing record',()=>{
  const classes=importClasses(extractionDraft(sample).classes),db={};
  const first=mutation(db,'importTimetable',{classes},ctx);assert.deepEqual(db,{});
  const populated={timetable:{[key('8E')]:first.changes['timetable/'+key('8E')]}};
  const before=structuredClone(populated);
  assert.throws(()=>mutation(populated,'importTimetable',{classes},ctx),/unavailable/);assert.deepEqual(populated,before);
  assert.throws(()=>mutation({},'importTimetable',{classes:[classes[0],{...classes[0],requestedId:'8F'}]},ctx),/overlaps/);
  assert.throws(()=>mutation({},'importTimetable',{classes:[{...classes[0],id:'8E'}]},ctx),/only add/);
  assert.throws(()=>mutation({},'importTimetable',{classes:[]},ctx),/1–100/);
  assert.throws(()=>mutation({},'importTimetable',{classes:[{...classes[0],subject:''}]},ctx),/subject/);
  assert.throws(()=>mutation({},'importTimetable',{classes:[{...classes[0],meetings:[{weekday:1,start:'09:00',end:'09:45',room:''}]}]},ctx),/once/);
});
async function apiTest(run,options={}){
  let calls=[];
  const handler=createTimetableApi({env:{DEEPSEEK_API_KEY:'test-private-key'},verifyToken:async token=>{if(token!=='valid')throw new Error('expired');return {uid:'teacher',firebase:{sign_in_provider:'google.com'}};},fetchImpl:async(url,opts)=>{calls.push([url,opts]);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(sample)}}]}));},...options});
  const server=http.createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/api/timetable/extract`;
  const send=(body={image},headers={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer valid',...headers},body:JSON.stringify(body)});
  try{await run({send,calls,url});}finally{await new Promise(resolve=>server.close(resolve));}
}
test('authenticated API forwards image to DeepSeek flash and returns editable suggestions',async()=>{
  await apiTest(async({send,calls})=>{const res=await send();assert.equal(res.status,200);const data=await res.json();assert.equal(data.classes[0].requestedId,'8E');assert.equal(calls.length,1);
    const [url,opts]=calls[0],body=JSON.parse(opts.body);assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(body.model,'deepseek-flash');assert.equal(body.messages[1].content[1].image_url.url,image);assert.equal(body.response_format.type,'json_object');assert.equal(JSON.stringify(data).includes('test-private-key'),false);
  });
});
test('API blocks unauthenticated, cross-origin, remote URL and invalid image requests before provider use',async()=>{
  await apiTest(async({send,calls})=>{
    assert.equal((await send({image},{Authorization:'Bearer expired'})).status,401);
    assert.equal((await send({image},{Origin:'https://other.example'})).status,403);
    assert.equal((await send({image:'https://other.example/photo.png'})).status,400);
    assert.equal((await send({image:'data:image/png;base64,YmFk'})).status,400);
    assert.equal(calls.length,0);
  });
});
test('API explains provider failures without leaking provider payloads or key',async()=>{
  await apiTest(async({send})=>{const res=await send();assert.equal(res.status,502);assert.match((await res.json()).error,/balance/);},{fetchImpl:async()=>new Response('private provider error',{status:402})});
  await apiTest(async({send})=>{assert.equal((await send()).status,422);},{fetchImpl:async()=>new Response(JSON.stringify({choices:[{finish_reason:'length'}]}))});
});
test('hourly quota limits paid requests',async()=>{
  await apiTest(async({send,calls})=>{for(let i=0;i<12;i++)assert.equal((await send()).status,200);assert.equal((await send()).status,429);assert.equal(calls.length,12);});
});
