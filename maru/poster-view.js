(function (root) {
  "use strict";
  const WIDTH = 1080;
  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const validMonth = (value) => /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value || "");
  const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback;
  const time = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || "") ? value : "00:00";
  const text = (value, fallback, limit = 60) => String(value || fallback).trim().slice(0, limit);

  function publicRecord(record, month) {
    if (!validMonth(month) || !record?.confirmed_at || !Number.isFinite(Date.parse(record.confirmed_at))
      || record.month !== `${month}-01` || record.data?.targetMonth !== month
      || !Array.isArray(record.data.scheduleDefinitions) || !record.data.schedules || typeof record.data.schedules !== "object") {
      throw new Error("공개 일정 데이터가 올바르지 않습니다.");
    }
    // No local draft/default generation: only a server-confirmed snapshot can be shown.
    return { ...record.data, confirmedAt: record.confirmed_at };
  }

  function cards(state, { interactive = false } = {}) {
    if (!validMonth(state.targetMonth)) throw new Error("일정의 연월 형식이 올바르지 않습니다.");
    const [year, month] = state.targetMonth.split("-").map(Number);
    const first = new Date(year, month - 1, 1).getDay();
    const last = new Date(year, month, 0).getDate();
    const holidays = new Map((root.KoreanHolidays?.forMonth(year, month) || []).map((item) => [item.day, item]));
    const dates = (values) => [...new Set((Array.isArray(values) ? values : []).filter((day) => Number.isInteger(day) && day >= 1 && day <= last))].sort((a, b) => a - b);
    const definitions = (state.scheduleDefinitions || []).filter((item) => item && /^[a-zA-Z0-9-]{1,48}$/.test(item.key) && state.schedules?.[item.key]?.enabled);
    if (!definitions.length) return { count: 0, html: `<div class="empty-poster-schedules"><strong>${month}월 레슨 준비 중</strong><p>등록된 레슨 일정이 없습니다.</p></div>` };
    const html = definitions.map((definition) => {
      const item = state.schedules[definition.key];
      const selected = dates(item.selected);
      const cancelled = dates(item.cancelled).filter((day) => !selected.includes(day));
      const title = text(definition.title, "레슨 일정", 26);
      const cells = Array.from({ length: Math.ceil((first + last) / 7) * 7 }, (_, index) => {
        const day = index - first + 1;
        if (day < 1 || day > last) return '<span class="poster-date is-empty" aria-hidden="true"></span>';
        const weekday = index % 7;
        const holiday = holidays.get(day);
        const isLesson = selected.includes(day);
        const isCancelled = cancelled.includes(day);
        const classes = ["poster-date", weekday === 0 ? "is-sunday" : weekday === 6 ? "is-saturday" : "", holiday ? "is-holiday" : "", isLesson ? "is-selected" : isCancelled ? "is-cancelled" : ""].filter(Boolean).join(" ");
        const status = isLesson ? "레슨일" : isCancelled ? "휴강일" : "미지정";
        const action = isLesson ? "휴강으로 변경" : isCancelled ? "표시 지우기" : "레슨일로 선택";
        const label = `${month}월 ${day}일 ${WEEKDAYS[weekday]}요일${holiday ? `, ${holiday.name} 공휴일` : ""}, ${status}${interactive ? `. 누르면 ${action}` : ""}`;
        const tag = interactive ? "button" : "div";
        return `<${tag} class="${classes}" ${interactive ? `type="button" data-poster-date="${day}" data-key="${definition.key}"` : 'role="img"'} aria-label="${escape(label)}" ${holiday ? `title="${escape(holiday.name)}"` : ""}>
          <span class="poster-day-line"><strong>${day}</strong><small>${WEEKDAYS[weekday]}</small></span>
          <span class="poster-cell-state" aria-hidden="true">${isLesson ? "✓ 레슨" : isCancelled ? "× 휴강" : "—"}</span>
          ${holiday ? '<em class="poster-holiday-mark" aria-hidden="true">공</em>' : ""}
        </${tag}>`;
      }).join("");
      return `<section class="poster-schedule-card" style="--accent:${color(definition.accent, "#6d39e7")};--accent-dark:${color(definition.accentDark, "#4b20a8")};--accent-soft:${color(definition.accentSoft, "#f2ecff")}">
        <header class="card-heading">
          <span class="poster-card-swatch" aria-hidden="true">${escape(text(definition.short, "레슨", 4))}</span>
          <div class="card-title-wrap"><span class="card-kicker">LESSON SCHEDULE</span><h3>${escape(title)}</h3></div>
          <span class="time-badge">${time(item.start)} ~ ${time(item.end)}</span>
        </header>
        <div class="poster-calendar-shell">
          <div class="poster-month-heading"><strong>${year}년 ${month}월</strong><span>레슨 ${selected.length}일 · 휴강 ${cancelled.length}일</span></div>
          <div class="poster-calendar" aria-label="${year}년 ${month}월 ${escape(title)} 달력">
            ${WEEKDAYS.map((weekday) => `<span class="poster-weekday">${weekday}</span>`).join("")}${cells}
          </div>
        </div>
        <div class="lesson-summary">
          <span class="lesson-summary-label"><i>✓</i> 레슨 진행일</span>
          <p class="lesson-days">${selected.length ? selected.join(", ") : "레슨일이 없습니다."}</p>
          ${cancelled.length ? `<div class="cancelled-summary"><span><i>×</i> 휴강일</span><b>${cancelled.join(", ")}</b></div>` : ""}
          <p class="poster-calendar-footnote"><span>공</span> 공휴일 · 표시된 레슨일과 휴강일을 확인해주세요.</p>
        </div>
      </section>`;
    }).join("");
    return { count: definitions.length, html };
  }

  function render(state, options) {
    const get = (id) => document.getElementById(id);
    const [year, month] = state.targetMonth.split("-").map(Number);
    const output = cards(state, options);
    get("poster").dataset.themeMonth = String(month);
    get("posterCoach").textContent = text(state.coachName, "배드민턴 코치님", 18);
    get("posterMonthNumber").textContent = month;
    get("posterYear").textContent = `${year} BADMINTON LESSON`;
    get("posterGreeting").textContent = text(state.greeting, "코트에서 즐겁게 만나요!", 46);
    get("posterNoticeOne").textContent = text(state.noticeOne, "레슨 전 일정을 확인해주세요.", 54);
    get("posterNoticeTwo").textContent = text(state.noticeTwo, "예약 및 문의는 코치님께 연락해주세요.", 54);
    get("posterFooterMessage").textContent = text(state.footerMessage, "오늘도 즐거운 레슨 되세요!", 42);
    get("posterStatusBadge").textContent = state.confirmedAt ? "✓ 공개된 확정 일정" : "수정 중 일정";
    get("posterStatusBadge").classList.toggle("is-confirmed", Boolean(state.confirmedAt));
    get("posterSchedules").dataset.count = String(output.count);
    get("posterSchedules").innerHTML = output.html;
  }

  function height() { return Math.max(1, Math.ceil(document.getElementById("poster").scrollHeight)); }
  function resize() {
    const stage = document.getElementById("previewStage");
    const frame = document.getElementById("posterFrame");
    if (!stage.offsetWidth) return;
    const style = getComputedStyle(stage);
    const available = stage.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0);
    const size = height();
    const scale = Math.min(1, available / WIDTH);
    frame.style.transform = `scale(${scale})`;
    frame.style.width = `${WIDTH}px`;
    frame.style.height = `${size}px`;
    stage.style.height = `${size * scale}px`;
    frame.style.marginRight = `${WIDTH * (scale - 1)}px`;
    frame.style.marginBottom = `${size * (scale - 1)}px`;
  }
  async function imageDataUrl() {
    if (document.fonts?.ready) await document.fonts.ready;
    return root.DomExport.renderDataUrl(document.getElementById("poster"), { width: WIDTH, height: height(), scale: 1 });
  }

  const api = { cards, render, resize, height, imageDataUrl, publicRecord, validMonth };
  root.MaruPoster = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
