import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const runtime=createRequire('/Users/swarosofski/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=runtime('playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const context=await browser.newContext({viewport:{width:1440,height:1050}});
const page=await context.newPage(),errors=[],blocked=[];
page.setDefaultTimeout(15000);
page.on('pageerror',e=>errors.push(e.message));
await context.route('**/*',route=>{
 const url=new URL(route.request().url());
 if(!['127.0.0.1','localhost'].includes(url.hostname)&&['http:','https:'].includes(url.protocol)){blocked.push(url.href);return route.abort();}
 return route.continue();
});
try{
 await page.goto('http://127.0.0.1:5175/');
 await page.locator('#emulator-login').waitFor();
 const email='teacher-'+Date.now()+'@example.test';
 await page.locator('#emulator-login input[name=email]').fill(email);await page.locator('#emulator-login input[name=password]').fill('test-password');await page.locator('#emulator-login button').click();
 await page.locator('#workspace').waitFor({state:'visible'});
 await page.locator('#add-class-button').click();await page.locator('#class-name').fill('Test English');await page.locator('#class-subject').fill('English');
 await page.locator('#class-weekday').selectOption('4');await page.locator('#class-start').fill('09:00');await page.locator('#class-end').fill('09:45');await page.locator('#class-room').fill('101');
 await page.locator('#save-class-button').click();await page.locator('#class-dialog').waitFor({state:'hidden'});
 await page.locator('#group-view').waitFor({state:'visible'});
 await mkdir('test-evidence',{recursive:true});await page.screenshot({path:'test-evidence/dashboard-desktop.png',fullPage:true});
 assert.equal(errors.length,0,errors.join('\n'));assert.equal(blocked.length,0,'Unexpected external requests: '+blocked.join('\n'));
 console.log('PASS: empty registration, class creation, dashboard render, and no external requests.');
 await page.locator('#add-student-button').click();await page.locator('#student-name').fill('Alice Example');await page.locator('#save-student-button').click();await page.locator('#student-dialog').waitFor({state:'hidden'});
 await page.locator('.student-row').waitFor();
 await page.locator('.attendance-group button[data-value="late"]').click();await page.locator('.participation-group button[data-value="1"]').click();
 await page.locator('#lesson-notes').fill('Practised the past simple.');await page.locator('#lesson-lessonTitle').fill('Yesterday’s activities');
 await page.locator('#save-all-button').click();
 await page.waitForFunction(()=>document.querySelector('#global-notice').textContent.includes('saved')&&!document.querySelector('#save-all-button').textContent.includes('Saving'));
 const saved=await page.evaluate(async()=>{const m=await import('/src/firebase-client.js');return m.request('load',{token:m.currentUser().uid});});
 assert.equal(saved.students.length,1);assert.equal(saved.logs[0].lessonTitle,'Yesterday’s activities');assert.equal(saved.studentRecords[0].attendance,'late');assert.equal(saved.studentRecords[0].participation,1);
 const studentId=saved.students[0].id;
 // Verify the analysis page reads the same teacher’s saved records.
 const analysis=await context.newPage();analysis.on('pageerror',e=>errors.push(e.message));await analysis.goto('http://127.0.0.1:5175/analysis.html');await analysis.locator('#analysis-workspace').waitFor({state:'visible'});
 assert.match(await analysis.locator('#analysis-content').innerText(),/Alice Example/);await analysis.close();
 await page.reload();await page.locator('#workspace').waitFor({state:'visible'});
 // Exercise archive/recovery through the data layer and recovery interface.
 page.once('dialog',dialog=>dialog.accept());
 await page.locator('.student-delete-button').click();
 await page.waitForFunction(()=>document.querySelector('#global-notice').textContent.includes('moved to ArchivedStudents'));
 await page.locator('#settings-button').click();await page.locator('#archives-dialog .archive-entry').filter({hasText:'Alice Example'}).getByRole('button',{name:'Restore'}).click();
 await page.waitForFunction(()=>!document.querySelector('#archives-list').textContent.includes('Alice Example'));
 const recovered=await page.evaluate(async()=>{const m=await import('/src/firebase-client.js');return m.request('load',{token:m.currentUser().uid});});
 assert.equal(recovered.students[0].id,studentId);assert.equal(recovered.studentRecords[0].studentName,'Alice Example');
 await page.locator('#archives-close').click();
 await page.locator('#lesson-notes').fill('Offline draft kept locally.');
 await context.setOffline(true);await page.locator('#save-all-button').click();
 await page.waitForFunction(()=>/offline|connection/i.test(document.querySelector('#lesson-status').textContent));
 assert.match(await page.locator('#lesson-notes').innerText(),/Offline draft kept locally/);
 await context.setOffline(false);
 await page.waitForFunction(()=>document.querySelector('#connection-state').textContent==='Connected');
 console.log('PASS: offline save is rejected and the unsaved draft is retained.');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-evidence/dashboard-mobile.png',fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);assert.equal(overflow,false,'Mobile viewport should not overflow horizontally');
 await page.locator('#sign-out-button').click();await page.locator('#access-panel').waitFor({state:'visible'});
 await page.locator('#emulator-login input[name=email]').fill('second-'+Date.now()+'@example.test');await page.locator('#emulator-login input[name=password]').fill('test-password');await page.locator('#emulator-login button').click();await page.locator('#workspace').waitFor({state:'visible'});
 const second=await page.evaluate(async()=>{const m=await import('/src/firebase-client.js');return m.request('load',{token:m.currentUser().uid});});assert.equal(second.students.length,0);assert.equal(second.classes.length,0);
 assert.doesNotMatch(await page.locator('#workspace').innerText(),/Alice Example|Practised the past simple/);
 assert.equal(errors.length,0,errors.join('\n'));assert.equal(blocked.length,0,blocked.join('\n'));
 console.log('PASS: attendance and lesson saves, analysis, archive recovery, mobile layout, and private second account.');
}catch(e){await mkdir('test-evidence',{recursive:true});await page.screenshot({path:'test-evidence/browser-failure.png',fullPage:true});console.error('PAGE ERRORS',errors);console.error('BODY',await page.locator('body').innerText());throw e;}finally{await browser.close();}
