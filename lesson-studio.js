"use strict";

(() => {
  const column = document.getElementById("lesson-column");
  const panel = document.getElementById("lesson-sidebar-panel");
  const classic = document.getElementById("classic-lesson-tab");
  const studio = document.getElementById("studio-lesson-tab");
  const slots = {
    "studio-details-body": [".lesson-type-options", ".lesson-status-options", "#record-features-hint"],
    "studio-unit-body": ['label[for="lesson-unit"]', "#lesson-unit"],
    "studio-title-body": ['label[for="lesson-lessonTitle"]', "#lesson-lessonTitle"],
    "studio-logs-body": [
      "#lesson-notes-label",
      ".lesson-notes-toolbar",
      "#lesson-notes",
      'label[for="lesson-nextClassNotes"]',
      "#lesson-nextClassNotes",
    ],
    "studio-outcome-body": [".rating-fieldset"],
    "studio-history": ["#previous-records"],
  };
  // Move the original inputs so both layouts share the same draft and controls.
  const placements = Object.entries(slots).flatMap(([slot, selectors]) => {
    const target = document.getElementById(slot);
    return selectors.map((selector) => {
      const element = column.querySelector(selector);
      const node = element.matches(".record-options") ? element.closest("fieldset") : element;
      const anchor = document.createComment("Classic position");
      node.before(anchor);
      return { node, anchor, target };
    });
  });

  const optionIcons = {
    Lesson: "▤",
    Quiz: "?",
    Exam: "▧",
    Done: "✓",
    Skipped: "»",
    Late: "◷",
    Cancelled: "×",
    __custom: "+",
  };
  for (const input of panel.querySelectorAll(".record-options input[type=radio]")) {
    const icon = document.createElement("span");
    icon.className = "studio-only studio-option-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = optionIcons[input.value];
    input.nextElementSibling.prepend(icon);
  }

  const mpr = document.getElementById("mpr-inline");
  const summary = document.getElementById("studio-summary");

  window.syncLessonStudioSummary = function (redrawn = false) {
    if (redrawn) summary.replaceChildren();
    const evidence = mpr.querySelector(".mpr-evidence-body");
    const checkbox = evidence?.querySelector(".mpr-summary-check") || summary.firstElementChild;
    if (!checkbox || !evidence) return;
    if (column.classList.contains("is-studio")) {
      checkbox.querySelector("input").disabled = mpr.querySelector(".mpr-note-fields").disabled;
      summary.append(checkbox);
    } else {
      evidence.append(checkbox);
    }
  };

  function setLayout(useStudio) {
    column.classList.toggle("is-studio", useStudio);
    document.getElementById("edit-class-button").textContent = useStudio ? "Timetable" : "Edit class";
    studio.setAttribute("aria-selected", String(useStudio));
    classic.setAttribute("aria-selected", String(!useStudio));
    studio.tabIndex = useStudio ? 0 : -1;
    classic.tabIndex = useStudio ? -1 : 0;
    panel.setAttribute("aria-labelledby", useStudio ? studio.id : classic.id);
    for (const { node, anchor, target } of placements) {
      if (useStudio) target.append(node);
      else anchor.after(node);
    }
    if (!useStudio) {
      mpr.querySelectorAll(".mpr-studio-card").forEach((section) => {
        section.open = true;
      });
    }
    window.syncLessonStudioSummary();
    column.scrollTop = 0;
  }

  classic.addEventListener("click", () => setLayout(false));
  studio.addEventListener("click", () => setLayout(true));
  document.getElementById("close-lesson-studio").addEventListener("click", () => {
    setLayout(false);
    classic.focus();
  });
  classic.parentElement.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const useStudio = event.key === "End" || (event.key !== "Home" && event.target === classic);
    setLayout(useStudio);
    (useStudio ? studio : classic).focus();
  });
})();
