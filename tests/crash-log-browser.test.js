const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.join(__dirname, '..');

(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {})});
  try {
    const context = await browser.newContext({viewport: {width: 1280, height: 900}, acceptDownloads: true});
    const payload = {
      classes: [{id: '10A', name: 'Private group title', subject: 'English', weekday: 4, start: '08:00', end: '08:45', active: true,
        meetings: [{weekday: 4, start: '08:00', end: '08:45'}]}],
      students: [{id: 'private-student-id', name: 'Private Student Name'}],
      enrollments: [{classId: '10A', studentId: 'private-student-id', active: true}],
      logs: [], checklists: [], studentRecords: [], archivedStudents: [], meetingScheduleVersion: 1, studentArchiveVersion: 1
    };
    let failSave = true, failLoad = false;
    const requests = [];
    await context.route('https://script.google.com/**', route => {
      const request = route.request().postDataJSON(); requests.push(request);
      const fail = request.action === 'saveLog' ? failSave : request.action === 'load' ? failLoad : false;
      const data = request.action === 'saveLog' ? {...request.log, updatedAt: 'now'} : request.action === 'login' ? {token: 'private-session-token'} : payload;
      return route.fulfill({contentType: 'application/json', body: JSON.stringify({requestId: request.requestId, ok: !fail,
        error: fail ? 'Save failed for Private Student Name and private-lesson-notes' : undefined, data})});
    });
    await context.route('http://localhost/**', route => {
      const name = path.basename(new URL(route.request().url()).pathname) || 'index.html';
      return route.fulfill({contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'application/javascript', body: fs.readFileSync(path.join(root, name))});
    });
    await context.addInitScript(() => localStorage.setItem('teaching-dashboard-session', 'private-session-token'));
    const page = await context.newPage();
    const unexpected = []; page.on('pageerror', error => unexpected.push(error.message));
    await page.goto('http://localhost/index.html');
    await page.locator('.class-filter').first().waitFor();
    await page.evaluate(() => {changeDate('2026-10-08'); state.selectedClassId = '10A'; render();});
    await page.locator('#lesson-notes').fill('private-lesson-notes');
    await page.locator('#save-all-button').click();
    await page.waitForFunction(() => CrashLog.read().errors.some(error => error.action === 'saveLog'));
    let log = await page.evaluate(() => CrashLog.read());
    const failure = log.errors.find(error => error.action === 'saveLog');
    assert.equal(log.errors.length, 1, 'request and UI catch produce one entry');
    assert.equal(failure.requestId, requests.find(request => request.action === 'saveLog').requestId);
    assert.ok(failure.stack.some(frame => frame.startsWith('script.js:')), 'cache-versioned script URLs retain source line numbers');
    assert.ok(failure.steps.some(step => step.event === 'input' && step.target === 'lesson-notes'));
    assert.ok(failure.steps.some(step => step.event === 'click' && step.target === 'save-all-button'));
    assert.ok(failure.steps.some(step => step.event === 'request-start'));
    for (const value of ['private-session-token', 'private-student-id', 'Private Student Name', 'Private group title', 'private-lesson-notes']) assert.ok(!JSON.stringify(log).includes(value), 'Log excludes ' + value);
    assert.equal(await page.locator('#lesson-notes').innerText(), 'private-lesson-notes', 'failure retains the teaching draft');

    failSave = false;
    await page.evaluate(() => saveCurrentLesson());
    assert.ok((await page.evaluate(() => CrashLog.read())).steps.some(step => step.event === 'request-success' && step.action === 'saveLog'));
    await page.locator('#settings-button').click();
    assert.ok(await page.locator('#diagnostics-dialog').isVisible());
    assert.ok(await page.locator('#change-connection-button').isDisabled());
    await page.locator('#diagnostics-filter').selectOption('errors');
    assert.equal(await page.locator('#diagnostics-list details').count(), 1);
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#diagnostics-download').click();
    const download = await downloadEvent;
    const downloaded = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(downloaded.errors[0].requestId, failure.requestId);
    assert.ok(!JSON.stringify(downloaded).includes('private-lesson-notes'));
    await page.locator('#diagnostics-close').click();

    await page.goto('http://localhost/analysis.html');
    await page.locator('#analysis-students tr').first().waitFor();
    await page.locator('#analysis-search').fill('Private Student Name');
    await page.locator('#analysis-search').fill('');
    failLoad = true;
    await page.locator('#refresh-analysis').click();
    await page.waitForFunction(() => CrashLog.read().errors.some(error => error.page === 'analysis' && error.action === 'load'));
    log = await page.evaluate(() => CrashLog.read());
    assert.equal(log.errors.length, 2);
    assert.ok(log.steps.some(step => step.page === 'dashboard' && step.target === 'save-all-button'));
    assert.ok(log.steps.some(step => step.page === 'analysis' && step.target === 'analysis-search'));
    assert.ok(log.errors.find(error => error.page === 'analysis').steps.some(step => step.page === 'dashboard'), 'same-tab navigation retains preceding breadcrumbs');
    assert.ok(!JSON.stringify(log).includes('Private Student Name'));
    assert.equal(unexpected.length, 0, unexpected.join('\n'));

    const second = await context.newPage();
    failLoad = false;
    await second.goto('http://localhost/index.html');
    await second.locator('.class-filter').first().waitFor();
    await second.evaluate(() => CrashLog.record(new Error('Unknown private runtime detail'), {kind: 'runtime'}));
    assert.equal((await page.evaluate(() => CrashLog.read())).errors.length, 3);
    await page.locator('#settings-button').click();
    await page.setViewportSize({width: 390, height: 844});
    await page.screenshot({path: '/private/tmp/dashboard-crash-log-mobile.png'});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'log viewer fits mobile width');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#diagnostics-clear').click();
    await second.waitForFunction(() => CrashLog.read().errors.length === 0);
    assert.equal((await page.evaluate(() => CrashLog.read())).errors.length, 0);
    assert.ok(await page.locator('#diagnostics-list').getByText('No recorded entries.').isVisible());

    const blocked = await browser.newContext();
    await blocked.route('http://localhost/**', route => {
      const name = path.basename(new URL(route.request().url()).pathname);
      return route.fulfill({contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'application/javascript', body: fs.readFileSync(path.join(root, name))});
    });
    await blocked.addInitScript(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key.startsWith('teaching-dashboard-diagnostics-v1:')) throw new DOMException('Storage unavailable', 'QuotaExceededError');
        return setItem.call(this, key, value);
      };
    });
    const memoryPage = await blocked.newPage();
    await memoryPage.goto('http://localhost/index.html');
    await memoryPage.locator('#settings-button').click();
    assert.match(await memoryPage.locator('#diagnostics-status').innerText(), /storage unavailable/);
    await memoryPage.evaluate(() => {
      window.dispatchEvent(new ErrorEvent('error', {error: new TypeError('Private runtime'), message: 'Private runtime'}));
      window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {promise: Promise.resolve(), reason: new Error('Private promise')}));
    });
    assert.equal((await memoryPage.evaluate(() => CrashLog.read())).errors.length, 2);
    await blocked.close();
    console.log('Crash log browser checks passed: save failure and recovery, ordered private breadcrumbs, correlated requests, Settings, downloads, reload/navigation, analysis failures, tab isolation, clearing, mobile layout and storage failure.');
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
