# Analysis dashboard UX review

Reviewed with the Shiro plugin in fix mode on 7 October 2026.

Evidence: the signed-in live dashboard, its source, and a local desktop/mobile preview with synthetic student records. The local preview was used to test revisions without changing teaching records.

## Findings and fixes

- **P1 — Student history loses roster context.** Opening a student previously jumped below every roster row. History now opens in a native modal side panel; Escape closes it and returns keyboard focus to the student.
- **P1 — Signals overstate sparse evidence.** The live dashboard had one saved checklist while labeling students “On track” or “Needs attention.” Labels now describe the actual criterion (review attendance or points); the page reports data coverage and marks limited history. Unrecorded absences, points, and notes show an unknown value rather than zero.
- **P1 — Mobile hides key metrics.** The previous table required horizontal scrolling for points and notes. Mobile rows now show labeled metrics together, with larger controls and text. The viewport was checked at 390 × 844 without page overflow.
- **P2 — Group selection is opaque.** Names now remain visible as chips; the picker supports search, select all, clear, Done, and Escape.
- **P2 — Long roster makes notes difficult to reach.** A five-student preview with a More students button and section links provide direct access to students and lesson notes. Filtering resets the preview to five students. A review button applies the flagged-student filter directly.
- **Keep — Teaching desk palette and saved-record calculations.** The green visual system, summary cards, dated notes, and explicit participation-point rules support the teaching workflow.

## Verification and final review

Verified modal opening, Escape and focus return, student-list expansion, missing-data labels, group search and multiple selections, date validation/recovery, and responsive layout in the local browser. Aggregation and existing dashboard regressions pass. Date validation keeps the last valid results visible while the user corrects the range.

Final verdict: ready to ship. Group and student context is easier to follow; review signals remain descriptive and the underlying record calculations are preserved.

Changed implementation files: analysis.html, analysis.css, analysis.js, analysis-model.js. Updated analysis regression coverage.

## Follow-up corrections

The student-history backdrop now closes the panel and restores focus. The Groups label sits above a 42px control aligned with the date inputs. The roster shows five students initially; More students reveals all remaining matches. Verified outside-click dismissal and focus return, five-to-all expansion, filter reset, and matching filter dimensions in the browser.
