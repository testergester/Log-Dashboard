const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

// The school's timetable, indexed by period and then Monday–Friday.
const matrix = [
  [null, '9B', '9D', '8E', null],
  ['9B', '9D', '11A', '10B', null],
  ['8E', '9A', '9B', '11A', null],
  ['10B', '10A', '9A', null, null],
  ['9D', '11B', '11B', '10A', null],
  ['9A', '8E', null, null, null]
];
const times = [['08:00','08:45'],['08:50','09:35'],['09:40','10:25'],['10:30','11:15'],['11:20','12:05'],['12:10','12:55']];
const classes = matrix.flatMap((row, period) => row.flatMap((id, day) => id ? [{
  id, name:id, subject:'English', weekday:day+1, start:times[period][0], end:times[period][1], room:"Umar's room", active:true
}] : []));
// Reproduce the live bug: an old saved 11A record carries Wednesday's time
// into Thursday. The school timetable must still put it in Thursday's period 3.
const logs = [{classId:'11A',date:'2026-10-08',className:'11A',subject:'English',
  start:'08:50',end:'09:35',room:"Umar's room",lessonStatus:'Done',notes:'Retained lesson note'}];
(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://script.google.com/**', route => {
      const request = route.request().postDataJSON();
      assert.equal(request.action, 'load', 'timetable browsing must not write to Sheets');
      return route.fulfill({contentType:'application/json', body:JSON.stringify({requestId:request.requestId, ok:true, data:{classes,logs}})});
    });
    await page.route('http://localhost/**', route => {
      const name = path.basename(new URL(route.request().url()).pathname) || 'index.html';
      return route.fulfill({contentType:name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'application/javascript', body:fs.readFileSync(path.join(__dirname,'..',name))});
    });
    await page.addInitScript(() => localStorage.setItem('teaching-dashboard-session','fixture-session'));
    await page.goto('http://localhost/index.html');
    await page.locator('.day-period').first().waitFor();
    await page.evaluate(() => changeDate('2026-10-05'));
    assert.equal(await page.locator('.class-filter').count(),9, 'eight distinct groups plus All groups');
    assert.equal(await page.locator('#workspace-summary').textContent(),'20 lessons this week · 8 groups');
    for (let day=0; day<5; day++) {
      await page.evaluate(date => changeDate(date), '2026-10-0'+(5+day));
      assert.equal(await page.locator('.day-period').count(),6);
      for (let period=0; period<6; period++) {
        const slot = page.locator('.day-period').nth(period);
        assert.equal(await slot.locator('h3').textContent(),`Period ${period+1} · ${times[period][0]}–${times[period][1]}`);
        assert.equal(await slot.locator('.schedule-main strong').allTextContents().then(names=>names[0]||null),matrix[period][day]);
      }
    }
    await page.evaluate(() => changeDate('2026-10-08'));
    const week = page.locator('#week-view-button'), preview = page.locator('#week-preview');
    await week.hover();
    await preview.waitFor();
    await preview.hover();
    const rows = page.locator('.week-grid-row');
    assert.equal(await rows.count(),7);
    assert.equal(await page.locator('.week-class-button').count(),20);
    for (let period=0; period<6; period++) {
      const cells = rows.nth(period+1).locator('.week-grid-cell');
      assert.equal(await cells.count(),5);
      for (let day=0; day<5; day++) {
        assert.equal(await cells.nth(day).locator('strong').allTextContents().then(names=>names[0]||null),matrix[period][day]);
      }
    }
    await page.getByRole('button',{name:'11A, Thursday, 09:40–10:25',exact:true}).click();
    assert.match(await page.locator('#group-detail').textContent(),/09:40–10:25/);
    assert.equal(await page.locator('#lesson-notes').innerText(),'Retained lesson note');
    assert.match(await page.locator('.day-period').nth(1).innerText(),/10B/);
    assert.doesNotMatch(await page.locator('.day-period').nth(1).innerText(),/11A/);
    assert.match(await page.locator('.day-period').nth(2).innerText(),/11A/);
    await week.click();
    await preview.hover();
    await page.screenshot({path:path.join(__dirname,'..','timetable-week-preview.png'),fullPage:true});
    await page.mouse.move(2,2);
    await preview.waitFor({state:'hidden'});
    await week.click();
    await preview.waitFor();
    await page.locator('.brand-name').click();
    await preview.waitFor({state:'hidden'});
    await week.focus();
    await week.press('Enter');
    await preview.waitFor();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'close-week-preview');
    await page.keyboard.press('Escape');
    await preview.waitFor({state:'hidden'});
    assert.equal(await week.getAttribute('aria-expanded'),'false');
    await week.click();
    await page.getByRole('button',{name:'9B, Monday, 08:50–09:35',exact:true}).click();
    await preview.waitFor({state:'hidden'});
    assert.equal(await page.locator('#group-name').textContent(),'9B');
    assert.match(await page.locator('#group-detail').textContent(),/October 5.*08:50–09:35/);
    await page.getByRole('button',{name:'9B',exact:true}).click();
    await week.click();
    assert.equal(await page.locator('.week-class-button').count(),3);
    assert.equal(await rows.count(),7,'filtering must retain every period');
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'All groups',exact:true}).click();
    // Also accept the newer API's grouped meetings and retain exceptional times.
    await page.evaluate(data => {
      const groups = [...new Set(data.map(item=>item.id))].map(id=>({...data.find(item=>item.id===id),meetings:data.filter(item=>item.id===id)}));
      applyDashboardData({classes:groups,logs:[]});
    },classes);
    await week.click();
    assert.equal(await page.locator('.week-class-button').count(),20);
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      state.classes.push({id:'extra',name:'Extra',active:true,meetings:[{weekday:6,start:'13:05',end:'13:50',room:''}]});
      render();
    });
    await week.click();
    assert.equal(await rows.count(),8);
    assert.equal(await rows.first().locator('.day-heading').count(),6);
    assert.equal(await page.locator('.week-class-button').count(),21);
    await page.keyboard.press('Escape');
    await page.evaluate(data=>applyDashboardData({classes:data,logs:[]}),classes);
    await page.setViewportSize({width:841,height:639});
    await week.click();
    await page.screenshot({path:path.join(__dirname,'..','timetable-compact-preview.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(() => changeDate('2026-10-08'));
    await page.screenshot({path:path.join(__dirname,'..','timetable-day-mobile.png'),fullPage:true});
    // Touch click opens without relying on hover and stays open until outside click.
    await week.dispatchEvent('click',{detail:1});
    await preview.waitFor();
    await page.screenshot({path:path.join(__dirname,'..','timetable-week-mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.locator('.brand-name').click();
    await preview.waitFor({state:'hidden'});
    assert.deepEqual(errors,[]);
    console.log('Timetable browser checks passed: all 30 school slots, 20 meetings, free periods, distinct groups, grouped API data, weekends, exceptional times, hover/click/outside/Escape, selection, filtering, and mobile layout.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
