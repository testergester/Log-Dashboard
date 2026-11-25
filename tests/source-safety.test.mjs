import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
test('the original dashboard source remains byte-for-byte unchanged',async t=>{
 try{await access('/Users/swarosofski/Desktop/TestDashboard/index.html');}catch{t.skip('Original dashboard is not present on this machine.');return;}
 const baseline=JSON.parse(await readFile(new URL('./source-baseline.json',import.meta.url),'utf8'));
 for(const [name,hash]of Object.entries(baseline))assert.equal(createHash('sha256').update(await readFile('/Users/swarosofski/Desktop/TestDashboard/'+name)).digest('hex'),hash,name);
});
test('new application has no spreadsheet endpoints or old credential/session settings',async()=>{
 for(const name of ['src/script.js','src/analysis.js','index.html','analysis.html','src/firebase-client.js']){
  const source=await readFile(new URL('../'+name,import.meta.url),'utf8');
  assert.doesNotMatch(source,/script\.google\.com|sheets\.googleapis\.com|teaching-dashboard-session|teaching-dashboard-endpoint|OWNER_USERNAME|SETUP_PASSWORD/,name);
 }
});
