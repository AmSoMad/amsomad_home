(function (root) {
  "use strict";
  const pad = (value) => String(value).padStart(2, "0");
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const validMonth = (value) => /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value || "");

  function shiftMonth(value, offset) {
    if (!validMonth(value) || !Number.isInteger(offset)) return null;
    const [year, month] = value.split("-").map(Number);
    const total = year * 12 + month - 1 + offset;
    const nextYear = Math.floor(total / 12);
    return nextYear >= 1000 && nextYear <= 9999 ? `${nextYear}-${pad(total % 12 + 1)}` : null;
  }

  function timeFromPart(value, part, next) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
    if (!/^\d{1,2}$/.test(String(next))) return null;
    const number = Number(next);
    if (!(part === "hour" && number < 24 || part === "minute" && number < 60)) return null;
    const parts = value.split(":");
    parts[part === "hour" ? 0 : 1] = pad(number);
    return parts.join(":");
  }

  function timeFields(key, start, end) {
    return ["start", "end"].map((field) => {
      const label = field === "start" ? "시작 시간" : "종료 시간";
      const [hour, minute] = (field === "start" ? start : end).split(":");
      const options = (count, selected, unit) => Array.from({ length: count }, (_, index) =>
        `<option value="${pad(index)}" ${pad(index) === selected ? "selected" : ""}>${pad(index)}${unit}</option>`).join("");
      const attrs = `data-action="time-part" data-key="${escape(key)}" data-field="${field}"`;
      return `<fieldset class="time-select-field"><legend>${label}</legend><div class="time-select-parts">
        <select ${attrs} data-part="hour" aria-label="${label} 시, 24시간제">${options(24, hour, "시")}</select>
        <span aria-hidden="true">:</span>
        <select ${attrs} data-part="minute" aria-label="${label} 분">${options(60, minute, "분")}</select>
      </div></fieldset>`;
    }).join("");
  }

  function bindMonthPicker(prefix, onChange) {
    const get = (suffix) => document.getElementById(prefix + suffix);
    const input = get("");
    const yearSelect = get("Year");
    const monthSelect = get("Number");
    const previous = get("Previous");
    const next = get("Next");
    let disabled = false;
    let renderedYear;
    monthSelect.innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${pad(i + 1)}">${i + 1}월</option>`).join("");

    function sync(value, locked = false) {
      if (!validMonth(value)) return;
      const [year, month] = value.split("-");
      disabled = locked;
      input.value = value;
      input.disabled = locked;
      if (renderedYear !== year) {
        const currentYear = new Date().getFullYear();
        const years = new Set();
        [Number(year), currentYear].forEach((center) => {
          for (let item = Math.max(1000, center - 5); item <= Math.min(9999, center + 5); item++) years.add(item);
        });
        yearSelect.innerHTML = [...years].sort((a, b) => a - b).map((item) => `<option value="${item}">${item}년</option>`).join("");
        renderedYear = year;
      }
      yearSelect.value = year;
      monthSelect.value = month;
      yearSelect.disabled = monthSelect.disabled = locked;
      previous.disabled = locked || !shiftMonth(value, -1);
      next.disabled = locked || !shiftMonth(value, 1);
    }
    function change(value) {
      if (disabled || !validMonth(value)) return;
      onChange(value);
    }
    previous.addEventListener("click", () => change(shiftMonth(input.value, -1)));
    next.addEventListener("click", () => change(shiftMonth(input.value, 1)));
    yearSelect.addEventListener("change", () => change(`${yearSelect.value}-${monthSelect.value}`));
    monthSelect.addEventListener("change", () => change(`${yearSelect.value}-${monthSelect.value}`));
    return { sync };
  }

  const api = { shiftMonth, timeFromPart, timeFields, bindMonthPicker };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MaruControls = api;
})(typeof window !== "undefined" ? window : globalThis);
