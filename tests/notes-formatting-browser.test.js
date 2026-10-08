const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  try {
    const page=await browser.newPage({viewport:{width:1414,height:827}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const names=['9B','9D','8E','11A','10B','9A','10A','11B'];
    const matrix=[[null,'9B','9D','8E',null],['9B','9D','11A','10B',null],['8E','9A','9B','11A',null],['10B','10A','9A',null,null],['9D','11B','11B','10A',null],['9A','8E',null,null,null]];
    const times=[['08:00','08:45'],['08:50','09:35'],['09:40','10:25'],['10:30','11:15'],['11:20','12:05'],['12:10','12:55']];
    const classes=names.map(id=>({id,name:id,subject:'English',active:true,
      meetings:matrix.flatMap((row,period)=>row.flatMap((name,day)=>name===id?[{weekday:day+1,start:times[period][0],end:times[period][1],room:"Umar's room"}]:[]))}));
    const students=Array.from({length:18},(_,i)=>({id:'s'+i,name:'Student '+String(i+1).padStart(2,'0')}));
    const payload={classes,students,enrollments:students.map(s=>({classId:'10A',studentId:s.id,active:true})),
      logs:[{classId:'10A',date:'2026-10-06',className:'10A',subject:'English',start:'10:30',end:'11:15',notes:'Previous lesson note',lessonStatus:'Skipped'}],
      checklists:[],studentRecords:[],archivedStudents:[],meetingScheduleVersion:1,studentArchiveVersion:1};
    let revision=0;
    await page.route('https://script.google.com/**',route=>{
      const request=route.request().postDataJSON();
      let data;
      if(request.action==='load')data=payload;
      else if(request.action==='saveLog') {
        data={...request.log,className:'10A',subject:'English',start:'11:20',end:'12:05',room:"Umar's room",updatedAt:'now'};
        payload.logs=payload.logs.filter(log=>log.classId!==data.classId||log.date!==data.date).concat(data);
      } else if(request.action==='saveChecklist') {
        const input=request.checklist;
        data={classId:input.classId,date:input.date,revision:'r'+(++revision),updatedAt:'now',
          checklist:{classInfo:{id:input.classId},records:input.records}};
      } else throw new Error('Unexpected action '+request.action);
      return route.fulfill({contentType:'application/json',body:JSON.stringify({requestId:request.requestId,ok:true,data})});
    });
    await page.route('http://localhost/**',route=>{
      const file=path.basename(new URL(route.request().url()).pathname)||'index.html';
      return route.fulfill({contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'application/javascript',body:fs.readFileSync(path.join(__dirname,'..',file))});
    });
    await page.addInitScript(()=>localStorage.setItem('teaching-dashboard-session','fixture-session'));
    await page.goto('http://localhost/index.html');
    await page.locator('.class-filter').first().waitFor();
    await page.evaluate(()=>{changeDate('2026-10-08');state.selectedClassId='10A';render();});
    const history=page.locator('#previous-records');
    const summary=history.locator('summary');
    assert.equal(await history.evaluate(el=>el.open),false,'history starts collapsed so the roster is easy to reach');
    assert.match(await page.locator('#previous-records-hint').innerText(),/1 saved lesson.*Oct 6/);
    assert.equal(await page.evaluate(()=>!!(document.querySelector('#previous-records').compareDocumentPosition(document.querySelector('#student-panel')) & Node.DOCUMENT_POSITION_FOLLOWING)),true,'DOM reading order follows the visual order');
    await summary.click();
    assert.equal(await page.locator('.previous-note').first().isVisible(),true);
    await summary.press('Space');
    assert.equal(await history.evaluate(el=>el.open),false,'keyboard can collapse the disclosure');
    const search=page.getByRole('searchbox',{name:'Find a student'});
    assert.equal(await search.getAttribute('placeholder'),'Find a student');
    await search.fill('Student 01');
    assert.equal(await page.locator('.student-row:visible').count(),1);
    await search.fill('');
    const notes=page.locator('#lesson-notes');
    await notes.fill('Bold and italic');
    const selectText=async word=>page.evaluate(word=>{
      const editor=document.querySelector('#lesson-notes');
      const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);
      let node;
      while(node=walker.nextNode()) {
        const index=node.textContent.indexOf(word);
        if(index>=0){const range=document.createRange();range.setStart(node,index);range.setEnd(node,index+word.length);
          const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);return;}
      }
      throw new Error('Cannot select '+word);
    },word);
    await selectText('Bold');
    await page.getByRole('button',{name:'Bold',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Bold',exact:true}).getAttribute('aria-pressed'),'true');
    await selectText('italic');
    await page.getByRole('button',{name:'Italic',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Italic',exact:true}).getAttribute('aria-pressed'),'true');
    await page.locator('#save-all-button').click();
    await page.getByText('Lesson and available attendance records saved.',{exact:false}).waitFor();
    const saved=payload.logs.find(log=>log.date==='2026-10-08');
    assert.match(saved.notes,/<strong>Bold<\/strong>/);
    assert.match(saved.notes,/<em>italic<\/em>/);
    await page.reload();
    await page.locator('.class-filter').first().waitFor();
    await page.evaluate(()=>{changeDate('2026-10-08');state.selectedClassId='10A';render();});
    assert.equal(await notes.locator('strong').textContent(),'Bold');
    assert.equal(await notes.locator('em').textContent(),'italic');
    // Turning formatting off must also survive the sanitizer and save path.
    await selectText('Bold');await page.getByRole('button',{name:'Bold',exact:true}).click();
    assert.doesNotMatch(await page.evaluate(()=>readLessonNotes()),/<strong>/);
    assert.equal(await page.getByRole('button',{name:'Bold',exact:true}).getAttribute('aria-pressed'),'false');
    await selectText('italic');await page.getByRole('button',{name:'Italic',exact:true}).click();
    assert.doesNotMatch(await page.evaluate(()=>readLessonNotes()),/<em>/);
    assert.equal(await page.getByRole('button',{name:'Italic',exact:true}).getAttribute('aria-pressed'),'false');
    // Keyboard shortcuts still use the same sanitized save path.
    await selectText('Bold');await page.keyboard.press(process.platform==='darwin'?'Meta+b':'Control+b');
    assert.match(await page.evaluate(()=>readLessonNotes()),/<strong>Bold<\/strong>/);
    await selectText('italic');
    await page.getByRole('button',{name:'Italic',exact:true}).focus();
    await page.getByRole('button',{name:'Italic',exact:true}).press('Enter');
    assert.match(await page.evaluate(()=>readLessonNotes()),/<em>italic<\/em>/);
    await notes.press('ArrowRight');
    const safe=await page.evaluate(()=>{
      const source=document.createElement('div');source.innerHTML='<b onclick="alert(1)">Safe bold</b><i>Safe italic</i><script>alert(1)</script>';
      return sanitizeLessonNotes(source).innerHTML;
    });
    assert.equal(safe,'<strong>Safe bold</strong><em>Safe italic</em>');
    for(const size of [{width:1414,height:827},{width:1153,height:526},{width:900,height:850},{width:640,height:526},{width:390,height:844}]) {
      await page.setViewportSize(size);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no page overflow at '+size.width);
      const rosterMetrics=await page.locator('.attendance-table-scroll').evaluate(el=>({height:el.clientHeight,content:el.scrollHeight,scrollTop:el.scrollTop}));
      assert.ok(rosterMetrics.height>=rosterMetrics.content-1,'the entire roster expands into page flow at '+size.width);
      const historyBox=await history.boundingBox(), attendanceBox=await page.locator('#student-panel').boundingBox();
      assert.ok(historyBox.y+historyBox.height<=attendanceBox.y+1,'history remains above attendance at '+size.width);
      await page.locator('.student-row').last().scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(()=>scrollY>0),'the page scrolls to the last student');
      assert.equal(await page.locator('.attendance-table-scroll').evaluate(el=>el.scrollTop),0,'roster does not need an internal vertical scroll');
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.screenshot({path:path.join(__dirname,'..','dashboard-ui-'+size.width+'.png'),fullPage:true});
    }
    await page.setViewportSize({width:507,height:827});
    await page.locator('#week-view-button').click();
    const panel=page.locator('#week-preview');
    await panel.waitFor();
    const mobileBox=await panel.boundingBox();
    assert.ok(mobileBox.y<=20 && mobileBox.y>0,'small-screen preview opens at the top with an outer margin');
    assert.ok(mobileBox.height>=827*0.95 && mobileBox.y+mobileBox.height<827,'small-screen preview fills the viewport without clipping');
    assert.ok(mobileBox.width>=507*0.95 && mobileBox.x>0 && mobileBox.x+mobileBox.width<507);
    const week8E=await page.getByRole('button',{name:'8E, Thursday, 08:00–08:45',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor);
    const day8E=await page.locator('.day-period').first().locator('.schedule-card').evaluate(el=>getComputedStyle(el).backgroundColor);
    assert.equal(day8E,week8E,'day and week cards use the same group color');
    assert.equal(await page.locator('#today-button #chosen-date').count(),1);
    assert.match(await page.locator('#today-button').innerText(),/^Today:\s+/);
    await page.screenshot({path:path.join(__dirname,'..','dashboard-week-mobile-507.png')});
    await page.setViewportSize({width:1414,height:827});
    await page.waitForFunction(()=>parseFloat(document.querySelector('#week-preview').style.left)>200);
    const desktopBox=await panel.boundingBox();
    assert.ok(desktopBox.x>200,'resize restores the desktop placement beside the trigger');
    await page.getByRole('button',{name:'Close week plan'}).click();
    assert.equal(await panel.isVisible(),false);
    assert.deepEqual(errors,[]);
    console.log('Notes formatting browser checks passed: accessible student search, bold/italic selection and toggles, saved reload, keyboard shortcut, sanitized markup, and desktop/tablet/mobile layout.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
