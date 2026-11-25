const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { randomUUID } = require("node:crypto");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  try {
    for (const width of [1366, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 820 },
        permissions: ["clipboard-read", "clipboard-write"],
      });
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date("2026-11-25T08:00:00Z"));
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      let failNext = true;
      const group = {
        id: "9A",
        name: "9A1",
        active: true,
        subject: "English",
        weekday: 3,
        start: "09:00",
        end: "09:45",
      };
      const payload = {
        classes: [group],
        logs: [],
        students: [{ id: "S", name: "Fixture student", officialGroupId: "9A" }],
        enrollments: [{ classId: "9A", studentId: "S", active: true, joinedOn: "2025-01-01", leftOn: "" }],
        mprRecords: [],
        checklists: [],
        studentRecords: [],
        lessonDetailsVersion: 1,
        extendedAttendanceVersion: 1,
      };
      await page.addInitScript(() => localStorage.setItem("teaching-dashboard-session", "fixture"));
      await page.route("http://localhost/**", (route) => {
        const name = new URL(route.request().url()).pathname.slice(1) || "index.html";
        return route.fulfill({
          contentType: name.endsWith("html")
            ? "text/html"
            : name.endsWith("css")
              ? "text/css"
              : "application/javascript",
          body: fs.readFileSync(path.join(__dirname, "..", name)),
        });
      });
      await page.route("https://script.google.com/**", async (route) => {
        const req = route.request().postDataJSON();
        let data;
        if (req.action === "load") {
          assert.equal(req.includeMpr, true);
          data = payload;
        } else if (req.action === "saveLog" || req.action === "editLog") {
          data = {
            ...req.log,
            className: group.name,
            subject: "English",
            start: group.start,
            end: group.end,
            updatedAt: "fixture",
          };
          payload.logs = [
            ...payload.logs.filter((l) => l.date !== data.date || l.classId !== data.classId),
            data,
          ];
        } else if (req.action === "saveChecklist") {
          data = {
            ...req.checklist,
            revision: randomUUID(),
            updatedAt: "fixture",
            studentRecords: req.checklist.records,
            checklist: { classInfo: group, records: req.checklist.records },
          };
          payload.checklists = [data];
          payload.studentRecords = data.records.map((r) => ({ ...r, classId: group.id, date: data.date }));
        } else if (req.action === "saveMpr") {
          if (failNext) {
            failNext = false;
            return route.fulfill({
              json: { ok: false, error: "Fixture connection failure", requestId: req.requestId },
            });
          }
          const index = payload.mprRecords.findIndex((r) => r.key === req.record.key);
          data = { ...req.record, revision: randomUUID() };
          if (index >= 0) payload.mprRecords[index] = data;
          else payload.mprRecords.push(data);
        } else throw Error(req.action);
        await route.fulfill({ json: { ok: true, data, requestId: req.requestId } });
      });
      await page.goto("http://localhost/index.html");
      const open = page.locator("#mpr-open");
      await page.waitForFunction(() => !document.querySelector("#mpr-open").disabled);
      await page.evaluate(() => changeDate("2026-11-18"));
      const inline = page.locator("#mpr-inline");
      if (width === 1366) {
        await page.locator("#student-panel").evaluate((panel) => {
          panel.style.minHeight = "1600px";
        });
        await page.evaluate(() => window.scrollTo(0, 400));
        const column = page.locator(".lesson-column");
        assert.equal(await column.evaluate((panel) => getComputedStyle(panel).position), "sticky");
        assert.ok(
          await column.evaluate(
            (panel) => panel.getBoundingClientRect().top >= 0 && panel.getBoundingClientRect().top < 25,
          ),
        );
        assert.ok(await column.evaluate((panel) => panel.scrollHeight > panel.clientHeight));
        await page.locator("#student-panel").evaluate((panel) => {
          panel.style.minHeight = "";
        });
      }
      await page.locator(".lesson-status-options").getByText("New input", { exact: true }).click();
      await page.getByLabel("Custom lesson status", { exact: true }).fill("Taught with another group");
      await page.locator("#lesson-unit").fill("Unit 7");
      assert.equal(await inline.getByLabel("Number periods").inputValue(), "1");
      assert.ok(await inline.getByLabel("I taught these hours").isChecked());
      const summary = inline.getByLabel("Use this outcome in the monthly progress summary");
      assert.ok(await summary.isChecked());
      assert.equal(
        await summary.evaluate((input) => getComputedStyle(input.parentElement).fontWeight),
        "400",
      );
      await inline.getByRole("radio", { name: "ECA", exact: true }).check();
      assert.ok(await inline.getByLabel("ECA type").isVisible());
      await inline.getByRole("radio", { name: "Regular", exact: true }).check();
      const reading = inline.getByRole("button", { name: "Reading", exact: true });
      await reading.hover();
      assert.ok(await reading.locator(".mpr-skill-tooltip").isVisible());
      await reading.click();
      assert.equal(await reading.getAttribute("aria-pressed"), "true");
      await inline.getByLabel("Reading · What could students do?").fill("Matched headings.");
      await inline.getByLabel("I taught these hours").check();
      await page.locator("#save-all-button").click();
      await page
        .getByText(/MPR note still needs saving/)
        .first()
        .waitFor();
      assert.equal(
        await inline.getByLabel("Reading · What could students do?").inputValue(),
        "Matched headings.",
      );
      await page.locator("#save-all-button").click();
      await inline.getByText("MPR note saved").waitFor();
      await page.waitForFunction(() => !document.querySelector("#save-all-button").disabled);
      assert.equal(payload.mprRecords.length, 1);
      assert.equal(payload.logs[0].lessonStatus, "Taught with another group");
      assert.equal(payload.checklists.length, 1);
      await open.click();
      const dialog = page.locator("#mpr-dialog"),
        editor = page.locator("#mpr-editor");
      await dialog.getByLabel("School date").fill("2026-11-18");
      await dialog.getByText("Complete", { exact: true }).first().waitFor();
      await dialog.getByRole("button", { name: "Add activity" }).click();
      await editor.getByLabel("Timetable group").selectOption("9A");
      await editor.getByLabel("Original missed date").fill("2026-11-04");
      await editor.getByLabel("Reason", { exact: true }).fill("Fall holiday");
      await editor.getByLabel("I taught these hours").check();
      await editor.getByRole("button", { name: "Save changes" }).click();
      await editor.waitFor({ state: "hidden" });
      for (const date of ["2026-11-17", "2026-11-18"]) {
        await dialog.getByRole("button", { name: "Add activity" }).click();
        await editor.getByLabel("Activity", { exact: true }).selectOption("ECA");
        await editor.getByLabel("Date", { exact: true }).fill(date);
        await editor.getByLabel("I taught these hours").check();
        await editor.getByLabel("ECA type").fill("Speaking Club");
        await editor.getByLabel("Topic", { exact: true }).fill("Travel");
        await editor.getByLabel("Add existing attendee").selectOption("S");
        await editor.getByRole("button", { name: "Save changes" }).click();
        await editor.waitFor({ state: "hidden" });
      }
      await dialog.getByRole("button", { name: "Monthly report", exact: true }).click();
      await dialog.getByRole("button", { name: "Confirm monthly setup" }).click();
      await editor.getByLabel("Foreign teacher name").fill("Fixture teacher");
      await editor.getByText("Weekly hours by category", { exact: true }).click();
      await editor.getByLabel("ECA weekly hours", { exact: true }).fill("6");
      await editor.getByLabel("Master Class weekly hours", { exact: true }).fill("2");
      await editor.getByLabel("Local co-teachers (names separated by commas)").fill("Fixture colleague");
      await editor.getByRole("button", { name: "Save changes" }).click();
      await editor.waitFor({ state: "hidden" });
      assert.deepEqual(await dialog.locator(".mpr-totals strong").allTextContents(), ["3 h", "1 h", "4 h"]);
      const ecaSection = dialog
        .locator(".mpr-section")
        .filter({ has: page.locator("summary", { hasText: /^ECA$/ }) });
      await ecaSection.locator("summary").click();
      const unique = ecaSection
        .locator(".mpr-answer")
        .filter({ has: page.getByRole("heading", { name: "Different students attending" }) });
      assert.equal(await unique.locator("p").textContent(), "1");
      const section = dialog
        .locator(".mpr-section")
        .filter({ has: page.locator("summary", { hasText: /^Grade 9$/ }) });
      if (!(await section.evaluate((s) => s.open))) await section.locator("summary").click();
      const answer = section
        .locator(".mpr-answer")
        .filter({ has: page.getByRole("heading", { name: "Reading", exact: true }) });
      await answer.getByRole("button", { name: "Edit", exact: true }).click();
      await editor.getByLabel("Answer to copy into the MPR").fill("Selected headings independently.");
      await editor.getByRole("button", { name: "Save changes" }).click();
      await editor.waitFor({ state: "hidden" });
      if (!(await section.evaluate((s) => s.open))) await section.locator("summary").click();
      await answer.getByRole("button", { name: "Copy answer" }).click();
      assert.equal(
        await page.evaluate(() => navigator.clipboard.readText()),
        "Selected headings independently.",
      );
      await answer.getByRole("button", { name: "View notes" }).click();
      await editor.getByRole("button", { name: /2026-11-18/ }).click();
      await inline
        .getByLabel("Reading · What could students do?")
        .fill("Matched headings and explained choices.");
      await page.locator("#save-all-button").click();
      await inline.getByText("MPR note saved").waitFor();
      await page.waitForFunction(() => !document.querySelector("#save-all-button").disabled);
      await inline.getByRole("button", { name: "Back to MPR" }).click();
      if (!(await section.evaluate((s) => s.open))) await section.locator("summary").click();
      await answer.getByText(/Source changed/).waitFor();
      assert.ok((await answer.innerText()).includes("Selected headings independently."));
      assert.equal(await dialog.evaluate((d) => d.scrollWidth <= d.clientWidth + 1), true);
      await dialog.getByLabel("Reporting month").fill("2026-12");
      assert.deepEqual(await dialog.locator(".mpr-totals strong").allTextContents(), ["0 h", "0 h", "0 h"]);
      await page.reload();
      await page.waitForFunction(() => !document.querySelector("#mpr-open").disabled);
      await page.evaluate(() => changeDate("2026-11-18"));
      assert.equal(
        await inline.getByLabel("Reading · What could students do?").inputValue(),
        "Matched headings and explained choices.",
      );
      await page.evaluate(() => changeDate("2026-11-25"));
      await page.locator("#previous-records summary").click();
      await page.getByRole("button", { name: "Edit lesson record for 2026-11-18" }).click();
      assert.equal(await page.locator("#record-lessonStatus").inputValue(), "Taught with another group");
      const past = page.locator("#record-mpr");
      await past.getByRole("heading", { name: "MPR note" }).waitFor();
      await past.getByLabel("Reading · What could students do?").fill("Found supporting details.");
      await page.locator("#record-confirm").click();
      await page.locator("#record-dialog").waitFor({ state: "hidden" });
      assert.equal(
        payload.mprRecords.find((r) => r.key === "lesson|9A|2026-11-18").value.outcomes.Reading,
        "Found supporting details.",
      );
      await page.goto("http://localhost/experiments/lumen-teaching-desk/index.html");
      await inline.getByRole("heading", { name: "MPR note" }).waitFor();
      await page.locator("#save-button").click();
      await inline.getByText("MPR note saved").waitFor();
      const defaultNote = payload.mprRecords.find((row) => row.key === "lesson|9A|2026-11-25").value;
      assert.equal(defaultNote.hours, 1);
      assert.equal(defaultNote.confirmed, true);
      assert.equal(defaultNote.highlight, true);
      await inline.getByRole("button", { name: "Writing", exact: true }).click();
      await inline.getByLabel("Writing · What could students do?").fill("Wrote an invitation.");
      await page.locator("#save-button").click();
      await inline.getByText("MPR note saved").waitFor();
      await page.reload();
      assert.equal(
        await inline.getByLabel("Writing · What could students do?").inputValue(),
        "Wrote an invitation.",
      );
      await page.goto("http://localhost/index.html");
      assert.equal(
        await inline.getByLabel("Writing · What could students do?").inputValue(),
        "Wrote an invitation.",
      );
      delete payload.mprRecords;
      await page.reload();
      await inline.getByRole("heading", { name: "MPR note" }).waitFor();
      assert.ok(await inline.getByRole("radio", { name: "Regular", exact: true }).isDisabled());
      assert.ok(await inline.getByText(/setupMpr/).isVisible());
      assert.ok(await page.locator("#lesson-unit").isEnabled());
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log(
      "MPR desktop and mobile after-lesson, failure/retry, attendance, make-up, setup, copying, manual edits, source changes and reload passed.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
