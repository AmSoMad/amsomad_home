(function (global) {
  "use strict";
  // 서버 확정본과 별개로 월별 작업본을 보관합니다. 읽기 화면은 여기에 쓰지 않습니다.
  function createStore(storage, key = "maru-monthly-drafts-v2") {
    let cache = {};
    try { cache = JSON.parse(storage.getItem(key)) || {}; } catch (_) { /* storage unavailable */ }
    if (!cache || Array.isArray(cache) || typeof cache !== "object") cache = {};
    const copy = (value) => value == null ? null : JSON.parse(JSON.stringify(value));
    return {
      read(month) { return copy(cache[month]); },
      write(month, record) {
        if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid month");
        cache[month] = copy(record);
        try { storage.setItem(key, JSON.stringify(cache)); return true; } catch (_) { return false; }
      },
    };
  }
  global.MaruDraftStore = { createStore };
  if (typeof module !== "undefined") module.exports = { createStore };
})(typeof window === "undefined" ? globalThis : window);
