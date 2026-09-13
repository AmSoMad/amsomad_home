(function () {
  "use strict";

  const STORAGE_KEY = "cockcock-lesson-calendar-v1";
  const RULES_VERSION = 2;
  const POSTER_WIDTH = 1080;
  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const DEFAULT_SCHEDULES = [
    {
      key: "mwf-evening",
      short: "월수금",
      title: "월 · 수 · 금 저녁",
      days: [1, 3, 5],
      start: "19:00",
      end: "22:00",
      accent: "#6d39e7",
      accentDark: "#4b20a8",
      accentSoft: "#f2ecff",
    },
    {
      key: "tt-evening",
      short: "화목",
      title: "화 · 목 저녁",
      days: [2, 4],
      start: "19:00",
      end: "22:00",
      accent: "#ed476d",
      accentDark: "#c82952",
      accentSoft: "#fff0f4",
    },
    {
      key: "saturday",
      short: "토요일",
      title: "토요일 레슨",
      days: [6],
      start: "10:00",
      end: "13:00",
      accent: "#2687e6",
      accentDark: "#1262bb",
      accentSoft: "#edf7ff",
    },
    {
      key: "weekday-morning",
      short: "평일",
      title: "평일 오전",
      days: [1, 2, 3, 4, 5],
      start: "09:30",
      end: "12:30",
      accent: "#13a889",
      accentDark: "#08755f",
      accentSoft: "#eafaf6",
    },
  ];
  const CUSTOM_COLORS = [
    { accent: "#8b5cf6", accentDark: "#6034bd", accentSoft: "#f3efff" },
    { accent: "#e56c32", accentDark: "#a94318", accentSoft: "#fff2eb" },
    { accent: "#1595a8", accentDark: "#086a78", accentSoft: "#eafafd" },
    { accent: "#d24f91", accentDark: "#963061", accentSoft: "#fff0f7" },
    { accent: "#628b26", accentDark: "#416414", accentSoft: "#f2f9e9" },
  ];

  const current = new Date();
  const currentMonth = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}`;

  function matchingDates(monthValue, weekdays) {
    const [year, month] = monthValue.split("-").map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const result = [];
    for (let day = 1; day <= lastDay; day += 1) {
      if (weekdays.includes(new Date(year, month - 1, day).getDay())) result.push(day);
    }
    return result;
  }

  function holidaysForMonth(monthValue) {
    const [year, month] = monthValue.split("-").map(Number);
    return window.KoreanHolidays?.forMonth(year, month) || [];
  }

  function holidayMapForMonth(monthValue = state.targetMonth) {
    return new Map(holidaysForMonth(monthValue).map((holiday) => [holiday.day, holiday]));
  }

  function defaultScheduleDates(monthValue, schedule) {
    const [year, month] = monthValue.split("-").map(Number);
    const firstWeekday = new Date(year, month - 1, 1).getDay();
    const lessonDates = matchingDates(monthValue, schedule.days);
    const selected = new Set(lessonDates);
    const cancelled = new Set();

    if (schedule.key === "mwf-evening" || schedule.key === "tt-evening") {
      const weekForDay = (day) => Math.floor((firstWeekday + day - 1) / 7);
      const lessonWeeks = lessonDates.map(weekForDay);
      const firstLessonWeek = Math.min(...lessonWeeks);
      const lastLessonWeek = Math.max(...lessonWeeks);
      const requiredFirstWeekday = schedule.key === "mwf-evening" ? 1 : 2;
      const firstWeekIsLesson = firstWeekday === requiredFirstWeekday;

      lessonDates.forEach((day) => {
        const week = weekForDay(day);
        const shouldCancel =
          (week === firstLessonWeek && !firstWeekIsLesson) ||
          (week === lastLessonWeek && firstWeekIsLesson);
        if (shouldCancel) {
          selected.delete(day);
          cancelled.add(day);
        }
      });
    }

    holidaysForMonth(monthValue).forEach((holiday) => {
      selected.delete(holiday.day);
      cancelled.add(holiday.day);
    });

    return {
      selected: Array.from(selected).sort((a, b) => a - b),
      cancelled: Array.from(cancelled).sort((a, b) => a - b),
    };
  }

  function copyScheduleDefinitions(definitions = DEFAULT_SCHEDULES) {
    return definitions.map((schedule) => ({ ...schedule, days: [...schedule.days] }));
  }

  function sanitizedDefinitions(value) {
    if (!Array.isArray(value)) return copyScheduleDefinitions();
    const keys = new Set();
    const result = value.flatMap((schedule, index) => {
      const key = String(schedule?.key || "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 48);
      const title = String(schedule?.title || "").trim().slice(0, 26);
      const days = [...new Set(Array.isArray(schedule?.days) ? schedule.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) : [])].sort();
      if (!key || keys.has(key) || !title || !days.length) return [];
      keys.add(key);
      const palette = CUSTOM_COLORS[index % CUSTOM_COLORS.length];
      const isHex = (color) => /^#[0-9a-f]{6}$/i.test(String(color || ""));
      return [{
        key,
        title,
        short: String(schedule.short || title.replace(/\s/g, "")).slice(0, 4),
        days,
        start: /^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.start) ? schedule.start : "19:00",
        end: /^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.end) ? schedule.end : "22:00",
        accent: isHex(schedule.accent) ? schedule.accent : palette.accent,
        accentDark: isHex(schedule.accentDark) ? schedule.accentDark : palette.accentDark,
        accentSoft: isHex(schedule.accentSoft) ? schedule.accentSoft : palette.accentSoft,
        custom: Boolean(schedule.custom),
      }];
    });
    return result.length ? result : copyScheduleDefinitions();
  }

  function createDefaultState(monthValue = currentMonth, definitions = copyScheduleDefinitions()) {
    const scheduleDefinitions = copyScheduleDefinitions(definitions);
    return {
      rulesVersion: RULES_VERSION,
      targetMonth: monthValue,
      coachName: "쌍둥이 코치님",
      coaches: ["쌍둥이 코치님"],
      confirmedAt: null,
      greeting: "매일 조금씩 성장하는 우리, 코트에서 만나요!",
      noticeOne: "일정은 변동될 수 있으니 레슨 전 미리 확인해주세요.",
      noticeTwo: "예약 및 문의는 코치님께 DM 또는 카카오톡으로 연락주세요.",
      footerMessage: "즐겁게 운동하고, 건강하게 성장해요!",
      scheduleDefinitions,
      schedules: Object.fromEntries(
        scheduleDefinitions.map((schedule) => {
          const dates = defaultScheduleDates(monthValue, schedule);
          return [
            schedule.key,
            {
              enabled: true,
              start: schedule.start,
              end: schedule.end,
              selected: dates.selected,
              cancelled: dates.cancelled,
            },
          ];
        }),
      ),
    };
  }

  function normalizeState(parsed) {
      if (!parsed || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(parsed.targetMonth)) throw new Error("일정의 연월 형식이 올바르지 않습니다.");
      const definitions = sanitizedDefinitions(parsed.scheduleDefinitions);
      const defaults = createDefaultState(parsed.targetMonth, definitions);
      const needsRulesMigration = parsed.rulesVersion !== RULES_VERSION;
      const coaches = [...new Set((Array.isArray(parsed.coaches) ? parsed.coaches : [parsed.coachName])
        .map((name) => String(name || "").trim().slice(0, 18))
        .filter(Boolean))];
      const coachName = String(parsed.coachName || coaches[0] || defaults.coachName).trim().slice(0, 18);
      if (!coaches.includes(coachName)) coaches.unshift(coachName);
      return {
        ...defaults,
        greeting: String(parsed.greeting ?? defaults.greeting).slice(0, 46),
        noticeOne: String(parsed.noticeOne ?? defaults.noticeOne).slice(0, 54),
        noticeTwo: String(parsed.noticeTwo ?? defaults.noticeTwo).slice(0, 54),
        footerMessage: String(parsed.footerMessage ?? defaults.footerMessage).slice(0, 42),
        scheduleDefinitions: definitions,
        coaches: coaches.length ? coaches : defaults.coaches,
        coachName,
        confirmedAt: typeof parsed.confirmedAt === "string" && Number.isFinite(Date.parse(parsed.confirmedAt)) ? parsed.confirmedAt : null,
        rulesVersion: RULES_VERSION,
        schedules: Object.fromEntries(
          definitions.map((schedule) => {
            const item = parsed.schedules?.[schedule.key] || {};
            const base = defaults.schedules[schedule.key];
            const [year, month] = parsed.targetMonth.split("-").map(Number);
            const lastDay = new Date(year, month, 0).getDate();
            const dates = (value, fallback) => !needsRulesMigration && Array.isArray(value)
              ? [...new Set(value.filter((day) => Number.isInteger(day) && day >= 1 && day <= lastDay))].sort((a, b) => a - b) : fallback;
            const selected = dates(item.selected, base.selected);
            const time = (value, fallback) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
            return [schedule.key, {
              enabled: typeof item.enabled === "boolean" ? item.enabled : base.enabled,
              start: time(item.start, base.start), end: time(item.end, base.end), selected,
              cancelled: dates(item.cancelled, base.cancelled).filter((day) => !selected.includes(day)),
            }];
          }),
        ),
      };
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return normalizeState(parsed);
    } catch (_error) {
      return createDefaultState();
    }
  }

  let state = loadState();
  let openEditorKey = state.scheduleDefinitions[0]?.key || "";
  let saveTimer;
  let toastTimer;
  let access = { readOnly: false, busy: false };

  function editable() { return !access.readOnly && !access.busy && !state.confirmedAt; }

  const elements = {
    workspace: document.querySelector(".workspace"),
    editor: document.querySelector(".editor"),
    targetMonth: document.querySelector("#targetMonth"),
    coachName: document.querySelector("#coachName"),
    newCoachName: document.querySelector("#newCoachName"),
    addCoachButton: document.querySelector("#addCoachButton"),
    removeCoachButton: document.querySelector("#removeCoachButton"),
    greeting: document.querySelector("#greeting"),
    noticeOne: document.querySelector("#noticeOne"),
    noticeTwo: document.querySelector("#noticeTwo"),
    footerMessage: document.querySelector("#footerMessage"),
    holidaySummary: document.querySelector("#holidaySummary"),
    scheduleEditors: document.querySelector("#scheduleEditors"),
    scheduleCreator: document.querySelector("#scheduleCreator"),
    toggleScheduleCreatorButton: document.querySelector("#toggleScheduleCreatorButton"),
    confirmScheduleButton: document.querySelector("#confirmScheduleButton"),
    confirmTitle: document.querySelector("#confirm-title"),
    confirmDescription: document.querySelector("#confirmDescription"),
    poster: document.querySelector("#poster"),
    posterFrame: document.querySelector("#posterFrame"),
    previewStage: document.querySelector("#previewStage"),
    posterCoach: document.querySelector("#posterCoach"),
    posterMonthNumber: document.querySelector("#posterMonthNumber"),
    posterYear: document.querySelector("#posterYear"),
    posterGreeting: document.querySelector("#posterGreeting"),
    posterStatusBadge: document.querySelector("#posterStatusBadge"),
    posterSchedules: document.querySelector("#posterSchedules"),
    posterNoticeOne: document.querySelector("#posterNoticeOne"),
    posterNoticeTwo: document.querySelector("#posterNoticeTwo"),
    posterFooterMessage: document.querySelector("#posterFooterMessage"),
    savedState: document.querySelector("#savedState"),
    toast: document.querySelector("#toast"),
  };

  function hydrateEmbeddedImages() {
    if (!window.MARU_LOGO_DATA) return;
    document.querySelectorAll("[data-maru-logo]").forEach((image) => {
      image.src = window.MARU_LOGO_DATA;
    });
  }

  function scheduleDefinition(key) {
    return state.scheduleDefinitions.find((schedule) => schedule.key === key);
  }

  function getMonthParts() {
    const [year, month] = state.targetMonth.split("-").map(Number);
    return { year, month, lastDay: new Date(year, month, 0).getDate() };
  }

  function queueSave() {
    if (access.readOnly) return;
    window.dispatchEvent(new CustomEvent("maru:change", { detail: JSON.parse(JSON.stringify(state)) }));
    window.clearTimeout(saveTimer);
    elements.savedState.textContent = "저장 중…";
    saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        if (!window.MaruCloudUI) elements.savedState.textContent = "이 기기에 저장됨";
      } catch (_error) {
        elements.savedState.textContent = "자동 저장을 사용할 수 없어요";
      }
    }, 220);
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 3000);
  }

  function safeText(value, fallback) {
    const trimmed = String(value || "").trim();
    return trimmed || fallback;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[character]);
  }

  function renderCoachOptions() {
    elements.coachName.innerHTML = state.coaches
      .map((name) => `<option value="${escapeHtml(name)}" ${name === state.coachName ? "selected" : ""}>${escapeHtml(name)}</option>`)
      .join("");
    elements.removeCoachButton.disabled = state.coaches.length <= 1;
  }

  function renderConfirmation() {
    const isConfirmed = Boolean(state.confirmedAt);
    const locked = isConfirmed || access.readOnly || access.busy;
    elements.editor.classList.toggle("is-confirmed", isConfirmed);
    elements.confirmTitle.textContent = isConfirmed ? "확정된 일정" : "일정 수정 중";
    elements.confirmDescription.textContent = isConfirmed
      ? `${new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeStyle: "short" }).format(new Date(state.confirmedAt))} 확정 · 수정하려면 잠금을 풀어주세요.`
      : "날짜를 확인한 뒤 확정해 주세요. 이 기기에 자동 저장됩니다.";
    elements.confirmScheduleButton.textContent = isConfirmed ? "수정하기" : "이 일정 확정";
    elements.posterStatusBadge.textContent = isConfirmed ? "✓ 확정 일정" : "수정 중 일정";
    elements.posterStatusBadge.classList.toggle("is-confirmed", isConfirmed);
    elements.editor
      .querySelectorAll(".basics-panel input, .basics-panel select, .basics-panel button, .schedule-editor-section input, .schedule-editor-section button, .notice-panel input, .mobile-reset")
      .forEach((control) => { control.disabled = locked; });
    elements.targetMonth.disabled = access.busy;
    elements.removeCoachButton.disabled = locked || state.coaches.length <= 1;
    elements.confirmScheduleButton.disabled = access.readOnly || access.busy;
    document.querySelector("#resetButton").disabled = locked;
    elements.posterSchedules.querySelectorAll("button").forEach((button) => { button.disabled = locked; });
  }

  function calendarCells() {
    const { year, month, lastDay } = getMonthParts();
    const firstWeekday = new Date(year, month - 1, 1).getDay();
    const cells = Array(firstWeekday).fill(null);
    for (let day = 1; day <= lastDay; day += 1) cells.push(day);
    while (cells.length < 42) cells.push(null);
    return cells;
  }

  function formatSelectedDates(selected) {
    if (!selected.length) return "레슨일을 선택해주세요";
    return selected.slice().sort((a, b) => a - b).join(", ");
  }

  function weekdayForDate(day) {
    const { year, month } = getMonthParts();
    return new Date(year, month - 1, day).getDay();
  }

  function scheduleRuleDescription(schedule) {
    if (schedule.key !== "mwf-evening" && schedule.key !== "tt-evening") return "";
    const { year, month } = getMonthParts();
    const firstWeekday = new Date(year, month - 1, 1).getDay();
    const requiredDay = schedule.key === "mwf-evening" ? 1 : 2;
    const isLessonFirst = firstWeekday === requiredDay;
    return `1일이 ${WEEKDAYS[firstWeekday]}요일 · 첫 주 ${isLessonFirst ? "레슨" : "휴강"} · 마지막 주 ${isLessonFirst ? "휴강" : "레슨"}`;
  }

  function renderHolidaySummary() {
    const holidays = holidaysForMonth(state.targetMonth);
    if (!holidays.length) {
      elements.holidaySummary.innerHTML = `
        <strong><i>공</i> 공휴일 자동 휴강</strong>
        <p>이 달에는 정기 공휴일이 없습니다.</p>`;
      return;
    }
    elements.holidaySummary.innerHTML = `
      <strong><i>공</i> 공휴일 자동 휴강</strong>
      <div>${holidays.map((holiday) => `<span><b>${holiday.day}일</b> ${holiday.name}</span>`).join("")}</div>
      <p>임시공휴일과 선거일은 날짜를 눌러 직접 X로 지정해주세요.</p>`;
  }

  function renderScheduleEditors() {
    const holidayMap = holidayMapForMonth();
    elements.scheduleEditors.innerHTML = state.scheduleDefinitions.map((schedule) => {
      const currentSchedule = state.schedules[schedule.key];
      const isOpen = openEditorKey === schedule.key;
      const defaults = new Set(defaultScheduleDates(state.targetMonth, schedule).selected);
      const selected = new Set(currentSchedule.selected);
      const cancelled = new Set(currentSchedule.cancelled);
      const dateButtons = calendarCells().map((day) => {
        if (day === null) return '<span class="date-chip-placeholder" aria-hidden="true"></span>';
        const weekday = weekdayForDate(day);
        const holiday = holidayMap.get(day);
        const classes = ["date-chip"];
        if (defaults.has(day)) classes.push("is-default");
        if (weekday === 0) classes.push("is-sunday");
        if (weekday === 6) classes.push("is-saturday");
        if (holiday) classes.push("is-holiday");
        if (selected.has(day)) classes.push("is-selected");
        if (cancelled.has(day)) classes.push("is-cancelled");
        const nextAction = selected.has(day) ? "휴강으로 변경" : cancelled.has(day) ? "표시 지우기" : "레슨일로 선택";
        const holidayLabel = holiday ? `, ${holiday.name} 공휴일` : "";
        return `<button class="${classes.join(" ")}" type="button" data-action="toggle-date" data-key="${schedule.key}" data-day="${day}" aria-label="${day}일 ${WEEKDAYS[weekday]}요일${holidayLabel}, ${nextAction}" ${holiday ? `title="${holiday.name}"` : ""} data-state="${selected.has(day) ? "selected" : cancelled.has(day) ? "cancelled" : "empty"}"><span class="chip-number">${day}</span><small>${WEEKDAYS[weekday]}</small>${holiday ? '<em class="holiday-flag" aria-hidden="true">공</em>' : ""}<b class="chip-x" aria-hidden="true">×</b></button>`;
      }).join("");
      const ruleDescription = scheduleRuleDescription(schedule);

      return `
        <article class="schedule-editor ${isOpen ? "is-open" : ""} ${currentSchedule.enabled ? "" : "is-disabled"}" style="--accent:${schedule.accent}">
          <button class="schedule-summary" type="button" data-action="toggle-editor" data-key="${schedule.key}" aria-expanded="${isOpen}">
            <span class="schedule-swatch">${escapeHtml(schedule.short)}</span>
            <span class="schedule-summary-copy">
              <strong>${escapeHtml(schedule.title)}</strong>
              <small>${currentSchedule.start} ~ ${currentSchedule.end}</small>
            </span>
            <span class="selected-count">레슨 ${currentSchedule.selected.length} · 휴강 ${currentSchedule.cancelled.length}</span>
            <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="schedule-editor-body">
            <div class="schedule-settings-row">
              <div class="time-control">
                <span class="time-label">레슨 시간</span>
                 <input class="time-input" type="time" value="${currentSchedule.start}" data-action="time" data-field="start" data-key="${schedule.key}" aria-label="${escapeHtml(schedule.title)} 시작 시간" />
                <em>~</em>
                 <input class="time-input" type="time" value="${currentSchedule.end}" data-action="time" data-field="end" data-key="${schedule.key}" aria-label="${escapeHtml(schedule.title)} 종료 시간" />
              </div>
              <div class="enable-control">
                <label class="switch-label">
                  이미지에 표시
                  <input type="checkbox" ${currentSchedule.enabled ? "checked" : ""} data-action="enabled" data-key="${schedule.key}" />
                  <span class="switch-track"></span>
                </label>
              </div>
            </div>
            ${schedule.custom ? `<div class="custom-schedule-actions"><span>추가한 일정</span><button class="mini-action mini-action-danger" type="button" data-action="delete-schedule" data-key="${schedule.key}">이 일정 삭제</button></div>` : ""}
            ${ruleDescription ? `<div class="schedule-rule-note"><b>자동 규칙</b><span>${ruleDescription}</span></div>` : ""}
            <div class="date-picker-heading">
              <strong>레슨 날짜 직접 선택</strong>
              <div class="mini-actions">
                <button class="mini-action" type="button" data-action="reset-dates" data-key="${schedule.key}">기본 규칙</button>
                <button class="mini-action" type="button" data-action="clear-dates" data-key="${schedule.key}">모두 해제</button>
              </div>
            </div>
            <div class="date-state-legend" aria-hidden="true">
              <span><i class="legend-selected">✓</i> 레슨일</span>
              <span><i class="legend-cancelled">×</i> 휴강일</span>
              <span><i class="legend-holiday">공</i> 공휴일</span>
              <small>날짜를 계속 눌러 상태 변경</small>
            </div>
            <div class="date-chip-calendar">
              <div class="date-chip-weekdays" aria-hidden="true">
                ${WEEKDAYS.map((weekday) => `<span>${weekday}</span>`).join("")}
              </div>
              <div class="date-chip-grid" aria-label="${escapeHtml(schedule.title)} 날짜 선택">${dateButtons}</div>
            </div>
          </div>
        </article>`;
    }).join("");
  }

  function posterCalendar(schedule) {
    const selected = new Set(state.schedules[schedule.key].selected);
    const cancelled = new Set(state.schedules[schedule.key].cancelled);
    const holidayMap = holidayMapForMonth();
    const weekdays = WEEKDAYS.map((weekday) => `<span class="poster-weekday">${weekday}</span>`).join("");
    const dates = calendarCells()
      .map((day, index) => {
        if (day === null) return '<span class="poster-date is-empty"></span>';
        const weekday = index % 7;
        const holiday = holidayMap.get(day);
        const classes = ["poster-date"];
        if (weekday === 0) classes.push("is-sunday");
        if (weekday === 6) classes.push("is-saturday");
        if (holiday) classes.push("is-holiday");
        if (selected.has(day)) classes.push("is-selected");
        if (cancelled.has(day)) classes.push("is-cancelled");
        const nextAction = selected.has(day) ? "휴강으로 변경" : cancelled.has(day) ? "표시 지우기" : "레슨일로 선택";
        return `<button class="${classes.join(" ")}" type="button" data-poster-date="${day}" data-key="${schedule.key}" aria-label="${day}일${holiday ? ` ${holiday.name} 공휴일,` : ","} ${nextAction}" ${holiday ? `title="${holiday.name}"` : ""}><span>${day}</span>${holiday ? '<em class="poster-holiday-mark" aria-hidden="true">공</em>' : ""}${cancelled.has(day) ? '<b aria-hidden="true">×</b>' : ""}</button>`;
      })
      .join("");
    return weekdays + dates;
  }

  function renderPoster() {
    const { year, month } = getMonthParts();
    elements.poster.dataset.themeMonth = String(month);
    elements.posterCoach.textContent = safeText(state.coachName, "배드민턴 코치님");
    elements.posterMonthNumber.textContent = month;
    elements.posterYear.textContent = `${year} BADMINTON LESSON`;
    elements.posterGreeting.textContent = safeText(state.greeting, "코트에서 즐겁게 만나요!");
    elements.posterNoticeOne.textContent = safeText(state.noticeOne, "레슨 전 일정을 확인해주세요.");
    elements.posterNoticeTwo.textContent = safeText(state.noticeTwo, "예약 및 문의는 코치님께 연락해주세요.");
    elements.posterFooterMessage.textContent = safeText(state.footerMessage, "오늘도 즐거운 레슨 되세요!");

    const enabledSchedules = state.scheduleDefinitions.filter((schedule) => state.schedules[schedule.key]?.enabled);
    elements.posterSchedules.dataset.count = String(enabledSchedules.length);

    if (!enabledSchedules.length) {
      elements.posterSchedules.innerHTML = `
        <div class="empty-poster-schedules">
          <strong>${month}월 레슨 준비 중</strong>
          <p>표시할 일정을 하나 이상 선택해주세요.</p>
        </div>`;
      return;
    }

    elements.posterSchedules.innerHTML = enabledSchedules
      .map((schedule) => {
        const currentSchedule = state.schedules[schedule.key];
        const hasCancelled = currentSchedule.cancelled.length > 0;
        return `
          <section class="poster-schedule-card" style="--accent:${schedule.accent};--accent-dark:${schedule.accentDark};--accent-soft:${schedule.accentSoft}">
            <header class="card-heading">
              <div class="card-title-wrap">
                <span class="card-kicker">LESSON SCHEDULE</span>
                 <h3>${escapeHtml(schedule.title)}</h3>
              </div>
              <span class="time-badge">${currentSchedule.start} ~ ${currentSchedule.end}</span>
            </header>
            <div class="poster-calendar" aria-label="${year}년 ${month}월 ${escapeHtml(schedule.title)} 달력">
              ${posterCalendar(schedule)}
            </div>
            <div class="lesson-summary">
              <span class="lesson-summary-label"><i>✓</i> 레슨 진행일</span>
              <p class="lesson-days ${currentSchedule.selected.length > 13 ? "is-dense" : ""}">${formatSelectedDates(currentSchedule.selected)}</p>
              ${hasCancelled ? `<div class="cancelled-summary"><span><i>×</i> 휴강일</span><b>${formatSelectedDates(currentSchedule.cancelled)}</b></div>` : ""}
              <span class="lesson-count">LESSON ${currentSchedule.selected.length}${hasCancelled ? ` · OFF ${currentSchedule.cancelled.length}` : ""}</span>
            </div>
          </section>`;
      })
      .join("");
  }

  function renderAll(save = true) {
    renderCoachOptions();
    renderHolidaySummary();
    renderScheduleEditors();
    renderPoster();
    renderConfirmation();
    if (save) queueSave();
    window.requestAnimationFrame(resizePoster);
  }

  function setInitialFields() {
    elements.targetMonth.value = state.targetMonth;
    renderCoachOptions();
    elements.greeting.value = state.greeting;
    elements.noticeOne.value = state.noticeOne;
    elements.noticeTwo.value = state.noticeTwo;
    elements.footerMessage.value = state.footerMessage;
  }

  function toggleDate(key, day) {
    if (!editable()) {
      showToast("확정 일정을 수정하려면 먼저 '수정하기'를 눌러주세요.");
      return;
    }
    const schedule = state.schedules[key];
    if (!scheduleDefinition(key) || !Number.isInteger(day) || day < 1 || day > getMonthParts().lastDay) return;
    const selected = new Set(schedule.selected);
    const cancelled = new Set(schedule.cancelled);
    if (selected.has(day)) {
      selected.delete(day);
      cancelled.add(day);
    } else if (cancelled.has(day)) {
      cancelled.delete(day);
    } else {
      selected.add(day);
    }
    schedule.selected = Array.from(selected).sort((a, b) => a - b);
    schedule.cancelled = Array.from(cancelled).sort((a, b) => a - b);
    renderAll();
  }

  elements.scheduleEditors.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const { action, key } = button.dataset;
    if (action !== "toggle-editor" && !editable()) return;
    if (action === "toggle-editor") {
      openEditorKey = openEditorKey === key ? "" : key;
      renderScheduleEditors();
      renderConfirmation();
    } else if (action === "toggle-date") {
      toggleDate(key, Number(button.dataset.day));
    } else if (action === "reset-dates") {
      const defaults = defaultScheduleDates(state.targetMonth, scheduleDefinition(key));
      state.schedules[key].selected = defaults.selected;
      state.schedules[key].cancelled = defaults.cancelled;
      renderAll();
      showToast("첫·마지막 주와 공휴일 기본 규칙을 다시 적용했어요.");
    } else if (action === "clear-dates") {
      state.schedules[key].selected = [];
      state.schedules[key].cancelled = [];
      renderAll();
    } else if (action === "delete-schedule") {
      const definition = scheduleDefinition(key);
      if (!definition?.custom || !window.confirm(`'${definition.title}' 일정을 삭제할까요?`)) return;
      state.scheduleDefinitions = state.scheduleDefinitions.filter((schedule) => schedule.key !== key);
      delete state.schedules[key];
      openEditorKey = state.scheduleDefinitions[0]?.key || "";
      renderAll();
      resizePoster();
      showToast("추가한 일정을 삭제했어요.");
    }
  });

  elements.scheduleEditors.addEventListener("change", (event) => {
    if (!editable()) return;
    const input = event.target.closest("[data-action]");
    if (!input) return;
    const { action, key } = input.dataset;
    if (action === "time") state.schedules[key][input.dataset.field] = input.value;
    if (action === "enabled") state.schedules[key].enabled = input.checked;
    renderAll();
  });

  elements.posterSchedules.addEventListener("click", (event) => {
    const dateButton = event.target.closest("[data-poster-date]");
    if (!dateButton) return;
    toggleDate(dateButton.dataset.key, Number(dateButton.dataset.posterDate));
  });

  elements.targetMonth.addEventListener("change", () => {
    if (!elements.targetMonth.value) return;
    if (window.MaruCloudUI) {
      void window.MaruCloudUI.selectMonth(elements.targetMonth.value);
      return;
    }
    state.targetMonth = elements.targetMonth.value;
    state.scheduleDefinitions.forEach((schedule) => {
      const defaults = defaultScheduleDates(state.targetMonth, schedule);
      state.schedules[schedule.key].selected = defaults.selected;
      state.schedules[schedule.key].cancelled = defaults.cancelled;
    });
    renderAll();
    showToast("새 달의 기본 레슨일을 자동으로 선택했어요.");
  });

  ["greeting", "noticeOne", "noticeTwo", "footerMessage"].forEach((field) => {
    elements[field].addEventListener("input", () => {
      if (!editable()) return;
      state[field] = elements[field].value;
      renderPoster();
      queueSave();
    });
  });

  elements.coachName.addEventListener("change", () => {
    if (!editable()) return;
    state.coachName = elements.coachName.value;
    renderPoster();
    queueSave();
  });

  elements.addCoachButton.addEventListener("click", () => {
    if (!editable()) return;
    const name = elements.newCoachName.value.trim().slice(0, 18);
    if (!name) {
      showToast("추가할 코치 이름을 입력해주세요.");
      elements.newCoachName.focus();
      return;
    }
    if (!state.coaches.includes(name)) state.coaches.push(name);
    state.coachName = name;
    elements.newCoachName.value = "";
    renderAll();
    showToast(`${name}을(를) 추가했어요.`);
  });

  elements.newCoachName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      elements.addCoachButton.click();
    }
  });

  elements.removeCoachButton.addEventListener("click", () => {
    if (!editable()) return;
    if (state.coaches.length <= 1) return;
    const removed = state.coachName;
    state.coaches = state.coaches.filter((name) => name !== removed);
    state.coachName = state.coaches[0];
    renderAll();
    showToast(`${removed}을(를) 목록에서 삭제했어요.`);
  });

  elements.confirmScheduleButton.addEventListener("click", () => {
    if (window.MaruCloudUI) { void window.MaruCloudUI.confirm(); return; }
    if (state.confirmedAt) {
      state.confirmedAt = null;
      renderAll();
      showToast("수정할 수 있도록 일정 잠금을 풀었어요.");
      return;
    }
    state.confirmedAt = new Date().toISOString();
    renderAll();
    showToast("현재 레슨 일정을 확정했어요.");
  });

  elements.toggleScheduleCreatorButton.addEventListener("click", () => {
    if (!editable()) return;
    elements.scheduleCreator.hidden = !elements.scheduleCreator.hidden;
    elements.toggleScheduleCreatorButton.setAttribute("aria-expanded", String(!elements.scheduleCreator.hidden));
    if (!elements.scheduleCreator.hidden) document.querySelector("#newScheduleTitle").focus();
  });

  document.querySelector("#cancelScheduleCreatorButton").addEventListener("click", () => {
    elements.scheduleCreator.hidden = true;
    elements.toggleScheduleCreatorButton.setAttribute("aria-expanded", "false");
  });

  elements.scheduleCreator.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!editable()) return;
    const titleInput = document.querySelector("#newScheduleTitle");
    const title = titleInput.value.trim().slice(0, 26);
    const days = Array.from(document.querySelectorAll('input[name="newScheduleDay"]:checked')).map((input) => Number(input.value));
    if (!title || !days.length) {
      showToast("일정 이름과 레슨 요일을 선택해주세요.");
      return;
    }
    const palette = CUSTOM_COLORS[state.scheduleDefinitions.length % CUSTOM_COLORS.length];
    const key = `custom-${Date.now()}`;
    const definition = {
      key,
      title,
      short: days.map((day) => WEEKDAYS[day]).join("").slice(0, 4),
      days,
      start: document.querySelector("#newScheduleStart").value || "19:00",
      end: document.querySelector("#newScheduleEnd").value || "22:00",
      ...palette,
      custom: true,
    };
    state.scheduleDefinitions.push(definition);
    const defaults = defaultScheduleDates(state.targetMonth, definition);
    state.schedules[key] = { enabled: true, start: definition.start, end: definition.end, ...defaults };
    openEditorKey = key;
    event.currentTarget.reset();
    document.querySelector("#newScheduleStart").value = "19:00";
    document.querySelector("#newScheduleEnd").value = "22:00";
    elements.scheduleCreator.hidden = true;
    elements.toggleScheduleCreatorButton.setAttribute("aria-expanded", "false");
    renderAll();
    resizePoster();
    showToast("새 레슨 일정을 추가했어요.");
  });

  document.querySelectorAll("[data-mobile-view]").forEach((button) => {
    if (!button.classList.contains("mobile-tab")) return;
    button.addEventListener("click", () => {
      const view = button.dataset.mobileView;
      elements.workspace.dataset.mobileView = view;
      document.querySelectorAll(".mobile-tab").forEach((tab) => {
        const active = tab.dataset.mobileView === view;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-pressed", String(active));
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
      window.setTimeout(resizePoster, 50);
    });
  });

  function resetState() {
    if (!editable()) return;
    if (!window.confirm("입력한 내용을 모두 지우고 기본 일정으로 되돌릴까요?")) return;
    state = createDefaultState(state.targetMonth);
    openEditorKey = state.scheduleDefinitions[0]?.key || "";
    setInitialFields();
    renderAll();
    showToast("기본 일정으로 되돌렸어요.");
  }

  document.querySelector("#resetButton").addEventListener("click", resetState);
  document.querySelector("#mobileResetButton").addEventListener("click", resetState);

  function fileName() {
    const [year, month] = state.targetMonth.split("-");
    return `${year}년-${Number(month)}월-레슨일정.png`;
  }

  function posterHeight() {
    return Math.max(1920, Math.ceil(elements.poster.scrollHeight));
  }

  async function createImageDataUrl() {
    if (document.fonts?.ready) await document.fonts.ready;
    return window.DomExport.renderDataUrl(elements.poster, { width: POSTER_WIDTH, height: posterHeight(), scale: 1 });
  }

  async function createImageBlob() {
    return window.DomExport.dataUrlToBlob(await createImageDataUrl());
  }

  async function downloadImage(button) {
    const originalText = button.innerHTML;
    button.disabled = true;
    button.textContent = "이미지 만드는 중…";
    try {
      const dataUrl = await createImageDataUrl();
      window.DomExport.download(dataUrl, fileName());
      showToast("PNG 이미지를 저장했어요.");
    } catch (error) {
      console.error(error);
      showToast("이미지 저장에 실패했어요. Chrome 또는 Edge에서 다시 시도해주세요.");
    } finally {
      button.disabled = false;
      button.innerHTML = originalText;
    }
  }

  document.querySelector("#downloadButton").addEventListener("click", (event) => downloadImage(event.currentTarget));
  document.querySelector("#downloadPreviewButton").addEventListener("click", (event) => downloadImage(event.currentTarget));

  document.querySelector("#shareButton").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const blob = await createImageBlob();
      const file = new File([blob], fileName(), { type: "image/png" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "레슨 일정 안내" });
      } else {
        window.DomExport.download(blob, fileName());
        showToast("공유 기능 대신 이미지를 저장했어요.");
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.error(error);
        showToast("이미지를 공유하지 못했어요. PNG 저장을 이용해주세요.");
      }
    } finally {
      button.disabled = false;
    }
  });

  function resizePoster() {
    if (!elements.previewStage.offsetWidth) return;
    const stageStyle = getComputedStyle(elements.previewStage);
    const horizontalPadding = parseFloat(stageStyle.paddingLeft || 0) + parseFloat(stageStyle.paddingRight || 0);
    const availableWidth = elements.previewStage.clientWidth - horizontalPadding;
    const height = posterHeight();
    const scale = Math.min(1, availableWidth / POSTER_WIDTH);
    elements.posterFrame.style.transform = `scale(${scale})`;
    elements.posterFrame.style.width = `${POSTER_WIDTH}px`;
    elements.posterFrame.style.height = `${height}px`;
    elements.previewStage.style.height = `${height * scale}px`;
    elements.posterFrame.style.marginRight = `${POSTER_WIDTH * (scale - 1)}px`;
    elements.posterFrame.style.marginBottom = `${height * (scale - 1)}px`;
  }

  if ("ResizeObserver" in window) new ResizeObserver(resizePoster).observe(elements.previewStage);
  window.addEventListener("resize", resizePoster);

  function registerWebMcpTools() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const reportRegistrationError = (error) => console.warn("WebMCP 도구를 등록하지 못했습니다.", error);

    const register = (tool) => {
      try {
        void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(reportRegistrationError);
      } catch (error) {
        reportRegistrationError(error);
      }
    };

    register({
      name: "set_lesson_schedule",
      title: "레슨 일정 설정",
      description: "한 레슨 그룹의 날짜, 시간, 표시 여부를 설정하고 화면과 미리보기를 갱신합니다.",
      inputSchema: {
        type: "object",
        properties: {
          scheduleKey: {
            type: "string",
            description: "변경할 레슨 그룹 식별자",
          },
          dates: {
            type: "array",
            items: { type: "integer", minimum: 1, maximum: 31 },
            uniqueItems: true,
            description: "선택할 날짜 숫자 목록",
          },
          cancelledDates: {
            type: "array",
            items: { type: "integer", minimum: 1, maximum: 31 },
            uniqueItems: true,
            description: "X로 표시할 휴강 날짜 숫자 목록",
          },
          start: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
          end: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
          enabled: { type: "boolean" },
        },
        required: ["scheduleKey", "dates"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!editable()) throw new Error("현재 일정은 읽기 전용입니다. 관리자 편집 화면에서 수정 잠금을 풀어주세요.");
        const definition = scheduleDefinition(input?.scheduleKey);
        if (!definition) throw new Error("알 수 없는 레슨 그룹입니다.");
        if (!Array.isArray(input.dates)) throw new Error("dates는 날짜 배열이어야 합니다.");
        const { lastDay } = getMonthParts();
        const dates = [...new Set(input.dates)];
        const cancelledDates = [...new Set(input.cancelledDates || [])];
        if ([...dates, ...cancelledDates].some((day) => !Number.isInteger(day) || day < 1 || day > lastDay)) {
          throw new Error(`날짜는 1일부터 ${lastDay}일 사이여야 합니다.`);
        }
        if (dates.some((day) => cancelledDates.includes(day))) throw new Error("같은 날짜를 레슨일과 휴강일로 동시에 설정할 수 없습니다.");
        const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
        if (input.start !== undefined && !timePattern.test(input.start)) throw new Error("시작 시간 형식이 올바르지 않습니다.");
        if (input.end !== undefined && !timePattern.test(input.end)) throw new Error("종료 시간 형식이 올바르지 않습니다.");

        const target = state.schedules[definition.key];
        target.selected = dates.sort((a, b) => a - b);
        target.cancelled = cancelledDates.sort((a, b) => a - b);
        if (input.start !== undefined) target.start = input.start;
        if (input.end !== undefined) target.end = input.end;
        if (input.enabled !== undefined) target.enabled = input.enabled;
        renderAll();
        return {
          scheduleKey: definition.key,
          selectedDates: target.selected,
          cancelledDates: target.cancelled,
          time: `${target.start}~${target.end}`,
          enabled: target.enabled,
        };
      },
    });

    register({
      name: "download_lesson_calendar_png",
      title: "레슨 일정 PNG 저장",
      description: "현재 미리보기를 휴대폰용 세로형 PNG 파일로 만들어 다운로드합니다.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute() {
        const blob = await createImageBlob();
        const name = fileName();
        window.DomExport.download(blob, name);
        return { downloaded: true, filename: name, width: POSTER_WIDTH, height: posterHeight() };
      },
    });

    window.addEventListener("pagehide", () => lifecycle.abort(), { once: true });
  }

  hydrateEmbeddedImages();
  window.MaruCalendar = {
    getState: () => JSON.parse(JSON.stringify(state)),
    normalizeState,
    applyState(value) {
      window.clearTimeout(saveTimer);
      state = normalizeState(value);
      openEditorKey = state.scheduleDefinitions[0]?.key || "";
      setInitialFields();
      renderAll(false);
    },
    newMonth(month) {
      return { ...createDefaultState(month, state.scheduleDefinitions),
        coaches: [...state.coaches], coachName: state.coachName,
        greeting: state.greeting, noticeOne: state.noticeOne, noticeTwo: state.noticeTwo,
        footerMessage: state.footerMessage };
    },
    setAccess(value) { access = { ...access, ...value }; renderConfirmation(); },
    showToast,
  };
  setInitialFields();
  renderAll(false);
  resizePoster();
  registerWebMcpTools();
})();
