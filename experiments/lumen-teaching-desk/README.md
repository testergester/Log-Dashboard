# Teaching desk — New UI BETTA

A secondary dashboard using Lumen Elements 4.0.0. Open it through **new UI BETTA** at the top of the main dashboard. It connects to the same Apps Script endpoint and browser sign-in as the main dashboard; there is no demo data or separate record store.

The page loads your timetable, students, date-specific attendance, participation, student notes, lesson notes, ratings, statuses, and lesson history. Use the date picker, day/week controls, or Saved lessons to open past records. Archived meetings with recorded data remain accessible.

**Save all** writes lesson changes and attendance to the existing backend. Participation uses the existing −1 / 0 / +1 values; absent students have a zero mark. Attendance writes include the loaded revision to protect against concurrent edits. Unedited formatted lesson notes, ratings, lesson types, statuses, and student notes are preserved. Editing the notes uses plain text. Drafts stay in memory across date/class navigation; leaving with unsaved changes triggers the browser's standard warning.

If your session expires, sign in through the current dashboard and return. Loading and failure states never substitute sample records. Refresh records reloads saved data when there are no pending edits.

Build with `node build.mjs` after `pnpm install --ignore-scripts`. The compiled `dist/` files are self-contained, and only this secondary page loads them.

Run data/transport checks with `node tests/model.test.mjs`. Build a local fixture preview using `node tests/build-preview.mjs`, then serve this project and open `tests/preview/`. Fixture requests never contact Apps Script or change the main dashboard's sign-in. Generated previews are ignored by Git.
