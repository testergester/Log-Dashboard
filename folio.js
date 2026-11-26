(() => {
  const switcher = document.querySelector("#folio-switch");
  const stylesheet = document.querySelector("#folio-styles");
  const theme = document.querySelector('meta[name="theme-color"]');
  const classicTheme = theme.content;
  const classicTitle = document.title;
  let cover;

  function createCover() {
    const cover = document.createElement("section");
    cover.className = "folio-cover";
    cover.setAttribute("aria-labelledby", "folio-cover-title");
    cover.innerHTML = `
      <div class="folio-cover-heading">
        <div class="folio-date" data-folio-date></div>
        <h1 id="folio-cover-title">Teaching planner</h1>
      </div>
      <div class="folio-art" aria-hidden="true">
        <span class="folio-sun"></span>
        <span class="folio-notebook notebook-back"></span>
        <span class="folio-notebook notebook-front"><span>Lesson<br>notes</span></span>
        <span class="folio-pencil"></span>
      </div>
      <div class="folio-week" aria-label="Current week"></div>`;
    document.querySelector("#access-panel").prepend(cover);
    return cover;
  }

  function showCurrentWeek() {
    const today = todayInTashkent();
    cover.querySelector("[data-folio-date]").textContent =
      formatDate(today, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const monday = mondayOf(today);
    const week = cover.querySelector(".folio-week");
    week.replaceChildren();
    for (let offset = 0; offset < 7; offset++) {
      const date = addDays(monday, offset);
      const day = document.createElement("time");
      day.dateTime = date;
      day.setAttribute("aria-label", formatDate(date, { weekday: "long", month: "long", day: "numeric" }));
      if (date === today) day.setAttribute("aria-current", "date");
      const label = document.createElement("span");
      label.textContent = formatDate(date, { weekday: "short" });
      const number = document.createElement("b");
      number.textContent = dateAtUTC(date).getUTCDate();
      day.append(label, number);
      week.append(day);
    }
  }

  function syncView() {
    const active = location.hash === "#folio";
    if (active) {
      cover ??= createCover();
      showCurrentWeek();
    }
    if (cover) cover.hidden = !active;
    stylesheet.disabled = !active;
    switcher.href = active ? "#" : "#folio";
    switcher.textContent = active ? "Classic view" : "Folio view";
    theme.content = active ? "#f3f0e9" : classicTheme;
    document.title = active ? "Folio · Teaching desk" : classicTitle;
  }

  window.addEventListener("hashchange", syncView);
  window.addEventListener("pageshow", syncView);
  document.addEventListener("DOMContentLoaded", syncView);
})();
