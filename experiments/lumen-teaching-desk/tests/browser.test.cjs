const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
  try {
    const page = await browser.newPage({viewport:{width:1276,height:738}});
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const payload = {classes:[{id:'A',name:'9B',subject:'English',active:true,meetings:Array.from({length:7},(_,i)=>({weekday:i+1,start:'08:00',end:'08:45',room:'1'}))}],logs:[],students:[{id:'s1',name:'Student One'},{id:'s2',name:'Student Two'}],enrollments:[{classId:'A',studentId:'s1'},{classId:'A',studentId:'s2'}],studentRecords:[],checklists:[],extendedAttendanceVersion:1,lessonDetailsVersion:1};
    await page.route('https://script.google.com/**', route => {
      const request = route.request().postDataJSON(); let data;
      if (request.action === 'load') data = payload;
      else if (request.action === 'saveLog') {
        data = {...request.log,className:'9B',subject:'English',start:'08:00',end:'08:45'};
        payload.logs = [data];
      } else if (request.action === 'saveChecklist') {
        const input = request.checklist;
        data = {classId:input.classId,date:input.date,revision:'r1',checklist:{classInfo:{id:'A'},records:input.records}};
        payload.checklists = [{...data,records:input.records}];
        payload.studentRecords = input.records.map(r=>({...r,classId:'A',date:input.date}));
      } else throw Error('Unexpected action ' + request.action);
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,requestId:request.requestId,data})});
    });
    await page.route('http://localhost/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      const file = path.join(root,pathname === '/' ? 'index.html' : pathname.slice(1));
      return route.fulfill({contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'application/javascript',body:fs.readFileSync(file)});
    });
    await page.addInitScript(()=>localStorage.setItem('teaching-dashboard-session','fixture'));
    await page.goto('http://localhost/');
    await page.locator('[data-status="0"]').waitFor();
    // The attendance control cycles through the same four stored values.
    await page.locator('[data-status="0"]').click();
    await page.locator('[data-status="0"]').click();
    assert.match(await page.locator('[data-status="0"]').innerText(),/Late/);
    await page.locator('[data-point="0"][data-delta="1"]').click();
    for(let i=0;i<3;i++) await page.locator('[data-status="1"]').click();
    assert.match(await page.locator('[data-status="1"]').innerText(),/Excused/);
    assert.equal(await page.locator('[data-point="1"][data-delta="1"]').getAttribute('disabled'),'');
    await page.getByRole('textbox',{name:'Unit',exact:true}).fill('Unit 3');
    await page.getByRole('textbox',{name:'Lesson title',exact:true}).fill('Travel');
    await page.getByRole('textbox',{name:'Logs',exact:true}).fill('Reviewed directions');
    await page.getByRole('textbox',{name:'Notes for next class',exact:true}).fill('Bring maps');
    await page.locator('#save-button').click();
    await page.waitForFunction(()=>document.querySelector('#draft-state').textContent.includes('saved records'));
    assert.equal(payload.logs[0].unit,'Unit 3');assert.equal(payload.logs[0].nextClassNotes,'Bring maps');
    assert.equal(payload.logs[0].notes,'Reviewed directions');
    assert.equal(payload.studentRecords[0].attendance,'late');assert.equal(payload.studentRecords[0].participation,1);
    assert.equal(payload.studentRecords[1].attendance,'excused');
    await page.reload(); await page.locator('[data-status="0"]').waitFor();
    assert.equal(await page.getByRole('textbox',{name:'Unit',exact:true}).inputValue(),'Unit 3');
    assert.equal(await page.getByRole('textbox',{name:'Notes for next class',exact:true}).inputValue(),'Bring maps');
    for(const width of [1276,900,390]) {
      await page.setViewportSize({width,height:738});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true,'no overflow at '+width);
    }
    await page.setViewportSize({width:1276,height:738});
    await page.screenshot({path:'/private/tmp/dashboard-beta-lesson-fields.png',fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('Beta browser checks passed: four attendance states, participation, separate lesson fields, save/reload, and responsive layout.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
